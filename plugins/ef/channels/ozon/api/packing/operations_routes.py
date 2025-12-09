"""
打包发货 - 核心操作路由
包括：备货、更新业务信息、提交/更新国内单号、丢弃发货单、标记打印等
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Optional, List
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ...models import OzonPosting, OzonDomesticTracking
from ...utils.datetime_utils import utcnow

router = APIRouter(tags=["ozon-packing"])
logger = logging.getLogger(__name__)


# DTO 模型
class PrepareStockDTO(BaseModel):
    """备货请求 DTO"""
    purchase_price: Decimal = Field(..., description="进货价格（必填）")
    source_platform: Optional[List[str]] = Field(None, description="采购平台列表（可选：1688/拼多多/咸鱼/淘宝/库存）")
    order_notes: Optional[str] = Field(None, description="订单备注（可选）")
    sync_to_ozon: Optional[bool] = Field(True, description="是否同步到Ozon（默认true）")


class UpdateBusinessInfoDTO(BaseModel):
    """更新业务信息请求 DTO"""
    purchase_price: Optional[Decimal] = Field(None, description="进货价格（可选）")
    material_cost: Optional[Decimal] = Field(None, description="打包费用（可选）")
    source_platform: Optional[List[str]] = Field(None, description="采购平台列表（可选）")
    order_notes: Optional[str] = Field(None, description="订单备注（可选）")


class SubmitDomesticTrackingDTO(BaseModel):
    """填写国内单号请求 DTO（支持多单号）"""
    # 新字段：数组输入（推荐）
    domestic_tracking_numbers: Optional[List[str]] = Field(None, min_length=1, max_length=10, description="国内物流单号列表（支持多个）")

    # 兼容字段：单值输入（废弃但保留）
    domestic_tracking_number: Optional[str] = Field(None, description="[已废弃] 单个国内物流单号，请使用 domestic_tracking_numbers")

    order_notes: Optional[str] = Field(None, description="订单备注（可选）")

    def get_tracking_numbers(self) -> List[str]:
        """获取国内单号列表（兼容逻辑）"""
        if self.domestic_tracking_numbers:
            return self.domestic_tracking_numbers
        if self.domestic_tracking_number:
            return [self.domestic_tracking_number]
        return []


class UpdateDomesticTrackingDTO(BaseModel):
    """更新国内单号请求 DTO（支持多单号）"""
    domestic_tracking_numbers: List[str] = Field(..., min_length=0, max_length=10, description="国内物流单号列表（完整替换现有单号）")


class DiscardPostingDTO(BaseModel):
    """丢弃发货单请求 DTO"""
    reason: Optional[str] = Field(None, description="丢弃原因")

@router.post("/postings/{posting_number}/prepare")
async def prepare_stock(
    posting_number: str,
    dto: PrepareStockDTO,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    备货操作：保存业务信息 + 可选同步到 OZON（需要操作员权限）

    操作流程：
    1. 保存进货价格、采购平台、备注
    2. 如果勾选"同步到Ozon"，调用 OZON ship API（v4）
    3. 更新操作状态为"分配中"
    4. 更新操作时间
    """
    from ...services.posting_operations import PostingOperationsService
    from ef_core.services.audit_service import AuditService

    # 1. 查询旧值（用于日志对比）
    old_posting_result = await db.execute(
        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
    )
    old_posting = old_posting_result.scalar_one_or_none()

    if not old_posting:
        raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

    # 保存旧值
    old_purchase_price = old_posting.purchase_price
    old_source_platform = old_posting.source_platform
    old_operation_status = old_posting.operation_status
    old_order_notes = old_posting.order_notes

    # 2. 获取请求上下文（用于审计日志）
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    # 3. 执行业务逻辑（传递审计参数）
    service = PostingOperationsService(db)
    result = await service.prepare_stock(
        posting_number=posting_number,
        purchase_price=dto.purchase_price,
        source_platform=dto.source_platform,
        order_notes=dto.order_notes,
        sync_to_ozon=dto.sync_to_ozon,
        user_id=current_user.id,
        username=current_user.username,
        ip_address=request_ip,
        user_agent=user_agent,
        request_id=request_id
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    # 4. 查询新值
    new_posting_result = await db.execute(
        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
    )
    new_posting = new_posting_result.scalar_one_or_none()

    # 5. 记录审计日志（字段级，备货操作的其他变更）
    try:
        # 4.1 记录进货价格变更
        if new_posting.purchase_price != old_purchase_price:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新进货价格",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "purchase_price": {
                        "old": str(old_purchase_price) if old_purchase_price else None,
                        "new": str(new_posting.purchase_price) if new_posting.purchase_price else None
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 4.2 记录采购平台变更
        if new_posting.source_platform != old_source_platform:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新采购平台",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "source_platform": {
                        "old": old_source_platform,
                        "new": new_posting.source_platform
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 4.3 记录操作状态变更
        if new_posting.operation_status != old_operation_status:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="订单状态变更",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "operation_status": {
                        "old": old_operation_status,
                        "new": new_posting.operation_status
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id,
                notes="备货操作触发"
            )

        # 4.4 记录其他信息变更（订单备注）
        if new_posting.order_notes != old_order_notes:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新订单其他信息",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "order_notes": {
                        "old": old_order_notes,
                        "new": new_posting.order_notes
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

    except Exception as e:
        # 审计日志失败不影响主流程
        logger.error(f"备货操作审计日志记录失败 {posting_number}: {str(e)}")

    return result
@router.patch("/postings/{posting_number}")
async def update_posting_business_info(
    posting_number: str,
    dto: UpdateBusinessInfoDTO,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    更新业务信息（不改变操作状态）（需要操作员权限）

    用于"分配中"状态下修改进货价格、采购平台、备注等字段
    """
    from ...services.posting_operations import PostingOperationsService
    from ef_core.services.audit_service import AuditService

    # 1. 查询旧值
    old_posting_result = await db.execute(
        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
    )
    old_posting = old_posting_result.scalar_one_or_none()

    if not old_posting:
        raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

    # 保存旧值
    old_purchase_price = old_posting.purchase_price
    old_material_cost = old_posting.material_cost
    old_source_platform = old_posting.source_platform
    old_order_notes = old_posting.order_notes

    # 2. 执行业务逻辑
    service = PostingOperationsService(db)
    result = await service.update_business_info(
        posting_number=posting_number,
        purchase_price=dto.purchase_price,
        material_cost=dto.material_cost,
        source_platform=dto.source_platform,
        order_notes=dto.order_notes
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    # 3. 查询新值
    new_posting_result = await db.execute(
        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
    )
    new_posting = new_posting_result.scalar_one_or_none()

    # 4. 记录审计日志（字段级）
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    try:
        # 4.1 记录进货价格变更
        if new_posting.purchase_price != old_purchase_price:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新进货价格",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "purchase_price": {
                        "old": str(old_purchase_price) if old_purchase_price else None,
                        "new": str(new_posting.purchase_price) if new_posting.purchase_price else None
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 4.2 记录物料成本变更
        if new_posting.material_cost != old_material_cost:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新物料成本",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "material_cost": {
                        "old": str(old_material_cost) if old_material_cost else None,
                        "new": str(new_posting.material_cost) if new_posting.material_cost else None
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 4.3 记录采购平台变更
        if new_posting.source_platform != old_source_platform:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新采购平台",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "source_platform": {
                        "old": old_source_platform,
                        "new": new_posting.source_platform
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 4.4 记录其他信息变更（订单备注）
        if new_posting.order_notes != old_order_notes:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新订单其他信息",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "order_notes": {
                        "old": old_order_notes,
                        "new": new_posting.order_notes
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

    except Exception as e:
        # 审计日志失败不影响主流程
        logger.error(f"更新业务信息审计日志记录失败 {posting_number}: {str(e)}")

    return result
@router.post("/postings/{posting_number}/domestic-tracking")
async def submit_domestic_tracking(
    posting_number: str,
    dto: SubmitDomesticTrackingDTO,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    填写国内物流单号（支持多单号）（需要操作员权限）

    操作流程：
    1. 保存国内物流单号列表（支持多个）和备注
    2. 更新操作状态为"单号确认"
    3. 更新操作时间

    幂等性：如果状态已是 tracking_confirmed，返回错误
    """
    from ...services.posting_operations import PostingOperationsService
    from ef_core.services.audit_service import AuditService
    from sqlalchemy.orm import selectinload

    # 获取国内单号列表（兼容单值和数组输入）
    tracking_numbers = dto.get_tracking_numbers()

    if not tracking_numbers:
        raise HTTPException(status_code=400, detail="至少需要提供一个国内物流单号")

    # 1. 查询旧值（预加载 domestic_trackings 关系）
    old_posting_result = await db.execute(
        select(OzonPosting)
        .options(selectinload(OzonPosting.domestic_trackings))
        .where(OzonPosting.posting_number == posting_number)
    )
    old_posting = old_posting_result.scalar_one_or_none()

    if not old_posting:
        raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

    # 保存旧值
    old_tracking_numbers = old_posting.get_domestic_tracking_numbers()
    old_operation_status = old_posting.operation_status
    old_order_notes = old_posting.order_notes

    # 2. 执行业务逻辑
    service = PostingOperationsService(db)
    result = await service.submit_domestic_tracking(
        posting_number=posting_number,
        domestic_tracking_numbers=tracking_numbers,
        order_notes=dto.order_notes
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    # 3. 查询新值（预加载 domestic_trackings 关系）
    new_posting_result = await db.execute(
        select(OzonPosting)
        .options(selectinload(OzonPosting.domestic_trackings))
        .where(OzonPosting.posting_number == posting_number)
    )
    new_posting = new_posting_result.scalar_one_or_none()

    # 4. 记录审计日志（字段级）
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    try:
        # 4.1 记录国内单号变更
        new_tracking_numbers = new_posting.get_domestic_tracking_numbers()
        if new_tracking_numbers != old_tracking_numbers:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新国内单号",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "domestic_tracking_numbers": {
                        "old": old_tracking_numbers,
                        "new": new_tracking_numbers
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

        # 4.2 记录操作状态变更
        if new_posting.operation_status != old_operation_status:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="订单状态变更",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "operation_status": {
                        "old": old_operation_status,
                        "new": new_posting.operation_status
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id,
                notes="填写国内单号触发"
            )

        # 4.3 记录其他信息变更（订单备注）
        if new_posting.order_notes != old_order_notes:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="更新订单其他信息",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "order_notes": {
                        "old": old_order_notes,
                        "new": new_posting.order_notes
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id
            )

    except Exception as e:
        # 审计日志失败不影响主流程
        logger.error(f"填写国内单号审计日志记录失败 {posting_number}: {str(e)}")

    return result


@router.patch("/postings/{posting_number}/domestic-tracking")
async def update_domestic_tracking(
    posting_number: str,
    dto: UpdateDomesticTrackingDTO,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    更新国内物流单号列表（需要操作员权限）

    用于扫描单号界面修正错误的国内单号

    操作说明：
    - 传入完整的国内单号列表，会**替换**现有的所有单号
    - 支持编辑、删除、添加单号
    - 如果清空所有国内单号（传空列表），会自动将 operation_status 改为 "allocated"（已分配）

    Args:
        posting_number: 货件编号
        dto: 包含完整的国内单号列表

    Returns:
        更新结果
    """
    from ef_core.services.audit_service import AuditService
    from sqlalchemy.orm import selectinload

    try:
        # 1. 查询 posting（预加载 domestic_trackings 关系）
        result = await db.execute(
            select(OzonPosting)
            .options(selectinload(OzonPosting.domestic_trackings))
            .where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

        # 保存旧值（用于日志）
        old_tracking_numbers = posting.get_domestic_tracking_numbers()
        old_operation_status = posting.operation_status

        # 2. 删除旧的国内单号记录
        await db.execute(
            OzonDomesticTracking.__table__.delete().where(
                OzonDomesticTracking.posting_id == posting.id
            )
        )

        # 3. 插入新的国内单号记录（过滤空字符串，统一转大写）
        valid_numbers = [n.strip().upper() for n in dto.domestic_tracking_numbers if n.strip()]
        for tracking_number in valid_numbers:
            new_tracking = OzonDomesticTracking(
                posting_id=posting.id,
                tracking_number=tracking_number,
                created_at=utcnow()
            )
            db.add(new_tracking)

        # 4. 更新反范式化字段和状态
        posting.has_domestic_tracking = len(valid_numbers) > 0
        if len(valid_numbers) == 0:
            posting.operation_status = "allocated"
            logger.info(f"清空国内单号，将状态改为已分配: {posting_number}")

        await db.commit()

        logger.info(f"更新国内单号成功: {posting_number}, 单号数量: {len(valid_numbers)}")

        # 5. 记录审计日志（字段级）
        request_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        request_id = request.headers.get("x-request-id")

        try:
            # 5.1 记录国内单号变更
            if valid_numbers != old_tracking_numbers:
                await AuditService.log_action(
                    db=db,
                    user_id=current_user.id,
                    username=current_user.username,
                    module="ozon",
                    action="update",
                    action_display="更新国内单号",
                    table_name="ozon_postings",
                    record_id=posting_number,
                    changes={
                        "domestic_tracking_numbers": {
                            "old": old_tracking_numbers,
                            "new": valid_numbers
                        }
                    },
                    ip_address=request_ip,
                    user_agent=user_agent,
                    request_id=request_id
                )

            # 5.2 记录操作状态变更（清空单号时）
            if posting.operation_status != old_operation_status:
                await AuditService.log_action(
                    db=db,
                    user_id=current_user.id,
                    username=current_user.username,
                    module="ozon",
                    action="update",
                    action_display="订单状态变更",
                    table_name="ozon_postings",
                    record_id=posting_number,
                    changes={
                        "operation_status": {
                            "old": old_operation_status,
                            "new": posting.operation_status
                        }
                    },
                    ip_address=request_ip,
                    user_agent=user_agent,
                    request_id=request_id,
                    notes="清空国内单号触发"
                )

        except Exception as e:
            # 审计日志失败不影响主流程
            logger.error(f"更新国内单号审计日志记录失败 {posting_number}: {str(e)}")

        return {
            "success": True,
            "message": "国内单号更新成功",
            "data": {
                "posting_number": posting_number,
                "domestic_tracking_numbers": valid_numbers
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新国内单号失败: {str(e)}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")


@router.post("/packing/postings/{posting_number}/discard")
async def discard_posting(
    posting_number: str,
    dto: DiscardPostingDTO,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    废弃订单（需要操作员权限）

    流程说明:
    1. 验证 posting 是否存在
    2. 更新本地状态为取消

    Args:
        posting_number: 发货单号
        dto: 废弃原因（可选）

    Returns:
        废弃结果
    """
    from ...services.posting_operations import PostingOperationsService
    from ef_core.services.audit_service import AuditService

    try:
        # 1. 查询旧值
        old_posting_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        old_posting = old_posting_result.scalar_one_or_none()

        if not old_posting:
            raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

        old_operation_status = old_posting.operation_status

        # 2. 执行业务逻辑
        service = PostingOperationsService(db)
        result = await service.discard_posting_async(
            posting_number=posting_number
        )

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        # 3. 查询新值
        new_posting_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        new_posting = new_posting_result.scalar_one_or_none()

        # 4. 记录审计日志
        request_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        request_id = request.headers.get("x-request-id")

        try:
            if new_posting and new_posting.operation_status != old_operation_status:
                await AuditService.log_action(
                    db=db,
                    user_id=current_user.id,
                    username=current_user.username,
                    module="ozon",
                    action="update",
                    action_display="订单状态变更",
                    table_name="ozon_postings",
                    record_id=posting_number,
                    changes={
                        "operation_status": {
                            "old": old_operation_status,
                            "new": new_posting.operation_status
                        }
                    },
                    ip_address=request_ip,
                    user_agent=user_agent,
                    request_id=request_id,
                    notes="废弃订单触发"
                )
        except Exception as e:
            # 审计日志失败不影响主流程
            logger.error(f"废弃订单审计日志记录失败 {posting_number}: {str(e)}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"废弃订单失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"废弃订单失败: {str(e)}")


@router.post("/packing/postings/{posting_number}/mark-printed")
async def mark_posting_printed(
    posting_number: str,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("sub_account"))
):
    """
    将货件标记为"已打印"状态（需要操作员权限）

    条件检查：
    - posting 必须存在
    - ozon_status 必须是 'awaiting_deliver'
    """
    from ef_core.services.audit_service import AuditService

    try:
        # 查询 posting
        result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

        # 检查状态
        if posting.status != 'awaiting_deliver':
            raise HTTPException(
                status_code=422,
                detail=f"只能标记'等待发运'状态的订单为已打印，当前状态：{posting.status}"
            )

        # 已打印是单号确认的下一步状态，允许 tracking_confirmed → printed
        # 如果已经是 printed，则幂等返回成功
        if posting.operation_status == 'printed':
            return {
                "success": True,
                "message": "该订单已是已打印状态",
                "data": {
                    "posting_number": posting.posting_number,
                    "operation_status": posting.operation_status,
                    "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
                }
            }

        # 保存旧值（用于日志）
        old_operation_status = posting.operation_status

        # 更新状态
        posting.operation_status = 'printed'
        posting.operation_time = utcnow()

        await db.commit()
        await db.refresh(posting)

        # 保存需要返回的值（避免在审计日志commit后访问过期对象）
        saved_operation_status = posting.operation_status
        saved_operation_time = posting.operation_time

        logger.info(f"货件 {posting_number} 已标记为已打印状态")

        # 记录审计日志
        request_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        request_id = request.headers.get("x-request-id")

        try:
            await AuditService.log_action(
                db=db,
                user_id=current_user.id,
                username=current_user.username,
                module="ozon",
                action="update",
                action_display="订单状态变更",
                table_name="ozon_postings",
                record_id=posting_number,
                changes={
                    "operation_status": {
                        "old": old_operation_status,
                        "new": saved_operation_status
                    }
                },
                ip_address=request_ip,
                user_agent=user_agent,
                request_id=request_id,
                notes="手动标记已打印"
            )
        except Exception as e:
            # 审计日志失败不影响主流程
            logger.error(f"标记已打印审计日志记录失败 {posting_number}: {str(e)}")

        return {
            "success": True,
            "message": "已标记为已打印",
            "data": {
                "posting_number": posting_number,
                "operation_status": saved_operation_status,
                "operation_time": saved_operation_time.isoformat() if saved_operation_time else None
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"标记已打印失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"操作失败: {str(e)}")


