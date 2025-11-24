"""
打包发货 - 同步操作路由
包括：同步物料成本到跨境巴士、同步财务信息等
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ...models import OzonPosting

router = APIRouter(tags=["ozon-packing"])
logger = logging.getLogger(__name__)


@router.post("/postings/{posting_number}/sync-material-cost")
async def sync_material_cost(
    posting_number: str,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    从跨境巴士同步单个发货单的打包费用（需要操作员权限）

    同步流程：
    1. 调用跨境巴士API获取订单信息
    2. 检查订单状态是否为"已打包"
    3. 更新 material_cost（打包费用）
    4. 更新 domestic_tracking_number（如果本地没有）
    5. 重新计算利润

    返回：
    - success: 同步是否成功
    - message: 提示信息
    - data: 更新后的字段值（material_cost、domestic_tracking_number、profit_amount_cny、profit_rate）
    """
    from ...services.posting_operations import PostingOperationsService
    from ef_core.services.audit_service import AuditService

    try:
        # 1. 查询旧值（预加载 domestic_trackings 关系）
        old_posting_result = await db.execute(
            select(OzonPosting)
            .options(selectinload(OzonPosting.domestic_trackings))
            .where(OzonPosting.posting_number == posting_number)
        )
        old_posting = old_posting_result.scalar_one_or_none()

        if not old_posting:
            raise HTTPException(status_code=404, detail=f"货件不存在: {posting_number}")

        old_material_cost = old_posting.material_cost
        old_tracking_numbers = old_posting.get_domestic_tracking_numbers()

        # 2. 执行业务逻辑
        service = PostingOperationsService(db)
        result = await service.sync_material_cost_single(posting_number)

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
            # 4.1 记录物料成本变更
            if new_posting and new_posting.material_cost != old_material_cost:
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
                    request_id=request_id,
                    notes="从跨境巴士同步"
                )

            # 4.2 记录国内单号变更（如果从跨境巴士同步了单号）
            if new_posting:
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
                        request_id=request_id,
                        notes="从跨境巴士同步"
                    )

        except Exception as e:
            # 审计日志失败不影响主流程
            logger.error(f"同步物料成本审计日志记录失败 {posting_number}: {str(e)}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"同步打包费用失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"同步失败: {str(e)}")


@router.post("/postings/{posting_number}/sync-finance")
async def sync_finance(
    posting_number: str,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    从 OZON 同步单个发货单的财务费用（需要操作员权限）

    同步流程：
    1. 调用 OZON Finance API 获取财务交易记录
    2. 计算汇率（基于 RUB 到 CNY 的转换）
    3. 提取并转换费用到 CNY
    4. 更新 ozon_commission_cny（OZON佣金）
    5. 更新 last_mile_delivery_fee_cny（末端配送费）
    6. 更新 international_logistics_fee_cny（国际物流费）
    7. 重新计算利润

    返回：
    - success: 同步是否成功
    - message: 提示信息
    - data: 更新后的字段值（ozon_commission_cny、last_mile_delivery_fee_cny、
            international_logistics_fee_cny、exchange_rate、profit_amount_cny、profit_rate）
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

        old_ozon_commission = old_posting.ozon_commission_cny
        old_last_mile_fee = old_posting.last_mile_delivery_fee_cny
        old_intl_logistics_fee = old_posting.international_logistics_fee_cny

        # 2. 执行业务逻辑
        service = PostingOperationsService(db)
        result = await service.sync_finance_single(posting_number)

        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])

        # 3. 查询新值
        new_posting_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        new_posting = new_posting_result.scalar_one_or_none()

        # 4. 记录审计日志（合并多个财务字段）
        request_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        request_id = request.headers.get("x-request-id")

        try:
            if new_posting:
                # 检查是否有任何财务字段变更
                has_changes = (
                    new_posting.ozon_commission_cny != old_ozon_commission or
                    new_posting.last_mile_delivery_fee_cny != old_last_mile_fee or
                    new_posting.international_logistics_fee_cny != old_intl_logistics_fee
                )

                if has_changes:
                    # 合并记录所有财务字段变更
                    changes = {}
                    if new_posting.ozon_commission_cny != old_ozon_commission:
                        changes["ozon_commission_cny"] = {
                            "old": str(old_ozon_commission) if old_ozon_commission else None,
                            "new": str(new_posting.ozon_commission_cny) if new_posting.ozon_commission_cny else None
                        }
                    if new_posting.last_mile_delivery_fee_cny != old_last_mile_fee:
                        changes["last_mile_delivery_fee_cny"] = {
                            "old": str(old_last_mile_fee) if old_last_mile_fee else None,
                            "new": str(new_posting.last_mile_delivery_fee_cny) if new_posting.last_mile_delivery_fee_cny else None
                        }
                    if new_posting.international_logistics_fee_cny != old_intl_logistics_fee:
                        changes["international_logistics_fee_cny"] = {
                            "old": str(old_intl_logistics_fee) if old_intl_logistics_fee else None,
                            "new": str(new_posting.international_logistics_fee_cny) if new_posting.international_logistics_fee_cny else None
                        }

                    await AuditService.log_action(
                        db=db,
                        user_id=current_user.id,
                        username=current_user.username,
                        module="ozon",
                        action="update",
                        action_display="更新财务费用",
                        table_name="ozon_postings",
                        record_id=posting_number,
                        changes=changes,
                        ip_address=request_ip,
                        user_agent=user_agent,
                        request_id=request_id,
                        notes="从OZON同步"
                    )

        except Exception as e:
            # 审计日志失败不影响主流程
            logger.error(f"同步财务费用审计日志记录失败 {posting_number}: {str(e)}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"同步财务费用失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"同步失败: {str(e)}")
