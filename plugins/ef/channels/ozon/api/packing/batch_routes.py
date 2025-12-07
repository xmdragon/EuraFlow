"""
打包发货 - 批量操作路由
包括：批量备货、批量打印标签等
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ...models import OzonPosting, OzonShop
from ...utils.datetime_utils import utcnow

router = APIRouter(tags=["ozon-packing"])
logger = logging.getLogger(__name__)

@router.post("/orders/prepare")
async def prepare_order(
    posting_number: str = Body(..., description="发货单号"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    提交备货请求（FBS订单备货流程）（需要操作员权限）

    流程说明:
    1. 更新posting的operation_time为当前时间
    2. 设置exemplar信息（样件信息）
    3. 验证exemplar
    4. 获取备货状态

    Args:
        posting_number: 发货单号

    Returns:
        备货结果，包含状态信息
    """
    from datetime import datetime, timezone
    from ...models import OzonPosting
    from sqlalchemy import select, update

    try:
        # 1. 获取posting记录
        result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "error": "POSTING_NOT_FOUND",
                "message": f"发货单 {posting_number} 不存在"
            }

        # 2. 检查状态是否为等待备货
        if posting.status != "awaiting_packaging":
            return {
                "success": False,
                "error": "INVALID_STATUS",
                "message": f"当前状态为 {posting.status}，无法执行备货操作"
            }

        # 3. 更新operation_time
        current_time = datetime.now(timezone.utc)
        await db.execute(
            update(OzonPosting)
            .where(OzonPosting.id == posting.id)
            .values(operation_time=current_time)
        )
        await db.commit()

        # 4. 获取店铺API凭证
        from ...models import OzonShop
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.id == posting.shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "error": "SHOP_NOT_FOUND",
                "message": "店铺信息不存在"
            }

        # 5. 调用OZON API进行备货
        from ..client import OzonAPIClient

        async with OzonAPIClient(shop.client_id, shop.api_key, shop.id) as client:
            # 从raw_payload中提取商品信息
            products_data = []
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product in posting.raw_payload['products']:
                    # 构建简化的exemplar数据（标记GTD和RNPT为缺失）
                    products_data.append({
                        "product_id": product.get('product_id', 0),
                        "exemplars": [{
                            "is_gtd_absent": True,  # 标记无GTD
                            "is_rnpt_absent": True,  # 标记无RNPT
                            "marks": []  # 空标记列表
                        }]
                    })

            # 如果没有商品数据，返回错误
            if not products_data:
                return {
                    "success": False,
                    "error": "NO_PRODUCTS",
                    "message": "发货单中没有找到商品信息"
                }

            # 设置exemplar
            await client.set_exemplar(posting_number, products_data)

            # 验证exemplar
            await client.validate_exemplar(posting_number, products_data)

            # 获取备货状态
            status_result = await client.get_exemplar_status(posting_number)

            # 检查状态
            status = status_result.get('status')
            if status == 'ship_available':
                message = "备货成功，订单可以发货"
            elif status == 'validation_in_process':
                message = "样件验证中，请稍后查看状态"
            else:
                message = "备货失败，无法发货"

            return {
                "success": True,
                "message": message,
                "data": {
                    "posting_number": posting_number,
                    "operation_time": current_time.isoformat(),
                    "status": status,
                    "products": status_result.get('products', [])
                }
            }

    except Exception as e:
        logger.error(f"备货失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "success": False,
            "error": "PREPARE_FAILED",
            "message": f"备货失败: {str(e)}"
        }


class BatchPrintRequest(BaseModel):
    """批量打印请求"""
    posting_numbers: List[str] = Field(..., max_items=20, description="货件编号列表（最多20个）")
    weights: Optional[Dict[str, int]] = Field(None, description="各货件的包装重量，key为posting_number，value为重量(克)")


@router.post("/packing/postings/batch-print-labels")
async def batch_print_labels(
    request: Request,
    body: BatchPrintRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    批量打印快递面单（最多20个）（需要操作员权限）

    调试日志：记录接收到的请求

    标签格式: 70mm宽 × 125mm高（竖向）

    说明：shop_id从posting记录中自动获取，无需手动指定

    状态要求：
    - OZON状态必须是 'awaiting_deliver'（等待发运）
    - 操作状态必须是 'tracking_confirmed'（单号确认）或 'printed'（已打印，允许重新打印）

    错误处理策略：
    1. 预检查：检查每个posting的缓存状态
    2. 逐个调用：避免一个失败导致全部失败
    3. 详细错误：返回具体哪些posting_number失败及原因

    Returns:
        成功：
        {
            "success": true,
            "pdf_url": "/downloads/labels/batch_xxx.pdf",
            "cached_count": 5,
            "fetched_count": 3,
            "total": 8
        }

        部分失败：
        {
            "success": false,
            "error": "PARTIAL_FAILURE",
            "message": "部分订单打印失败",
            "failed_postings": [
                {
                    "posting_number": "12345-0001-1",
                    "error": "标签未就绪",
                    "suggestion": "请在45-60秒后重试"
                }
            ],
            "success_postings": ["11111-0003-1"],
            "pdf_url": "/downloads/labels/batch_xxx.pdf"
        }
    """
    import os
    import base64
    import uuid
    import httpx
    from datetime import datetime
    import json
    from ef_core.services.audit_service import AuditService

    # 获取请求参数
    posting_numbers = body.posting_numbers
    weights = body.weights

    # 调试日志：记录接收到的 posting_numbers
    logger.info(f"📝 批量打印标签请求 - posting_numbers: {posting_numbers}, weights: {weights}")

    try:
        # 1. 验证请求参数
        if not posting_numbers:
            raise HTTPException(status_code=400, detail="posting_numbers不能为空")

        if len(posting_numbers) > 20:
            raise HTTPException(status_code=400, detail="最多支持20个货件")

        # 2. 查询所有posting，检查缓存状态和获取shop_id
        postings_result = await db.execute(
            select(OzonPosting).where(
                OzonPosting.posting_number.in_(posting_numbers)
            )
        )
        postings = {p.posting_number: p for p in postings_result.scalars().all()}

        # 调试日志：记录查询到的 posting 数量
        logger.info(f"📦 查询结果 - 请求{len(posting_numbers)}个, 找到{len(postings)}个")
        logger.info(f"📦 找到的 posting_numbers: {list(postings.keys())}")

        # 找出缺失的 posting_numbers
        missing_postings = [pn for pn in posting_numbers if pn not in postings]
        if missing_postings:
            logger.warning(f"⚠️ 数据库中不存在的 posting_numbers: {missing_postings}")

        # 验证所有posting是否存在
        if not postings:
            raise HTTPException(status_code=404, detail="未找到任何货件记录")

        # 3. 验证所有posting的状态必须为"awaiting_deliver"（等待发运）
        # 并且 operation_status 必须是 tracking_confirmed（运单号已确认才能打印标签）
        invalid_status_postings = []
        for pn in posting_numbers:
            posting = postings.get(pn)
            if not posting:
                continue

            # 检查 OZON 状态
            if posting.status != 'awaiting_deliver':
                invalid_status_postings.append({
                    "posting_number": pn,
                    "current_status": posting.status,
                    "status_display": {
                        "awaiting_packaging": "等待备货",
                        "awaiting_deliver": "等待发运",
                        "sent_by_seller": "已准备发运",
                        "delivering": "运输中",
                        "delivered": "已签收",
                        "cancelled": "已取消"
                    }.get(posting.status, posting.status)
                })
                continue

            # 检查操作状态：必须先确认运单号才能打印标签（允许已打印状态重新打印）
            if posting.operation_status not in ('tracking_confirmed', 'printed'):
                invalid_status_postings.append({
                    "posting_number": pn,
                    "current_status": f"运单号未确认 ({posting.operation_status or '未设置'})",
                    "status_display": "请先确认运单号后再打印标签"
                })

        if invalid_status_postings:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "INVALID_STATUS",
                    "message": "只能打印'等待发运'且已确认运单号（或已打印）的订单标签",
                    "invalid_postings": invalid_status_postings
                }
            )

        # 4. 获取所有涉及的店铺信息
        shop_ids = {p.shop_id for p in postings.values()}
        shops_result = await db.execute(
            select(OzonShop).where(OzonShop.id.in_(shop_ids))
        )
        shops = {s.id: s for s in shops_result.scalars().all()}

        # 检查是否所有店铺都存在
        missing_shops = shop_ids - set(shops.keys())
        if missing_shops:
            raise HTTPException(status_code=404, detail=f"店铺不存在: {missing_shops}")

        logger.info(f"批量打印涉及 {len(shops)} 个店铺: {list(shops.keys())}")

        # 5. 分类：有缓存 vs 无缓存
        cached_postings = []
        need_fetch_postings = []

        for pn in posting_numbers:
            posting = postings.get(pn)
            if not posting:
                # posting不存在，记录到need_fetch中（后续会报错）
                need_fetch_postings.append(pn)
                continue

            # 检查缓存文件是否存在
            if posting.label_pdf_path and os.path.exists(posting.label_pdf_path):
                cached_postings.append(pn)
            else:
                need_fetch_postings.append(pn)

        logger.info(f"批量打印: 总{len(posting_numbers)}个, 缓存{len(cached_postings)}个, 需获取{len(need_fetch_postings)}个")

        # 5. 调用OZON API获取未缓存的标签（逐个尝试，捕获错误）
        failed_postings = []
        success_postings = []
        pdf_files = []

        # 5.1 添加已缓存的PDF（并记录打印）
        for pn in cached_postings:
            posting = postings.get(pn)
            if posting and posting.label_pdf_path:
                pdf_files.append(posting.label_pdf_path)
                success_postings.append(pn)

                # 更新打印追踪字段
                if posting.label_printed_at is None:
                    posting.label_printed_at = utcnow()
                posting.label_print_count = (posting.label_print_count or 0) + 1

        # 5.2 获取未缓存的标签（逐个调用，避免一个失败影响全部）
        from ..client import OzonAPIClient
        from ...services.label_service import LabelService

        label_service = LabelService(db)

        # 按店铺分组，为每个店铺创建 API 客户端
        api_clients: Dict[int, OzonAPIClient] = {}

        for pn in need_fetch_postings:
            # 检查posting是否存在
            posting = postings.get(pn)
            if not posting:
                failed_postings.append({
                    "posting_number": pn,
                    "error": "货件不存在",
                    "suggestion": "请检查货件编号是否正确"
                })
                continue

            # 获取或创建该店铺的 API 客户端
            shop_id = posting.shop_id
            if shop_id not in api_clients:
                shop = shops[shop_id]
                api_clients[shop_id] = OzonAPIClient(shop.client_id, shop.api_key_enc, shop.id)

            client = api_clients[shop_id]

            try:
                # 使用标签服务下载并保存PDF
                download_result = await label_service.download_and_save_label(
                    posting_number=pn,
                    api_client=client,
                    force=False  # 不强制重新下载
                )

                if not download_result["success"]:
                    raise ValueError(download_result.get("error", "未知错误"))

                pdf_files.append(download_result["pdf_path"])
                success_postings.append(pn)

                # 更新打印追踪字段
                if posting.label_printed_at is None:
                    posting.label_printed_at = utcnow()
                posting.label_print_count = (posting.label_print_count or 0) + 1

            except httpx.HTTPStatusError as e:
                # 捕获HTTP错误，解析OZON API返回的错误信息
                error_detail = "未知错误"
                suggestion = "请稍后重试"

                try:
                    error_data = e.response.json() if e.response else {}
                    error_message = error_data.get('message', '') or str(e)

                    # 解析常见错误
                    if 'aren\'t ready' in error_message.lower() or 'not ready' in error_message.lower():
                        error_detail = "标签未就绪"
                        suggestion = "请在订单装配后45-60秒重试"
                    elif 'not found' in error_message.lower():
                        error_detail = "货件不存在"
                        suggestion = "订单可能已取消或不存在"
                    elif 'invalid' in error_message.lower():
                        error_detail = "货件编号无效"
                        suggestion = "请检查货件编号是否正确"
                    else:
                        error_detail = error_message[:100]  # 限制长度
                except Exception:
                    error_detail = f"HTTP {e.response.status_code if e.response else 'unknown'}"

                failed_postings.append({
                    "posting_number": pn,
                    "error": error_detail,
                    "suggestion": suggestion
                })
                logger.warning(f"获取标签失败 {pn}: {error_detail}")

            except Exception as e:
                # 安全地转换异常为字符串，避免UTF-8解码错误
                exc_type = type(e).__name__
                try:
                    # 对于httpx.HTTPStatusError，提取状态码
                    if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
                        error_msg = f"{exc_type}: HTTP {e.response.status_code}"
                    elif e.args:
                        # 安全地处理args[0]
                        arg = e.args[0]
                        if isinstance(arg, bytes):
                            error_msg = f"{exc_type}: <binary data, {len(arg)} bytes>"
                        elif isinstance(arg, str):
                            error_msg = f"{exc_type}: {arg[:100]}"
                        else:
                            error_msg = f"{exc_type}: {type(arg).__name__}"
                    else:
                        error_msg = f"{exc_type}: Unknown"
                except Exception:
                    # 如果所有方法都失败，使用安全的默认消息
                    error_msg = f"{exc_type}: <error details unavailable>"

                failed_postings.append({
                    "posting_number": pn,
                    "error": error_msg,
                    "suggestion": "请检查网络或联系技术支持"
                })
                logger.error(f"获取标签异常 {pn}: {error_msg}")

        # 关闭所有 API 客户端
        for client in api_clients.values():
            await client.close()

        # 6. 记录审计日志（批量记录所有成功打印的操作）
        request_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        request_id = request.headers.get("x-request-id")

        for pn in success_postings:
            posting = postings.get(pn)
            if posting:
                try:
                    is_reprint = (posting.label_print_count or 0) > 1
                    await AuditService.log_print(
                        db=db,
                        user_id=current_user.id,
                        username=current_user.username,
                        posting_number=pn,
                        print_count=posting.label_print_count or 1,
                        is_reprint=is_reprint,
                        ip_address=request_ip,
                        user_agent=user_agent,
                        request_id=request_id,
                    )
                except Exception as e:
                    # 审计日志失败不应阻塞主流程
                    logger.error(f"记录打印审计日志失败 {pn}: {str(e)}")

        # 更新包装重量（如果提供了weights参数）
        if weights:
            for pn in success_postings:
                posting = postings.get(pn)
                if posting and pn in weights:
                    posting.package_weight = weights[pn]
                    logger.info(f"更新包装重量 {pn}: {weights[pn]}g")

        await db.commit()

        # 7. 处理PDF文件（单个直接返回，多个合并）
        pdf_url = None
        if pdf_files:
            if len(pdf_files) == 1:
                # 单个 posting，直接返回单文件 URL（避免冗余的 batch 文件）
                from ...services.label_service import LabelService
                pdf_url = LabelService.get_label_url(success_postings[0])
                logger.info(f"单个标签打印: {pdf_url}")
            else:
                # 多个 posting，合并成 batch（但每个单独的 PDF 已保存在 labels/ 目录）
                try:
                    from PyPDF2 import PdfMerger
                    from ...services.label_service import LabelService

                    merger = PdfMerger()
                    for pdf_file in pdf_files:
                        merger.append(pdf_file)

                    # 生成批量PDF文件名
                    batch_filename = f"batch_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:8]}.pdf"
                    batch_path = f"{LabelService.get_label_dir()}/{batch_filename}"

                    # 确保目录存在
                    os.makedirs(os.path.dirname(batch_path), exist_ok=True)

                    merger.write(batch_path)
                    merger.close()

                    pdf_url = f"/downloads/labels/{batch_filename}"
                    logger.info(f"批量标签打印: 成功合并{len(pdf_files)}个PDF -> {batch_path}")
                except Exception as e:
                    logger.error(f"合并PDF失败: {e}")
                    # 合并失败不影响结果，只是没有合并后的PDF
                    pdf_url = None

        # 8. 返回结果
        if failed_postings and not success_postings:
            # 全部失败
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "ALL_FAILED",
                    "message": "所有订单打印失败",
                    "failed_postings": failed_postings
                }
            )
        elif failed_postings:
            # 部分失败
            return {
                "success": False,
                "error": "PARTIAL_FAILURE",
                "message": f"成功打印{len(success_postings)}个，失败{len(failed_postings)}个",
                "failed_postings": failed_postings,
                "success_postings": success_postings,
                "pdf_url": pdf_url,
                "cached_count": len(cached_postings),
                "fetched_count": len(success_postings) - len(cached_postings),
                "total": len(success_postings)
            }
        else:
            # 全部成功
            return {
                "success": True,
                "message": f"成功打印{len(success_postings)}个标签",
                "pdf_url": pdf_url,
                "cached_count": len(cached_postings),
                "fetched_count": len(success_postings) - len(cached_postings),
                "total": len(success_postings)
            }

    except HTTPException:
        raise
    except Exception as e:
        # 安全地记录异常（避免UTF-8解码错误）
        try:
            error_msg = str(e)
        except UnicodeDecodeError:
            error_msg = repr(e)
        except Exception:
            error_msg = "未知错误"

        logger.error(f"批量打印失败: {error_msg}")
        import traceback
        try:
            logger.error(traceback.format_exc())
        except Exception:
            pass  # traceback也可能包含二进制内容，忽略记录错误
        raise HTTPException(status_code=500, detail=f"打印失败: {error_msg}")


