"""OZON聊天服务"""
from typing import Dict, List, Any, Optional
from datetime import datetime
import logging
from sqlalchemy import select, and_, or_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ..models.chat import OzonChat, OzonChatMessage
from ..models.ozon_shops import OzonShop
from ..api.client import OzonAPIClient
from ..utils.datetime_utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)


class OzonChatService:
    """OZON聊天服务"""

    def __init__(self, shop_id: Optional[int] = None, shop_ids: Optional[List[int]] = None):
        """初始化聊天服务

        Args:
            shop_id: 店铺ID（单店铺模式）
            shop_ids: 店铺ID列表（多店铺模式）
        """
        self.shop_id = shop_id
        self.shop_ids = shop_ids
        self.db_manager = get_db_manager()

    async def get_chats(
        self,
        status: Optional[str] = None,
        has_unread: Optional[bool] = None,
        order_number: Optional[str] = None,
        limit: int = 20,
        offset: int = 0
    ) -> Dict[str, Any]:
        """获取聊天列表

        Args:
            status: 聊天状态筛选 (open/closed)
            has_unread: 是否有未读消息
            order_number: 订单号筛选
            limit: 每页数量
            offset: 偏移量

        Returns:
            {
                "items": [...],
                "total": int,
                "limit": int,
                "offset": int
            }
        """
        async with self.db_manager.get_session() as session:
            # 构建查询条件
            conditions = []

            # 根据是否指定shop_id决定过滤方式
            if self.shop_id is not None:
                # 单店铺模式
                conditions.append(OzonChat.shop_id == self.shop_id)
            elif self.shop_ids:
                # 多店铺模式：使用提供的店铺ID列表
                conditions.append(OzonChat.shop_id.in_(self.shop_ids))

            if status:
                conditions.append(OzonChat.status == status)

            if has_unread is not None:
                if has_unread:
                    conditions.append(OzonChat.unread_count > 0)
                else:
                    conditions.append(OzonChat.unread_count == 0)

            if order_number:
                conditions.append(OzonChat.order_number == order_number)

            # 查询总数
            count_stmt = select(func.count()).select_from(OzonChat).where(and_(*conditions))
            total = await session.scalar(count_stmt)

            # 查询列表
            # 多店铺模式需要JOIN获取店铺名称
            if self.shop_id is None and self.shop_ids:
                stmt = (
                    select(OzonChat, OzonShop.shop_name)
                    .join(OzonShop, OzonChat.shop_id == OzonShop.id)
                    .where(and_(*conditions))
                    .order_by(desc(OzonChat.last_message_at))
                    .limit(limit)
                    .offset(offset)
                )
                result = await session.execute(stmt)
                rows = result.all()

                # 将shop_name附加到chat对象上
                chats_with_shop = []
                for chat, shop_name in rows:
                    chat_dict = self._chat_to_dict(chat)
                    chat_dict["shop_name"] = shop_name
                    chats_with_shop.append(chat_dict)

                return {
                    "items": chats_with_shop,
                    "total": total or 0,
                    "limit": limit,
                    "offset": offset
                }
            else:
                # 单店铺模式
                stmt = (
                    select(OzonChat)
                    .where(and_(*conditions))
                    .order_by(desc(OzonChat.last_message_at))
                    .limit(limit)
                    .offset(offset)
                )
                result = await session.execute(stmt)
                chats = result.scalars().all()

                return {
                    "items": [self._chat_to_dict(chat) for chat in chats],
                    "total": total or 0,
                    "limit": limit,
                    "offset": offset
                }

    async def get_chat_detail(self, chat_id: str) -> Optional[Dict[str, Any]]:
        """获取聊天详情"""
        async with self.db_manager.get_session() as session:
            stmt = select(OzonChat).where(
                and_(
                    OzonChat.shop_id == self.shop_id,
                    OzonChat.chat_id == chat_id
                )
            )
            chat = await session.scalar(stmt)

            if not chat:
                return None

            return self._chat_to_dict(chat)

    async def get_messages(
        self,
        chat_id: str,
        limit: int = 50,
        offset: int = 0,
        before_message_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """获取聊天消息列表

        Args:
            chat_id: 聊天ID
            limit: 每页数量
            offset: 偏移量
            before_message_id: 获取此消息之前的消息

        Returns:
            {
                "items": [...],
                "total": int,
                "chat_id": str
            }
        """
        async with self.db_manager.get_session() as session:
            # 验证聊天是否属于此店铺
            chat_stmt = select(OzonChat).where(
                and_(
                    OzonChat.shop_id == self.shop_id,
                    OzonChat.chat_id == chat_id
                )
            )
            chat = await session.scalar(chat_stmt)
            if not chat:
                return {"items": [], "total": 0, "chat_id": chat_id}

            # 构建消息查询条件
            conditions = [
                OzonChatMessage.shop_id == self.shop_id,
                OzonChatMessage.chat_id == chat_id,
                OzonChatMessage.is_deleted == False
            ]

            if before_message_id:
                # 获取参考消息的创建时间
                ref_stmt = select(OzonChatMessage.created_at).where(
                    OzonChatMessage.message_id == before_message_id
                )
                ref_time = await session.scalar(ref_stmt)
                if ref_time:
                    conditions.append(OzonChatMessage.created_at < ref_time)

            # 查询总数
            count_stmt = select(func.count()).select_from(OzonChatMessage).where(and_(*conditions))
            total = await session.scalar(count_stmt)

            # 查询消息列表（按时间倒序）
            stmt = (
                select(OzonChatMessage)
                .where(and_(*conditions))
                .order_by(desc(OzonChatMessage.created_at))
                .limit(limit)
                .offset(offset)
            )
            result = await session.execute(stmt)
            messages = result.scalars().all()

            return {
                "items": [self._message_to_dict(msg) for msg in reversed(messages)],
                "total": total or 0,
                "chat_id": chat_id
            }

    async def send_message(
        self,
        chat_id: str,
        content: str,
        api_client: OzonAPIClient
    ) -> Dict[str, Any]:
        """发送文本消息

        Args:
            chat_id: 聊天ID
            content: 消息内容
            api_client: OZON API客户端

        Returns:
            发送结果
        """
        # 验证聊天是否属于此店铺
        async with self.db_manager.get_session() as session:
            stmt = select(OzonChat).where(
                and_(
                    OzonChat.shop_id == self.shop_id,
                    OzonChat.chat_id == chat_id
                )
            )
            chat = await session.scalar(stmt)
            if not chat:
                raise ValueError(f"Chat {chat_id} not found for shop {self.shop_id}")

        # 调用OZON API发送消息
        result = await api_client.send_chat_message(chat_id, content)

        return result

    async def send_file(
        self,
        chat_id: str,
        file_url: str,
        file_name: str,
        api_client: OzonAPIClient
    ) -> Dict[str, Any]:
        """发送文件消息

        Args:
            chat_id: 聊天ID
            file_url: 文件URL
            file_name: 文件名
            api_client: OZON API客户端

        Returns:
            发送结果
        """
        # 验证聊天是否属于此店铺
        async with self.db_manager.get_session() as session:
            stmt = select(OzonChat).where(
                and_(
                    OzonChat.shop_id == self.shop_id,
                    OzonChat.chat_id == chat_id
                )
            )
            chat = await session.scalar(stmt)
            if not chat:
                raise ValueError(f"Chat {chat_id} not found for shop {self.shop_id}")

        # 调用OZON API发送文件
        result = await api_client.send_chat_file(chat_id, file_url, file_name)

        return result

    async def mark_as_read(
        self,
        chat_id: str,
        api_client: OzonAPIClient
    ) -> Dict[str, Any]:
        """标记聊天为已读

        Args:
            chat_id: 聊天ID
            api_client: OZON API客户端

        Returns:
            操作结果
        """
        # 验证聊天是否属于此店铺，并获取最后一条消息ID
        last_message_id = None
        async with self.db_manager.get_session() as session:
            stmt = select(OzonChat).where(
                and_(
                    OzonChat.shop_id == self.shop_id,
                    OzonChat.chat_id == chat_id
                )
            )
            chat = await session.scalar(stmt)
            if not chat:
                raise ValueError(f"Chat {chat_id} not found for shop {self.shop_id}")

            # 获取最后一条消息的ID（按创建时间倒序）
            msg_stmt = (
                select(OzonChatMessage.message_id)
                .where(
                    and_(
                        OzonChatMessage.shop_id == self.shop_id,
                        OzonChatMessage.chat_id == chat_id,
                        OzonChatMessage.is_deleted == False
                    )
                )
                .order_by(desc(OzonChatMessage.created_at))
                .limit(1)
            )
            last_msg_id = await session.scalar(msg_stmt)
            if last_msg_id:
                # 将字符串消息ID转换为整数（OZON API要求整数）
                try:
                    last_message_id = int(last_msg_id)
                except (ValueError, TypeError):
                    logger.warning(f"Cannot convert message_id '{last_msg_id}' to int for chat {chat_id}")
                    last_message_id = None

        # 调用OZON API标记已读
        # 传递最后一条消息ID，将该消息及其之前的所有消息标记为已读
        result = await api_client.mark_chat_as_read(chat_id, from_message_id=last_message_id)

        # 更新本地数据库
        async with self.db_manager.get_session() as session:
            stmt = select(OzonChat).where(
                and_(
                    OzonChat.shop_id == self.shop_id,
                    OzonChat.chat_id == chat_id
                )
            )
            chat = await session.scalar(stmt)
            if chat:
                # 从API响应中获取未读数量
                chat.unread_count = result.get("unread_count", 0)

                # 标记所有未读消息为已读
                msg_stmt = select(OzonChatMessage).where(
                    and_(
                        OzonChatMessage.shop_id == self.shop_id,
                        OzonChatMessage.chat_id == chat_id,
                        OzonChatMessage.is_read == False
                    )
                )
                msg_result = await session.execute(msg_stmt)
                messages = msg_result.scalars().all()

                read_at = utcnow()
                for msg in messages:
                    msg.is_read = True
                    msg.read_at = read_at

                await session.commit()

        return result

    async def _sync_chat_messages(
        self,
        chat_id: str,
        api_client: OzonAPIClient
    ) -> Dict[str, Any]:
        """同步单个聊天的消息

        Args:
            chat_id: 聊天ID
            api_client: OZON API客户端

        Returns:
            同步的消息统计
        """
        synced_messages = 0
        new_messages = 0

        # 获取聊天消息历史
        try:
            history = await api_client.get_chat_history(chat_id, limit=100)
            messages_data = history.get("messages", [])

            if not messages_data:
                return {"synced_messages": 0, "new_messages": 0}

            async with self.db_manager.get_session() as session:
                # 获取聊天对象以更新信息
                chat_stmt = select(OzonChat).where(
                    and_(
                        OzonChat.shop_id == self.shop_id,
                        OzonChat.chat_id == chat_id
                    )
                )
                chat = await session.scalar(chat_stmt)

                if not chat:
                    return {"synced_messages": 0, "new_messages": 0}

                # 反转消息列表（从最早到最新）
                messages_data = list(reversed(messages_data))

                for msg_data in messages_data:
                    message_id = str(msg_data.get("message_id", ""))
                    if not message_id:
                        continue

                    # 检查消息是否已存在
                    msg_stmt = select(OzonChatMessage).where(
                        OzonChatMessage.message_id == message_id
                    )
                    existing_msg = await session.scalar(msg_stmt)

                    if not existing_msg:
                        # 创建新消息
                        new_msg = self._create_message_from_api(chat_id, msg_data)
                        session.add(new_msg)
                        new_messages += 1

                        # 从消息上下文中提取订单信息
                        context = msg_data.get("context", {})
                        if context and isinstance(context, dict):
                            if context.get("order_number") and not chat.order_number:
                                chat.order_number = context.get("order_number")

                        # 更新客户名称（从用户消息中）
                        if msg_data.get("user") and msg_data["user"].get("type") == "Customer":
                            user_name = msg_data["user"].get("name", "")
                            if user_name and not chat.customer_name:
                                chat.customer_name = user_name
                            if not chat.customer_id:
                                chat.customer_id = str(msg_data["user"].get("id", ""))

                    synced_messages += 1

                # 更新聊天的最后消息信息
                if messages_data:
                    last_msg = messages_data[-1]
                    # data 是字符串数组，提取文本预览
                    data_array = last_msg.get("data", [])
                    preview = " ".join(data_array) if isinstance(data_array, list) else str(data_array)
                    chat.last_message_preview = preview[:500]
                    chat.last_message_at = parse_datetime(last_msg.get("created_at"))
                    chat.message_count = len(messages_data)

                    # 智能推断 UNSPECIFIED 类型的聊天
                    if chat.chat_type == "UNSPECIFIED":
                        user_types = set()
                        for msg in messages_data:
                            user = msg.get("user", {})
                            user_type = user.get("type", "")
                            if user_type:
                                user_types.add(user_type)

                        # 如果有Customer消息，判定为买家聊天
                        if "Customer" in user_types:
                            chat.chat_type = "BUYER_SELLER"
                        # 如果只有Support/NotificationUser/ChatBot，判定为官方聊天
                        elif user_types & {"Support", "NotificationUser", "ChatBot"}:
                            chat.chat_type = "SELLER_SUPPORT"

                await session.commit()

            return {
                "synced_messages": synced_messages,
                "new_messages": new_messages
            }

        except Exception as e:
            logger.error(f"Failed to sync messages for chat {chat_id}: {e}")
            return {"synced_messages": 0, "new_messages": 0}

    async def sync_chats(
        self,
        api_client: OzonAPIClient,
        chat_id_list: Optional[List[str]] = None,
        sync_messages: bool = True
    ) -> Dict[str, Any]:
        """从OZON同步聊天数据

        Args:
            api_client: OZON API客户端
            chat_id_list: 要同步的聊天ID列表（为空则同步全部）
            sync_messages: 是否同步消息内容（默认True）

        Returns:
            同步结果统计
        """
        synced_count = 0
        new_count = 0
        updated_count = 0
        total_messages = 0
        total_new_messages = 0

        # 获取聊天列表 - 使用cursor分页
        limit = 100
        cursor = None
        max_pages = 50  # 防止无限循环，最多50页

        for page in range(max_pages):
            # 构建请求参数
            params = {
                "limit": limit
            }
            if cursor:
                params["cursor"] = cursor
            if chat_id_list:
                params["chat_id_list"] = chat_id_list

            result = await api_client.get_chat_list(**params)

            chats_data = result.get("chats", [])
            if not chats_data:
                break

            async with self.db_manager.get_session() as session:
                for chat_data in chats_data:
                    # 提取chat_id（在嵌套的chat对象中）
                    chat_info = chat_data.get("chat", {})
                    chat_id = chat_info.get("chat_id")
                    if not chat_id:
                        continue

                    # 检查聊天是否已存在
                    stmt = select(OzonChat).where(
                        and_(
                            OzonChat.shop_id == self.shop_id,
                            OzonChat.chat_id == chat_id
                        )
                    )
                    existing_chat = await session.scalar(stmt)

                    if existing_chat:
                        # 更新现有聊天
                        self._update_chat_from_api(existing_chat, chat_data)
                        updated_count += 1
                    else:
                        # 创建新聊天
                        new_chat = self._create_chat_from_api(chat_data)
                        session.add(new_chat)
                        new_count += 1

                    synced_count += 1

                await session.commit()

            # 同步消息内容
            if sync_messages:
                for chat_data in chats_data:
                    chat_info = chat_data.get("chat", {})
                    chat_id = chat_info.get("chat_id")
                    if chat_id:
                        msg_stats = await self._sync_chat_messages(chat_id, api_client)
                        total_messages += msg_stats.get("synced_messages", 0)
                        total_new_messages += msg_stats.get("new_messages", 0)

            # 检查是否还有更多数据
            has_next = result.get("has_next", False)
            if not has_next:
                break

            # 获取下一页的cursor
            cursor = result.get("cursor")
            if not cursor:
                break

        return {
            "synced_count": synced_count,
            "new_count": new_count,
            "updated_count": updated_count,
            "total_messages": total_messages,
            "total_new_messages": total_new_messages
        }

    def _create_message_from_api(self, chat_id: str, msg_data: Dict[str, Any]) -> OzonChatMessage:
        """从OZON API数据创建消息对象"""
        user = msg_data.get("user", {})
        data_array = msg_data.get("data", [])

        # data 是字符串数组，合并为文本
        content = " ".join(data_array) if isinstance(data_array, list) else str(data_array)

        # 判断发送者类型
        # OZON API实际返回格式：NotificationUser, ChatBot, Seller, Support, Customer (大写)
        user_type = user.get("type", "")
        user_id = user.get("id", "")
        user_name = user.get("name", "")

        # 类型映射
        sender_type_map = {
            "Customer": "user",
            "Seller": "seller",
            "Support": "support",
            "NotificationUser": "support",
            "ChatBot": "support",
        }
        sender_type = sender_type_map.get(user_type, "user")

        # 设置友好的发送者名称
        sender_name = user.get("name", "")
        if not sender_name:
            if user_type == "NotificationUser":
                sender_name = "Ozon官方"
            elif user_type == "ChatBot":
                sender_name = "Ozon智能助手"
            elif user_type == "Support":
                sender_name = "Ozon客服"
            elif user_type == "Seller":
                sender_name = "卖家"
            else:
                sender_name = "客户"

        return OzonChatMessage(
            shop_id=self.shop_id,
            chat_id=chat_id,
            message_id=str(msg_data.get("message_id", "")),
            message_type="text",
            sender_type=sender_type,
            sender_id=str(user.get("id", "")),
            sender_name=sender_name,
            content=content,
            content_data=msg_data,
            is_read=msg_data.get("is_read", False),
            is_deleted=False,
            is_edited=False,
            created_at=parse_datetime(msg_data.get("created_at"))
        )

    async def get_chat_stats(self) -> Dict[str, Any]:
        """获取聊天统计信息"""
        async with self.db_manager.get_session() as session:
            # 构建店铺过滤条件
            shop_conditions = []
            if self.shop_id is not None:
                # 单店铺模式
                shop_conditions.append(OzonChat.shop_id == self.shop_id)
            elif self.shop_ids:
                # 多店铺模式：使用提供的店铺ID列表
                shop_conditions.append(OzonChat.shop_id.in_(self.shop_ids))

            # 总聊天数
            total_stmt = select(func.count()).select_from(OzonChat)
            if shop_conditions:
                total_stmt = total_stmt.where(and_(*shop_conditions))
            total_chats = await session.scalar(total_stmt)

            # 活跃聊天数
            active_conditions = shop_conditions + [OzonChat.status == "open"]
            active_stmt = select(func.count()).select_from(OzonChat).where(and_(*active_conditions))
            active_chats = await session.scalar(active_stmt)

            # 未读消息总数
            unread_stmt = select(func.sum(OzonChat.unread_count))
            if shop_conditions:
                unread_stmt = unread_stmt.where(and_(*shop_conditions))
            total_unread = await session.scalar(unread_stmt)

            # 有未读消息的聊天数
            unread_chats_conditions = shop_conditions + [OzonChat.unread_count > 0]
            unread_chats_stmt = select(func.count()).select_from(OzonChat).where(and_(*unread_chats_conditions))
            unread_chats = await session.scalar(unread_chats_stmt)

            return {
                "total_chats": total_chats or 0,
                "active_chats": active_chats or 0,
                "total_unread": int(total_unread or 0),
                "unread_chats": unread_chats or 0
            }

    def _chat_to_dict(self, chat: OzonChat) -> Dict[str, Any]:
        """将聊天对象转换为字典"""
        return {
            "id": chat.id,
            "shop_id": chat.shop_id,  # 增加shop_id，便于全部店铺模式下的操作
            "chat_id": chat.chat_id,
            "chat_type": chat.chat_type,
            "subject": chat.subject,
            "customer_id": chat.customer_id,
            "customer_name": chat.customer_name,
            "status": chat.status,
            "is_closed": chat.is_closed,
            "order_number": chat.order_number,
            "product_id": chat.product_id,
            "message_count": chat.message_count,
            "unread_count": chat.unread_count,
            "last_message_at": chat.last_message_at.isoformat() if chat.last_message_at else None,
            "last_message_preview": chat.last_message_preview,
            "closed_at": chat.closed_at.isoformat() if chat.closed_at else None,
            "created_at": chat.created_at.isoformat(),
            "updated_at": chat.updated_at.isoformat() if chat.updated_at else None
        }

    def _message_to_dict(self, message: OzonChatMessage) -> Dict[str, Any]:
        """将消息对象转换为字典"""
        return {
            "id": message.id,
            "chat_id": message.chat_id,
            "message_id": message.message_id,
            "message_type": message.message_type,
            "sender_type": message.sender_type,
            "sender_id": message.sender_id,
            "sender_name": message.sender_name,
            "content": message.content,
            "content_data": message.content_data,
            "is_read": message.is_read,
            "is_deleted": message.is_deleted,
            "is_edited": message.is_edited,
            "order_number": message.order_number,
            "product_id": message.product_id,
            "read_at": message.read_at.isoformat() if message.read_at else None,
            "edited_at": message.edited_at.isoformat() if message.edited_at else None,
            "created_at": message.created_at.isoformat()
        }

    def _create_chat_from_api(self, chat_data: Dict[str, Any]) -> OzonChat:
        """从OZON API数据创建聊天对象

        OZON API返回格式：
        {
            "chat": {
                "chat_id": "...",
                "chat_status": "OPENED",
                "chat_type": "UNSPECIFIED",
                "created_at": "..."
            },
            "unread_count": 2,
            "first_unread_message_id": ...,
            "last_message_id": ...
        }
        """
        # 提取chat嵌套对象
        chat = chat_data.get("chat", {})

        # 状态映射（API返回：OPENED/CLOSED/UNSPECIFIED/All）
        chat_status = chat.get("chat_status", "OPENED")
        if chat_status == "OPENED":
            status = "open"
            is_closed = False
        elif chat_status == "CLOSED":
            status = "closed"
            is_closed = True
        else:
            # UNSPECIFIED 或其他未知状态，默认为开放
            status = "open"
            is_closed = False

        return OzonChat(
            shop_id=self.shop_id,
            chat_id=chat.get("chat_id"),
            chat_type=chat.get("chat_type"),
            subject=chat.get("subject"),
            customer_id=None,  # API不返回，需从消息中提取
            customer_name=None,  # API不返回，需从消息中提取
            status=status,
            is_closed=is_closed,
            order_number=None,  # API不返回，需从消息中提取
            product_id=None,  # API不返回，需从消息中提取
            message_count=0,  # 初始为0，同步消息后更新
            unread_count=chat_data.get("unread_count", 0),
            last_message_at=parse_datetime(chat.get("created_at")),  # 使用创建时间作为默认值
            last_message_preview=None,  # 初始为空，后续通过消息同步填充
            extra_data=chat_data  # 保存完整的原始数据
        )

    def _update_chat_from_api(self, chat: OzonChat, chat_data: Dict[str, Any]) -> None:
        """用OZON API数据更新聊天对象"""
        # 提取chat嵌套对象
        chat_info = chat_data.get("chat", {})

        # 状态映射（API返回：OPENED/CLOSED/UNSPECIFIED/All）
        chat_status = chat_info.get("chat_status", "OPENED")
        if chat_status == "OPENED":
            chat.status = "open"
            chat.is_closed = False
        elif chat_status == "CLOSED":
            chat.status = "closed"
            chat.is_closed = True
        else:
            # UNSPECIFIED 或其他未知状态，默认为开放
            chat.status = "open"
            chat.is_closed = False

        chat.chat_type = chat_info.get("chat_type", chat.chat_type)
        chat.subject = chat_info.get("subject", chat.subject)
        chat.unread_count = chat_data.get("unread_count", chat.unread_count)

        # 更新extra_data保存完整原始数据
        chat.extra_data = chat_data
        chat.updated_at = utcnow()
