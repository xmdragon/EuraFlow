"""跨境巴士异步任务执行器

使用后台任务执行跨境巴士同步，避免阻塞主流程。
"""

import asyncio
import logging
from typing import Dict, Optional
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from .kuajing84_sync import create_kuajing84_sync_service
from .kuajing84_client import Kuajing84Client
from ..models.kuajing84 import Kuajing84SyncLog
from ..models.kuajing84_global_config import Kuajing84GlobalConfig
from ..models.orders import OzonPosting
from ef_core.websocket.manager import notification_manager

logger = logging.getLogger(__name__)


async def _send_websocket_notification(
    db: AsyncSession,
    sync_log: Kuajing84SyncLog,
    status: str,
    error_message: Optional[str] = None
):
    """
    发送 WebSocket 通知到前端

    Args:
        db: 数据库会话
        sync_log: 同步日志对象
        status: 同步状态 (success/failed)
        error_message: 错误信息（可选）
    """
    try:
        # 获取订单所属的用户（通过 shop_id）
        # 注意：这里假设同步日志有 shop_id 字段
        shop_id = sync_log.shop_id

        # 构造消息
        message_text = ""
        if status == "success":
            if sync_log.sync_type == "submit_tracking":
                message_text = f"国内单号 {sync_log.logistics_order} 已成功同步到跨境巴士"
            elif sync_log.sync_type == "discard_order":
                message_text = f"订单 {sync_log.order_number} 已成功废弃"
        else:
            if sync_log.sync_type == "submit_tracking":
                message_text = f"国内单号同步失败：{error_message or '未知错误'}"
            elif sync_log.sync_type == "discard_order":
                message_text = f"订单废弃失败：{error_message or '未知错误'}"

        notification = {
            "type": "kuajing84.sync_completed",
            "shop_id": shop_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "sync_log_id": sync_log.id,
                "sync_type": sync_log.sync_type,
                "status": status,
                "order_number": sync_log.order_number,
                "logistics_order": sync_log.logistics_order,
                "error_message": error_message,
                "message": message_text
            }
        }

        # 发送给订阅了该店铺的所有用户
        sent_count = await notification_manager.send_to_shop_users(shop_id, notification)
        logger.info(f"WebSocket通知已发送: sync_log_id={sync_log.id}, 接收连接数={sent_count}")

    except Exception as e:
        # WebSocket 发送失败不应该影响主流程
        logger.error(f"发送WebSocket通知失败: sync_log_id={sync_log.id}, error={e}")


async def async_sync_logistics_order(
    db: AsyncSession,
    sync_log_id: int,
    max_retries: int = 3
) -> None:
    """
    后台异步同步国内物流单号到跨境巴士（支持重试）

    Args:
        db: 数据库会话
        sync_log_id: 同步日志ID
        max_retries: 最大重试次数

    流程：
    1. 更新状态为 in_progress
    2. 获取有效 Cookie
    3. 查找跨境巴士订单 oid
    4. 提交物流单号
    5. 更新状态为 success/failed
    """
    start_time = datetime.now(timezone.utc)
    logger.info(f"开始异步同步任务: sync_log_id={sync_log_id}")

    try:
        # 1. 查询同步日志
        result = await db.execute(
            select(Kuajing84SyncLog).where(Kuajing84SyncLog.id == sync_log_id)
        )
        sync_log = result.scalar_one_or_none()

        if not sync_log:
            logger.error(f"同步日志不存在: sync_log_id={sync_log_id}")
            return

        # 2. 更新状态为 in_progress
        sync_log.sync_status = "in_progress"
        sync_log.started_at = start_time
        await db.commit()

        # 3. 获取跨境巴士全局配置
        config_result = await db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        global_config = config_result.scalar_one_or_none()

        if not global_config or not global_config.enabled:
            sync_log.sync_status = "failed"
            sync_log.error_message = "跨境84未配置或未启用"
            sync_log.attempts += 1
            await db.commit()
            logger.error(f"跨境84未启用: sync_log_id={sync_log_id}")
            return

        # 4. 获取跨境巴士服务（用于解密密码）
        kuajing84_service = create_kuajing84_sync_service(db)
        password = kuajing84_service._decrypt(global_config.password)

        base_url = global_config.base_url if global_config.base_url else "https://www.kuajing84.com"

        # 5. 强制重新登录并执行同步操作
        from .kuajing84_client import Kuajing84Client
        async with Kuajing84Client(base_url=base_url, timeout=60.0) as client:
            # 5.1 强制登录获取最新 Cookie
            try:
                login_result = await client.login(global_config.username, password)
                cookies = login_result["cookies"]

                # 更新数据库中的 Cookie（保持一致性）
                global_config.cookie = cookies
                global_config.cookie_expires_at = datetime.fromisoformat(login_result["expires_at"].replace("Z", "+00:00"))
                await db.commit()

                logger.info(f"跨境84强制登录成功（同步物流单号）: sync_log_id={sync_log_id}")

            except Exception as e:
                sync_log.sync_status = "failed"
                sync_log.error_message = f"登录失败: {str(e)}"
                sync_log.attempts += 1
                await db.commit()
                logger.error(f"登录跨境84失败: sync_log_id={sync_log_id}, error: {e}")
                return

            # 6. 查找跨境巴士订单 oid
            oid = await client.find_order_oid(
                order_number=sync_log.order_number,
                cookies=cookies
            )

            if not oid:
                sync_log.sync_status = "failed"
                sync_log.error_message = f"未找到订单: {sync_log.order_number}"
                sync_log.attempts += 1
                await db.commit()
                logger.error(f"未找到订单: sync_log_id={sync_log_id}, order_number={sync_log.order_number}")
                return

            # 保存 oid
            sync_log.kuajing84_oid = oid

            # 7. 提交物流单号（支持重试）
            submit_success = False
            for attempt in range(1, max_retries + 1):
                try:
                    logger.info(f"提交物流单号 (尝试 {attempt}/{max_retries}): sync_log_id={sync_log_id}")

                    submit_result = await client.submit_logistics_order(
                        oid=oid,
                        logistics_order=sync_log.logistics_order,
                        cookies=cookies
                    )

                    sync_log.attempts = attempt

                    if submit_result["success"]:
                        sync_log.sync_status = "success"
                        sync_log.synced_at = datetime.now(timezone.utc)
                        await db.commit()

                        duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
                        logger.info(f"物流单号同步成功: sync_log_id={sync_log_id}, 耗时={duration_ms:.0f}ms")

                        # 发送 WebSocket 通知
                        await _send_websocket_notification(db, sync_log, "success")

                        submit_success = True
                        break
                    else:
                        # API 返回失败，但不重试（业务逻辑错误）
                        sync_log.sync_status = "failed"
                        sync_log.error_message = submit_result["message"]
                        await db.commit()
                        logger.error(f"提交物流单号失败: sync_log_id={sync_log_id}, message={submit_result['message']}")

                        # 发送 WebSocket 通知
                        await _send_websocket_notification(db, sync_log, "failed", submit_result["message"])

                        break

                except Exception as e:
                    logger.error(f"提交物流单号异常 (尝试 {attempt}/{max_retries}): sync_log_id={sync_log_id}, error={e}")

                    if attempt < max_retries:
                        # 固定间隔重试：10s, 20s, 30s
                        wait_time = attempt * 10
                        logger.info(f"等待 {wait_time}s 后重试...")
                        await asyncio.sleep(wait_time)
                    else:
                        # 最后一次重试失败
                        sync_log.sync_status = "failed"
                        error_msg = f"同步异常: {str(e)}"
                        sync_log.error_message = error_msg
                        sync_log.attempts = attempt
                        await db.commit()

                        # 发送 WebSocket 通知
                        await _send_websocket_notification(db, sync_log, "failed", error_msg)

    except Exception as e:
        logger.error(f"异步同步任务异常: sync_log_id={sync_log_id}, error={e}")
        import traceback
        logger.error(traceback.format_exc())

        # 更新状态为失败
        try:
            result = await db.execute(
                select(Kuajing84SyncLog).where(Kuajing84SyncLog.id == sync_log_id)
            )
            sync_log = result.scalar_one_or_none()
            if sync_log:
                error_msg = f"异步任务异常: {str(e)}"
                sync_log.sync_status = "failed"
                sync_log.error_message = error_msg
                sync_log.attempts += 1
                await db.commit()

                # 发送 WebSocket 通知
                await _send_websocket_notification(db, sync_log, "failed", error_msg)
        except Exception as commit_error:
            logger.error(f"更新失败状态异常: {commit_error}")


async def async_discard_order(
    db: AsyncSession,
    sync_log_id: int,
    max_retries: int = 3
) -> None:
    """
    后台异步废弃订单到跨境巴士（支持重试）

    Args:
        db: 数据库会话
        sync_log_id: 同步日志ID
        max_retries: 最大重试次数

    流程：
    1. 更新状态为 in_progress
    2. 获取有效 Cookie
    3. 调用跨境巴士废弃接口
    4. 更新本地 posting 状态为 cancelled
    5. 更新同步状态为 success/failed
    """
    start_time = datetime.now(timezone.utc)
    logger.info(f"开始异步废弃订单任务: sync_log_id={sync_log_id}")

    try:
        # 1. 查询同步日志
        result = await db.execute(
            select(Kuajing84SyncLog).where(Kuajing84SyncLog.id == sync_log_id)
        )
        sync_log = result.scalar_one_or_none()

        if not sync_log:
            logger.error(f"同步日志不存在: sync_log_id={sync_log_id}")
            return

        # 2. 更新状态为 in_progress
        sync_log.sync_status = "in_progress"
        sync_log.started_at = start_time
        await db.commit()

        # 3. 获取跨境巴士服务
        kuajing84_service = create_kuajing84_sync_service(db)

        # 4. 获取有效的 Cookie（强制重新登录）
        config_result = await db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = config_result.scalar_one_or_none()

        if not config or not config.enabled:
            sync_log.sync_status = "failed"
            sync_log.error_message = "跨境84未配置或未启用"
            sync_log.attempts += 1
            await db.commit()
            logger.error(f"跨境84未启用: sync_log_id={sync_log_id}")
            return

        # 解密密码
        password = kuajing84_service._decrypt(config.password)

        # 强制重新登录并执行废弃操作
        from .kuajing84_client import Kuajing84Client
        async with Kuajing84Client(base_url=config.base_url, timeout=60.0) as client:
            # 登录获取最新Cookie
            try:
                login_result = await client.login(config.username, password)
                cookies = login_result["cookies"]

                # 更新数据库中的Cookie
                config.cookie = cookies
                config.cookie_expires_at = datetime.fromisoformat(login_result["expires_at"].replace("Z", "+00:00"))
                await db.commit()

                logger.info("跨境84强制登录成功（废弃订单）")

            except Exception as e:
                logger.error(f"跨境84登录失败: {e}")
                error_msg = f"登录失败: {str(e)}"
                sync_log.sync_status = "failed"
                sync_log.error_message = error_msg
                sync_log.attempts += 1
                await db.commit()

                # 发送 WebSocket 通知
                await _send_websocket_notification(db, sync_log, "failed", error_msg)
                return

            # 5. 调用跨境84 API 废弃订单（支持重试）
            discard_success = False
            for attempt in range(1, max_retries + 1):
                try:
                    logger.info(f"废弃订单 (尝试 {attempt}/{max_retries}): sync_log_id={sync_log_id}")

                    discard_result = await client.discard_order(sync_log.order_number, cookies)
                    sync_log.attempts = attempt

                    if discard_result.get("success"):
                        sync_log.sync_status = "success"
                        sync_log.synced_at = datetime.now(timezone.utc)
                        await db.commit()

                        # 6. 更新本地 posting 状态为 cancelled
                        if sync_log.posting_id:
                            await db.execute(
                                update(OzonPosting)
                                .where(OzonPosting.id == sync_log.posting_id)
                                .values(
                                    operation_status="cancelled",
                                    updated_at=datetime.now(timezone.utc)
                                )
                            )
                            await db.commit()
                            logger.info(f"本地 posting 状态已更新为 cancelled: posting_id={sync_log.posting_id}")

                        duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
                        logger.info(f"订单废弃成功: sync_log_id={sync_log_id}, 耗时={duration_ms:.0f}ms")

                        # 发送 WebSocket 通知
                        await _send_websocket_notification(db, sync_log, "success")

                        discard_success = True
                        break
                    else:
                        # API 返回失败，但不重试（业务逻辑错误）
                        error_msg = discard_result.get("message", "废弃订单失败")
                        sync_log.sync_status = "failed"
                        sync_log.error_message = error_msg
                        await db.commit()

                        # 发送 WebSocket 通知
                        await _send_websocket_notification(db, sync_log, "failed", error_msg)
                        logger.error(f"废弃订单失败: sync_log_id={sync_log_id}, message={discard_result.get('message')}")
                        break

                except Exception as e:
                    logger.error(f"废弃订单异常 (尝试 {attempt}/{max_retries}): sync_log_id={sync_log_id}, error={e}")

                    if attempt < max_retries:
                        # 固定间隔重试：10s, 20s, 30s
                        wait_time = attempt * 10
                        logger.info(f"等待 {wait_time}s 后重试...")
                        await asyncio.sleep(wait_time)
                    else:
                        # 最后一次重试失败
                        error_msg = f"废弃异常: {str(e)}"
                        sync_log.sync_status = "failed"
                        sync_log.error_message = error_msg
                        sync_log.attempts = attempt
                        await db.commit()

                        # 发送 WebSocket 通知
                        await _send_websocket_notification(db, sync_log, "failed", error_msg)

        except Exception as e:
            logger.error(f"跨境84登录失败: {e}")
            error_msg = f"登录失败: {str(e)}"
            sync_log.sync_status = "failed"
            sync_log.error_message = error_msg
            sync_log.attempts += 1
            await db.commit()

            # 发送 WebSocket 通知
            await _send_websocket_notification(db, sync_log, "failed", error_msg)
        finally:
            # 确保关闭client释放资源
            await client.close()

    except Exception as e:
        logger.error(f"异步废弃订单任务异常: sync_log_id={sync_log_id}, error={e}")
        import traceback
        logger.error(traceback.format_exc())

        # 更新状态为失败
        try:
            result = await db.execute(
                select(Kuajing84SyncLog).where(Kuajing84SyncLog.id == sync_log_id)
            )
            sync_log = result.scalar_one_or_none()
            if sync_log:
                error_msg = f"异步任务异常: {str(e)}"
                sync_log.sync_status = "failed"
                sync_log.error_message = error_msg
                sync_log.attempts += 1
                await db.commit()

                # 发送 WebSocket 通知
                await _send_websocket_notification(db, sync_log, "failed", error_msg)
        except Exception as commit_error:
            logger.error(f"更新失败状态异常: {commit_error}")
