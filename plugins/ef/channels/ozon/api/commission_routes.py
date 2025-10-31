"""
Ozon类目佣金API路由
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Query
from pydantic import BaseModel, Field
from typing import List
from decimal import Decimal
import logging
import csv
import io

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from plugins.ef.channels.ozon.models.category_commissions import OzonCategoryCommission

router = APIRouter(prefix="/category-commissions", tags=["Ozon Category Commissions"])
logger = logging.getLogger(__name__)


# === DTO ===

class CategoryCommissionResponse(BaseModel):
    """类目佣金响应"""
    id: int
    category_module: str
    category_name: str
    rfbs_tier1: float
    rfbs_tier2: float
    rfbs_tier3: float
    fbp_tier1: float
    fbp_tier2: float
    fbp_tier3: float

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": 1,
                "category_module": "美容",
                "category_name": "专业医疗设备",
                "rfbs_tier1": 12.00,
                "rfbs_tier2": 17.00,
                "rfbs_tier3": 17.00,
                "fbp_tier1": 11.00,
                "fbp_tier2": 16.00,
                "fbp_tier3": 16.00
            }
        }
    }


class CategoryCommissionsListResponse(BaseModel):
    """类目佣金列表响应"""
    items: List[CategoryCommissionResponse]
    total: int
    page: int
    page_size: int


class CategoryCommissionUpdateRequest(BaseModel):
    """更新类目佣金请求"""
    rfbs_tier1: float = Field(..., ge=0, le=100, description="rFBS方案佣金 - 最多1500卢布（含）")
    rfbs_tier2: float = Field(..., ge=0, le=100, description="rFBS方案佣金 - 最多5000卢布（含）")
    rfbs_tier3: float = Field(..., ge=0, le=100, description="rFBS方案佣金 - 超过5000卢布")
    fbp_tier1: float = Field(..., ge=0, le=100, description="FBP方案佣金 - 最多1500卢布（含）")
    fbp_tier2: float = Field(..., ge=0, le=100, description="FBP方案佣金 - 最多5000卢布（含）")
    fbp_tier3: float = Field(..., ge=0, le=100, description="FBP方案佣金 - 超过5000卢布")


class CSVImportResponse(BaseModel):
    """CSV导入响应"""
    success: bool
    imported_count: int
    skipped_count: int
    errors: List[str] = []


# === API端点 ===

@router.get(
    "",
    response_model=CategoryCommissionsListResponse,
    summary="查询类目佣金列表"
)
async def get_category_commissions(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    module: str | None = Query(None, description="类目模块筛选"),
    search: str | None = Query(None, description="类目名称搜索"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    查询类目佣金列表

    参数：
    - page: 页码（默认1）
    - page_size: 每页数量（默认20，最大100）
    - module: 类目模块筛选（可选）
    - search: 类目名称搜索（可选，模糊匹配）

    权限：所有登录用户
    """
    # 构建查询
    query = select(OzonCategoryCommission)

    # 筛选条件
    if module:
        query = query.where(OzonCategoryCommission.category_module == module)

    if search:
        query = query.where(OzonCategoryCommission.category_name.ilike(f"%{search}%"))

    # 计算总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # 执行查询
    result = await db.execute(query)
    commissions = result.scalars().all()

    # 转换为响应格式
    items = [
        CategoryCommissionResponse(
            id=c.id,
            category_module=c.category_module,
            category_name=c.category_name,
            rfbs_tier1=float(c.rfbs_tier1),
            rfbs_tier2=float(c.rfbs_tier2),
            rfbs_tier3=float(c.rfbs_tier3),
            fbp_tier1=float(c.fbp_tier1),
            fbp_tier2=float(c.fbp_tier2),
            fbp_tier3=float(c.fbp_tier3),
        )
        for c in commissions
    ]

    return CategoryCommissionsListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get(
    "/modules",
    response_model=List[str],
    summary="获取所有类目模块"
)
async def get_category_modules(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取所有不重复的类目模块列表（用于筛选下拉框）

    权限：所有登录用户
    """
    query = select(OzonCategoryCommission.category_module).distinct().order_by(OzonCategoryCommission.category_module)
    result = await db.execute(query)
    modules = result.scalars().all()

    return modules


@router.put(
    "/{commission_id}",
    response_model=CategoryCommissionResponse,
    summary="更新类目佣金（仅管理员）"
)
async def update_category_commission(
    commission_id: int,
    request: CategoryCommissionUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    更新指定类目的佣金比例

    参数：
    - commission_id: 佣金记录ID
    - request: 更新请求（包含6个佣金比例）

    权限：仅管理员
    """
    # 权限检查
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "type": "about:blank",
                "title": "Permission denied",
                "status": 403,
                "detail": "Only administrators can modify commission data",
                "code": "PERMISSION_DENIED"
            }
        )

    # 查询记录
    result = await db.execute(
        select(OzonCategoryCommission).where(OzonCategoryCommission.id == commission_id)
    )
    commission = result.scalar_one_or_none()

    if not commission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "type": "about:blank",
                "title": "Commission not found",
                "status": 404,
                "detail": f"Category commission with ID {commission_id} does not exist",
                "code": "COMMISSION_NOT_FOUND"
            }
        )

    # 更新佣金比例
    commission.rfbs_tier1 = Decimal(str(request.rfbs_tier1))
    commission.rfbs_tier2 = Decimal(str(request.rfbs_tier2))
    commission.rfbs_tier3 = Decimal(str(request.rfbs_tier3))
    commission.fbp_tier1 = Decimal(str(request.fbp_tier1))
    commission.fbp_tier2 = Decimal(str(request.fbp_tier2))
    commission.fbp_tier3 = Decimal(str(request.fbp_tier3))

    # 提交事务
    await db.commit()
    await db.refresh(commission)

    logger.info(
        f"Category commission updated",
        extra={
            "commission_id": commission_id,
            "category_module": commission.category_module,
            "category_name": commission.category_name,
            "user_id": current_user.id
        }
    )

    return CategoryCommissionResponse(
        id=commission.id,
        category_module=commission.category_module,
        category_name=commission.category_name,
        rfbs_tier1=float(commission.rfbs_tier1),
        rfbs_tier2=float(commission.rfbs_tier2),
        rfbs_tier3=float(commission.rfbs_tier3),
        fbp_tier1=float(commission.fbp_tier1),
        fbp_tier2=float(commission.fbp_tier2),
        fbp_tier3=float(commission.fbp_tier3),
    )


@router.post(
    "/import-csv",
    response_model=CSVImportResponse,
    summary="导入CSV文件（仅管理员）"
)
async def import_csv(
    file: UploadFile = File(..., description="CSV文件"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    从CSV文件导入类目佣金数据

    CSV格式要求：
    - 第一行为表头（会被跳过）
    - 列顺序：类目模块,商品类目,rFBS≤1500,FBP≤1500,rFBS≤5000,FBP≤5000,rFBS>5000,FBP>5000
    - 佣金比例格式：12.00% 或 12.00（自动去除%符号）

    权限：仅管理员
    """
    # 权限检查
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "type": "about:blank",
                "title": "Permission denied",
                "status": 403,
                "detail": "Only administrators can import commission data",
                "code": "PERMISSION_DENIED"
            }
        )

    # 验证文件类型
    if not file.filename.endswith('.csv'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "type": "about:blank",
                "title": "Invalid file type",
                "status": 400,
                "detail": "Only CSV files are supported",
                "code": "INVALID_FILE_TYPE"
            }
        )

    # 读取文件内容
    try:
        contents = await file.read()
        text = contents.decode('utf-8-sig')  # 使用 utf-8-sig 自动去除 BOM
        csv_reader = csv.reader(io.StringIO(text))
    except Exception as e:
        logger.error(f"Failed to read CSV file: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "type": "about:blank",
                "title": "Failed to read CSV",
                "status": 400,
                "detail": f"Cannot read CSV file: {str(e)}",
                "code": "CSV_READ_ERROR"
            }
        )

    # 解析CSV并导入数据
    imported_count = 0
    skipped_count = 0
    errors = []

    # 跳过表头
    next(csv_reader, None)

    for row_num, row in enumerate(csv_reader, start=2):  # 从第2行开始（第1行是表头）
        try:
            if len(row) < 8:
                errors.append(f"第{row_num}行：列数不足（需要8列）")
                skipped_count += 1
                continue

            # 解析数据
            category_module = row[0].strip()
            category_name = row[1].strip()

            if not category_module or not category_name:
                errors.append(f"第{row_num}行：类目模块或类目名称为空")
                skipped_count += 1
                continue

            # 解析佣金比例（去除%符号）
            def parse_percentage(value: str) -> Decimal:
                value = value.strip().replace('%', '').replace(',', '.')
                return Decimal(value)

            rfbs_tier1 = parse_percentage(row[2])
            fbp_tier1 = parse_percentage(row[3])
            rfbs_tier2 = parse_percentage(row[4])
            fbp_tier2 = parse_percentage(row[5])
            rfbs_tier3 = parse_percentage(row[6])
            fbp_tier3 = parse_percentage(row[7])

            # 检查是否已存在相同的记录
            existing = await db.execute(
                select(OzonCategoryCommission).where(
                    OzonCategoryCommission.category_module == category_module,
                    OzonCategoryCommission.category_name == category_name
                )
            )
            existing_record = existing.scalar_one_or_none()

            if existing_record:
                # 更新现有记录
                existing_record.rfbs_tier1 = rfbs_tier1
                existing_record.rfbs_tier2 = rfbs_tier2
                existing_record.rfbs_tier3 = rfbs_tier3
                existing_record.fbp_tier1 = fbp_tier1
                existing_record.fbp_tier2 = fbp_tier2
                existing_record.fbp_tier3 = fbp_tier3
            else:
                # 创建新记录
                new_commission = OzonCategoryCommission(
                    category_module=category_module,
                    category_name=category_name,
                    rfbs_tier1=rfbs_tier1,
                    rfbs_tier2=rfbs_tier2,
                    rfbs_tier3=rfbs_tier3,
                    fbp_tier1=fbp_tier1,
                    fbp_tier2=fbp_tier2,
                    fbp_tier3=fbp_tier3,
                )
                db.add(new_commission)

            imported_count += 1

        except Exception as e:
            logger.error(f"Error processing row {row_num}: {e}")
            errors.append(f"第{row_num}行：{str(e)}")
            skipped_count += 1

    # 提交事务
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to commit CSV import: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "type": "about:blank",
                "title": "Import failed",
                "status": 500,
                "detail": f"Failed to save imported data: {str(e)}",
                "code": "IMPORT_COMMIT_ERROR"
            }
        )

    logger.info(
        f"CSV import completed",
        extra={
            "imported_count": imported_count,
            "skipped_count": skipped_count,
            "error_count": len(errors),
            "user_id": current_user.id
        }
    )

    return CSVImportResponse(
        success=True,
        imported_count=imported_count,
        skipped_count=skipped_count,
        errors=errors[:10]  # 最多返回前10个错误
    )
