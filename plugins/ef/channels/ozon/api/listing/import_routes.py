"""
商品创建/导入 API 路由
"""

import logging
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

from ...api.client import OzonAPIClient
from ...models import OzonShop
from ...services.product_import_service import ProductImportService

router = APIRouter(tags=["ozon-listing-import"])
logger = logging.getLogger(__name__)


async def get_ozon_client(shop_id: int, db: AsyncSession) -> OzonAPIClient:
    """获取OZON API客户端"""
    shop = await db.scalar(select(OzonShop).where(OzonShop.id == shop_id))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc)


@router.get("/listings/logs/products")
async def get_product_import_logs(
    shop_id: int = Query(..., description="店铺ID"),
    offer_id: Optional[str] = Query(None, description="商品Offer ID"),
    state: Optional[str] = Query(None, description="状态过滤"),
    limit: int = Query(50, le=200, description="返回数量限制"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品导入日志
    """
    try:
        client = await get_ozon_client(shop_id, db)
        product_service = ProductImportService(client, db)

        logs = await product_service.get_import_logs(
            shop_id=shop_id,
            offer_id=offer_id,
            state=state,
            limit=limit
        )

        return {
            "success": True,
            "data": [
                {
                    "id": log.id,
                    "offer_id": log.offer_id,
                    "import_mode": log.import_mode,
                    "state": log.state,
                    "task_id": log.task_id,
                    "ozon_product_id": log.ozon_product_id,
                    "ozon_sku": log.ozon_sku,
                    "error_code": log.error_code,
                    "error_message": log.error_message,
                    "errors": log.errors,
                    "retry_count": log.retry_count,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                    "updated_at": log.updated_at.isoformat() if log.updated_at else None
                }
                for log in logs
            ],
            "total": len(logs)
        }

    except Exception as e:
        logger.error(f"Get product import logs failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/products/create")
async def create_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    上架商品到OZON（需要操作员权限）

    流程：
    1. 先调用OZON API验证并提交商品
    2. API成功后保存到数据库
    3. 返回task_id用于后续轮询状态

    这样可以立即反馈OZON API的验证错误给前端
    """
    try:
        from ...models.products import OzonProduct

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        # 必填字段
        offer_id = request.get("offer_id")
        title = request.get("title")
        category_id = request.get("category_id")

        if not offer_id or not title:
            raise HTTPException(status_code=400, detail="offer_id and title are required")

        if not category_id:
            raise HTTPException(status_code=400, detail="category_id is required")

        # 验证 category_id 必须是大于0的整数（OZON API要求type_id > 0）
        try:
            category_id = int(category_id)
            if category_id <= 0:
                raise HTTPException(status_code=400, detail="category_id must be greater than 0")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="category_id must be a valid integer")

        # 检查offer_id是否已存在
        existing = await db.scalar(
            select(OzonProduct).where(
                OzonProduct.shop_id == shop_id,
                OzonProduct.offer_id == offer_id
            )
        )

        if existing:
            return {
                "success": False,
                "error": f"Product with offer_id '{offer_id}' already exists"
            }

        # 获取属性列表，自动添加"类型"属性（attribute_id=8229）
        attributes = request.get("attributes", [])

        # 记录收到的请求数据（调试用）
        logger.info(
            f"Create product request: offer_id={offer_id}, category_id={category_id}, "
            f"type_id={request.get('type_id')}, has_dimensions={bool(request.get('height'))}"
        )

        # 如果选择了类目且属性中没有"类型"（8229），自动添加
        has_type_attr = any(attr.get("id") == 8229 or attr.get("attribute_id") == 8229 for attr in attributes)
        if not has_type_attr:
            attributes.append({
                "id": 8229,
                "complex_id": 0,
                "values": [{"value": str(category_id)}]
            })

        # 构建 OZON API payload
        # description_category_id = 父类目ID（第2层）
        # type_id = 叶子类目ID（第3层）
        type_id = category_id  # 叶子类目ID

        # 优先使用前端传递的 description_category_id（避免数据库查询）
        description_category_id = request.get("description_category_id")

        if not description_category_id:
            # 如果前端未传递，则查询数据库获取（向后兼容）
            from ...models.listing import OzonCategory
            category = await db.scalar(
                select(OzonCategory).where(OzonCategory.category_id == category_id)
            )
            if not category:
                return {
                    "success": False,
                    "error": f"类目ID {category_id} 不存在，请刷新类目树后重试"
                }
            if not category.parent_id:
                return {
                    "success": False,
                    "error": "所选类目无父类目（parent_id为空），请选择正确的叶子类目"
                }
            description_category_id = category.parent_id
            logger.info(f"从数据库查询到 description_category_id={description_category_id}")
        else:
            logger.info(f"使用前端传递的 description_category_id={description_category_id}")

        payload = {
            "offer_id": offer_id,
            "name": title,
            "price": str(request["price"]) if request.get("price") else "0",
            "vat": request.get("vat", "0"),
            "description_category_id": description_category_id,  # 父类目ID（第2层）
            "type_id": type_id,  # 叶子类目ID（第3层，必填）
            "images": request.get("images", []),
            "attributes": attributes,
        }

        # old_price 只在有值时添加
        if request.get("old_price"):
            payload["old_price"] = str(request["old_price"])

        # 可选字段
        if request.get("description"):
            payload["description"] = request.get("description")
        if request.get("barcode"):
            payload["barcode"] = request.get("barcode")

        # v3 API要求尺寸和重量（必填）
        # 验证必填字段
        missing_fields = []
        if not request.get("height"):
            missing_fields.append("高度")
        if not request.get("width"):
            missing_fields.append("宽度")
        if not request.get("depth"):
            missing_fields.append("深度")
        if not request.get("weight"):
            missing_fields.append("重量")

        if missing_fields:
            return {
                "success": False,
                "error": f"请填写必填字段: {', '.join(missing_fields)}"
            }

        # 设置尺寸和重量（前端已传递正确单位：mm 和 g）
        payload["height"] = int(float(request["height"]))
        payload["width"] = int(float(request["width"]))
        payload["depth"] = int(float(request["depth"]))
        payload["dimension_unit"] = request.get("dimension_unit", "mm")
        payload["weight"] = int(float(request["weight"]))
        payload["weight_unit"] = request.get("weight_unit", "g")

        if request.get("currency_code"):
            payload["currency_code"] = request.get("currency_code")

        # 记录发送的payload（调试用）
        logger.info(f"Sending payload to OZON API: {payload}")

        # Step 1: 先调用 OZON API 验证并提交
        client = await get_ozon_client(shop_id, db)
        try:
            response = await client.import_products(products=[payload])

            logger.info(f"OZON API response: {response}")

            if not response.get("result"):
                # OZON 400错误的响应结构：
                # {
                #   "code": 400,
                #   "message": "错误描述",
                #   "details": [{"typeUrl": "...", "value": "..."}]
                # }
                # 或者正常错误响应：
                # {
                #   "error": {"code": "...", "message": "..."}
                # }

                # 先尝试读取根级别的错误（400错误）
                if "code" in response and "message" in response:
                    error_code = response.get("code")
                    error_msg = response.get("message", "Unknown error")
                    error_details = response.get("details", [])
                else:
                    # 否则尝试从error字段读取
                    error_info = response.get("error", {})
                    error_code = error_info.get("code", "")
                    error_msg = error_info.get("message", "Unknown error")
                    error_details = error_info.get("details", [])

                logger.error(
                    f"OZON API validation failed: code={error_code}, message={error_msg}, details={error_details}"
                )

                return {
                    "success": False,
                    "error": f"OZON验证失败: {error_msg}",
                    "error_code": error_code,
                    "error_details": error_details
                }

            task_id = response["result"].get("task_id")
            if not task_id:
                return {
                    "success": False,
                    "error": "OZON API返回缺少task_id"
                }

            logger.info(f"OZON API success, task_id={task_id}")

        except Exception as e:
            logger.error(f"OZON API call failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"OZON API调用失败: {str(e)}"
            }

        # Step 2: API成功后才保存到数据库
        product = OzonProduct(
            shop_id=shop_id,
            offer_id=offer_id,
            title=title,
            description=request.get("description"),
            price=Decimal(str(request["price"])) if request.get("price") else None,
            old_price=Decimal(str(request["old_price"])) if request.get("old_price") else None,
            premium_price=Decimal(str(request["premium_price"])) if request.get("premium_price") else None,
            currency_code=request.get("currency_code", "RUB"),
            barcode=request.get("barcode"),
            category_id=category_id,
            type_id=type_id,  # 叶子类目ID（第3层）
            description_category_id=description_category_id,  # 父类目ID（第2层）
            images=request.get("images", []),  # JSONB field
            images360=request.get("images360"),  # 360度全景图
            color_image=request.get("color_image"),  # 颜色营销图
            videos=request.get("videos", []),  # JSONB field [{url, name, is_cover}]
            pdf_list=request.get("pdf_list"),  # PDF文档列表
            attributes=attributes,  # JSONB field（已自动添加"类型"属性）
            ozon_variants=request.get("variants"),  # OZON原始变体数据
            promotions=request.get("promotions"),  # 促销活动ID数组
            height=request.get("height"),
            width=request.get("width"),
            depth=request.get("depth"),
            dimension_unit=request.get("dimension_unit", "mm"),
            weight=request.get("weight"),
            weight_unit=request.get("weight_unit", "g"),
            vat=request.get("vat", "0"),
            # 采购信息（仅保存到本地，不提交OZON）
            purchase_url=request.get("purchase_url"),
            suggested_purchase_price=(
                Decimal(str(request["suggested_purchase_price"]))
                if request.get("suggested_purchase_price") else None
            ),
            purchase_note=request.get("purchase_note"),
            listing_status="import_submitted",  # 已提交到OZON
            listing_mode="NEW_CARD",
            import_submitted_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        db.add(product)
        await db.commit()
        await db.refresh(product)

        logger.info(f"Product created and submitted to OZON: offer_id={offer_id}, id={product.id}, task_id={task_id}")

        # 创建或更新上架记录
        from ...models.collection_record import OzonProductCollectionRecord

        source_record_id = request.get("source_record_id")

        if source_record_id:
            # 编辑上架：更新原采集记录
            collection_record = await db.scalar(
                select(OzonProductCollectionRecord).where(
                    OzonProductCollectionRecord.id == source_record_id
                )
            )
            if collection_record:
                collection_record.listing_status = "success"
                collection_record.listing_source = "edit"
                collection_record.listing_product_id = product.id
                collection_record.listing_at = datetime.utcnow()
                collection_record.listing_error_message = None
                logger.info(f"Updated collection record {source_record_id} as edit listing")
        else:
            # 手动上架：创建新的上架记录，包含提交到 OZON API 的所有字段
            new_record = OzonProductCollectionRecord(
                user_id=current_user.id,
                shop_id=shop_id,
                collection_type="follow_pdp",  # 复用类型，通过 listing_source 区分
                source_url="",  # 手动上架没有来源URL
                product_data={
                    # 基本信息
                    "title": title,
                    "offer_id": offer_id,
                    "description": request.get("description"),
                    "barcode": request.get("barcode"),
                    # 价格信息
                    "price": float(request["price"]) if request.get("price") else None,
                    "old_price": float(request["old_price"]) if request.get("old_price") else None,
                    "premium_price": float(request["premium_price"]) if request.get("premium_price") else None,
                    "currency_code": request.get("currency_code", "RUB"),
                    "vat": request.get("vat", "0"),
                    # 类目信息
                    "category_id": category_id,
                    "type_id": type_id,
                    "description_category_id": description_category_id,
                    # 媒体资源
                    "images": request.get("images", []),
                    "images360": request.get("images360"),
                    "color_image": request.get("color_image"),
                    "videos": request.get("videos", []),
                    "pdf_list": request.get("pdf_list"),
                    # 尺寸和重量
                    "height": request.get("height"),
                    "width": request.get("width"),
                    "depth": request.get("depth"),
                    "dimension_unit": request.get("dimension_unit", "mm"),
                    "weight": request.get("weight"),
                    "weight_unit": request.get("weight_unit", "g"),
                    # 属性和变体
                    "attributes": attributes,
                    "variants": request.get("variants"),
                    # 促销活动
                    "promotions": request.get("promotions"),
                    # 采购信息
                    "purchase_url": request.get("purchase_url"),
                    "suggested_purchase_price": float(request["suggested_purchase_price"]) if request.get("suggested_purchase_price") else None,
                    "purchase_note": request.get("purchase_note"),
                },
                listing_status="success",
                listing_source="manual",
                listing_product_id=product.id,
                listing_at=datetime.utcnow(),
            )
            db.add(new_record)
            logger.info(f"Created new collection record for manual listing: offer_id={offer_id}")

        await db.commit()

        return {
            "success": True,
            "data": {
                "id": product.id,
                "offer_id": product.offer_id,
                "title": product.title,
                "listing_status": product.listing_status,
                "task_id": task_id  # 返回task_id供前端轮询
            },
            "message": "商品已提交到OZON，正在处理中..."
        }

    except Exception as e:
        logger.error(f"Create product failed: {e}", exc_info=True)
        await db.rollback()
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/import-status/{task_id}")
async def get_product_import_status(
    task_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    查询商品导入状态（前端轮询使用）

    Args:
        task_id: OZON导入任务ID
        shop_id: 店铺ID

    Returns:
        {
            "success": true,
            "status": "imported" | "failed" | "processing" | "pending",
            "product_id": OZON商品ID（成功时）,
            "sku": OZON SKU（成功时）,
            "errors": 错误列表（失败时）,
            "message": 状态说明
        }
    """
    try:
        from ...models.products import OzonProduct
        from ...services.draft_template_service import DraftTemplateService

        # 调用OZON API查询任务状态
        client = await get_ozon_client(shop_id, db)
        response = await client.get_import_product_info(task_id)

        # 记录OZON API返回的原始数据（调试用）
        logger.info(f"[DEBUG] OZON import status response for task_id={task_id}: {response}")

        if not response.get("result"):
            error_msg = response.get("error", {}).get("message", "Unknown error")
            logger.error(f"Failed to query import task: task_id={task_id}, error={error_msg}")
            return {
                "success": False,
                "error": f"查询导入状态失败: {error_msg}"
            }

        result = response["result"]
        items = result.get("items", [])

        if not items:
            # 任务还在队列中，尚未开始处理
            return {
                "success": True,
                "status": "pending",
                "message": "任务排队中..."
            }

        # 取第一个商品的状态（单商品导入只有一个）
        item = items[0]
        logger.info(f"[DEBUG] First item in import status: {item}")
        status = item.get("status", "").lower()
        offer_id = item.get("offer_id")

        if status == "imported":
            # 导入成功，更新数据库
            product_id = item.get("product_id")
            sku = item.get("sku")

            if offer_id:
                # 查找并更新商品记录
                product = await db.scalar(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.offer_id == offer_id
                    )
                )

                if product:
                    product.ozon_product_id = product_id
                    product.ozon_sku = sku
                    product.listing_status = "created"  # 商品已创建
                    product.ozon_created_at = datetime.utcnow()
                    product.updated_at = datetime.utcnow()
                    await db.commit()

                    logger.info(f"Product import completed: offer_id={offer_id}, product_id={product_id}, sku={sku}")

                    # 商品成功上架后，删除对应的草稿
                    try:
                        # 获取最新草稿
                        draft = await DraftTemplateService.get_latest_draft(db, current_user.id)
                        if draft:
                            # 删除草稿
                            deleted = await DraftTemplateService.delete_draft(db, current_user.id, draft.id)
                            if deleted:
                                logger.info(
                                    f"Draft deleted after successful import: draft_id={draft.id}, offer_id={offer_id}"
                                )
                            else:
                                logger.warning(
                                    f"Failed to delete draft after import: draft_id={draft.id}, offer_id={offer_id}"
                                )
                    except Exception as e:
                        # 删除草稿失败不影响商品导入成功的结果
                        logger.error(f"Error deleting draft after import: {e}", exc_info=True)

            return {
                "success": True,
                "status": "imported",
                "product_id": product_id,
                "sku": sku,
                "offer_id": offer_id,
                "message": "商品导入成功！"
            }

        elif status == "failed":
            # 导入失败
            errors = item.get("errors", [])
            error_messages = [f"{e.get('code', '')}: {e.get('message', '')}" for e in errors]

            if offer_id:
                # 更新商品状态为失败
                product = await db.scalar(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.offer_id == offer_id
                    )
                )

                if product:
                    product.listing_status = "error"
                    product.listing_error_message = "; ".join(error_messages) if error_messages else "Unknown error"
                    product.updated_at = datetime.utcnow()
                    await db.commit()

            logger.error(f"Product import failed: offer_id={offer_id}, errors={errors}")

            return {
                "success": False,
                "status": "failed",
                "errors": errors,
                "error_messages": error_messages,
                "offer_id": offer_id,
                "message": "商品导入失败: " + ("; ".join(error_messages) if error_messages else "未知错误")
            }

        elif status in ["processing", "pending"]:
            # 仍在处理中
            return {
                "success": True,
                "status": status,
                "offer_id": offer_id,
                "message": "商品正在处理中，请稍候..."
            }

        else:
            # 未知状态
            logger.warning(f"Unknown import status: {status}, item={item}")
            return {
                "success": True,
                "status": "unknown",
                "raw_status": status,
                "offer_id": offer_id,
                "message": f"未知状态: {status}"
            }

    except Exception as e:
        logger.error(f"Get product import status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }
