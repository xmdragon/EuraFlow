"""
Ozon API 聊天相关方法
"""

from typing import Any, Dict, List, Optional


class ChatMixin:
    """聊天相关 API 方法"""

    async def get_chat_list(
        self,
        chat_id_list: Optional[List[str]] = None,
        limit: int = 100,
        cursor: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        获取聊天列表

        Args:
            chat_id_list: 聊天ID列表（可选，用于获取指定聊天）
            limit: 返回数量限制（最大100）
            cursor: 分页游标（可选）

        Returns:
            聊天列表数据，包含：
            - chats: 聊天列表
            - cursor: 下一页游标
            - has_next: 是否有下一页
            - total_unread_count: 总未读数
        """
        data = {
            "limit": min(limit, 100)
        }

        if cursor:
            data["cursor"] = cursor

        if chat_id_list:
            data["chat_id_list"] = chat_id_list

        return await self._request(
            "POST",
            "/v3/chat/list",
            data=data,
            resource_type="default"
        )

    async def get_chat_history(
        self,
        chat_id: str,
        from_message_id: Optional[int] = None,
        limit: int = 100
    ) -> Dict[str, Any]:
        """
        获取聊天历史消息

        Args:
            chat_id: 聊天ID
            from_message_id: 起始消息ID（用于分页）
            limit: 返回数量限制（最大100）

        Returns:
            聊天历史数据
        """
        data = {
            "chat_id": chat_id,
            "limit": min(limit, 100)
        }

        if from_message_id:
            data["from_message_id"] = from_message_id

        return await self._request(
            "POST",
            "/v3/chat/history",
            data=data,
            resource_type="default"
        )

    async def send_chat_message(
        self,
        chat_id: str,
        text: str
    ) -> Dict[str, Any]:
        """
        发送聊天消息

        Args:
            chat_id: 聊天ID
            text: 消息文本内容

        Returns:
            发送结果
        """
        data = {
            "chat_id": chat_id,
            "text": text
        }

        return await self._request(
            "POST",
            "/v1/chat/send/message",
            data=data,
            resource_type="default"
        )

    async def send_chat_file(
        self,
        chat_id: str,
        base64_content: str,
        file_name: str
    ) -> Dict[str, Any]:
        """
        发送聊天文件

        Args:
            chat_id: 聊天ID
            base64_content: base64编码的文件内容
            file_name: 文件名（含扩展名）

        Returns:
            发送结果
        """
        data = {
            "chat_id": chat_id,
            "base64_content": base64_content,
            "name": file_name
        }

        return await self._request(
            "POST",
            "/v1/chat/send/file",
            data=data,
            resource_type="default"
        )

    async def mark_chat_as_read(
        self,
        chat_id: str,
        from_message_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        标记聊天为已读

        将指定消息及其之前的所有消息标记为已读。
        如果不提供from_message_id，则标记所有消息为已读。

        Args:
            chat_id: 聊天ID
            from_message_id: 消息ID（将该消息及其之前的消息标记为已读）

        Returns:
            操作结果，包含 unread_count（未读消息数量）
        """
        data = {
            "chat_id": chat_id
        }

        # 如果提供了消息ID，添加到请求中
        if from_message_id is not None:
            data["from_message_id"] = from_message_id

        return await self._request(
            "POST",
            "/v2/chat/read",
            data=data,
            resource_type="default"
        )

    async def get_chat_updates(
        self,
        chat_id_list: Optional[List[str]] = None,
        from_message_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        获取聊天更新

        Args:
            chat_id_list: 聊天ID列表
            from_message_id: 起始消息ID

        Returns:
            聊天更新数据
        """
        data = {}

        if chat_id_list:
            data["chat_id_list"] = chat_id_list

        if from_message_id:
            data["from_message_id"] = from_message_id

        return await self._request(
            "POST",
            "/v1/chat/updates",
            data=data,
            resource_type="default"
        )
