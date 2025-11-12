#!/usr/bin/env python3
"""
检查OZON类目的特征和值指南

用法：
    python scripts/check_category_attributes.py "手机支架" --client-id CLIENT_ID --api-key API_KEY
    python scripts/check_category_attributes.py --category-id 98636 --client-id CLIENT_ID --api-key API_KEY
"""
import asyncio
import sys
import os
import json
import argparse
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from ef_core.database import DatabaseManager
from plugins.ef.channels.ozon.models.listing import (
    OzonCategory,
    OzonCategoryAttribute,
    OzonAttributeDictionaryValue
)
from plugins.ef.channels.ozon.api.client import OzonAPIClient
from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
from ef_core.services.auth_service import get_auth_service


async def find_category_by_name(db: AsyncSession, category_name: str):
    """根据名称查找类目"""
    stmt = select(OzonCategory).where(
        OzonCategory.name.ilike(f"%{category_name}%")
    )
    result = await db.execute(stmt)
    categories = result.scalars().all()

    if not categories:
        print(f"❌ 未找到匹配'{category_name}'的类目")
        return None

    if len(categories) > 1:
        print(f"找到 {len(categories)} 个匹配的类目：")
        for i, cat in enumerate(categories, 1):
            print(f"  {i}. {cat.name} (ID: {cat.category_id}, 父ID: {cat.parent_id}, 是否叶子: {cat.is_leaf})")

        # 优先选择叶子类目
        leaf_categories = [c for c in categories if c.is_leaf]
        if leaf_categories:
            selected = leaf_categories[0]
            print(f"\n自动选择叶子类目: {selected.name} (ID: {selected.category_id})")
            return selected
        else:
            selected = categories[0]
            print(f"\n自动选择第一个: {selected.name} (ID: {selected.category_id})")
            return selected

    return categories[0]


async def get_shop_credentials(db: AsyncSession, client_id_arg: str = None, api_key_arg: str = None):
    """获取第一个可用的店铺凭证"""
    # 优先使用命令行参数
    if client_id_arg and api_key_arg:
        return client_id_arg, api_key_arg

    # 然后从环境变量读取
    client_id = os.getenv("OZON_CLIENT_ID")
    api_key = os.getenv("OZON_API_KEY")

    if client_id and api_key:
        return client_id, api_key

    # 从数据库读取并解密API key
    stmt = select(OzonShop).where(OzonShop.status == "active").limit(1)
    result = await db.execute(stmt)
    shop = result.scalar_one_or_none()

    if not shop:
        raise RuntimeError("未找到可用的OZON店铺配置")

    print(f"\n✅ 找到OZON店铺配置: {shop.shop_name}")
    print(f"   Client ID: {shop.client_id}")

    # 尝试解密API key（如果是加密存储的）
    # 如果解密失败，尝试直接使用（可能是明文存储）
    try:
        auth_service = get_auth_service()
        api_key = auth_service.decrypt_api_key(shop.api_key_enc)
        print("   API Key: [已解密]")
        return shop.client_id, api_key
    except Exception as e:
        print(f"   ⚠️ 解密失败，尝试直接使用API key")
        # 直接使用数据库中的值（可能是明文存储）
        if shop.api_key_enc and len(shop.api_key_enc) > 0:
            print("   API Key: [使用数据库原值]")
            return shop.client_id, shop.api_key_enc
        else:
            print(f"\n❌ API key 为空")
            print("\n⚠️ 请使用以下命令行参数运行脚本：")
            print(f"  --client-id {shop.client_id}")
            print(f"  --api-key YOUR_API_KEY")
            raise RuntimeError("API key 为空")


async def fetch_attributes_from_api(
    client: OzonAPIClient,
    category_id: int,
    parent_id: int
):
    """从API获取类目特征"""
    print(f"\n📡 正在从OZON API获取类目特征...")
    print(f"   category_id (type_id): {category_id}")
    print(f"   parent_id (description_category_id): {parent_id}")

    response = await client.get_category_attributes(
        category_id=parent_id,
        type_id=category_id,
        language="ZH_HANS"
    )

    if not response.get("result"):
        error_msg = response.get("error", {}).get("message", "Unknown error")
        print(f"❌ API调用失败: {error_msg}")
        return None

    return response["result"]


async def fetch_dictionary_values_from_api(
    client: OzonAPIClient,
    attribute_id: int,
    dictionary_id: int,
    category_id: int,
    parent_id: int
):
    """从API获取字典值"""
    print(f"\n  🔍 [DEBUG] 获取字典值 - 请求参数:")
    print(f"     attribute_id: {attribute_id}")
    print(f"     dictionary_id (未使用): {dictionary_id}")
    print(f"     category_id (→ type_id): {category_id}")
    print(f"     parent_id (→ description_category_id): {parent_id}")

    all_values = []
    last_value_id = 0
    has_more = True
    page_count = 0

    while has_more:
        page_count += 1
        print(f"\n  📄 [DEBUG] 分页请求 #{page_count}:")
        print(f"     last_value_id: {last_value_id}")

        response = await client.get_attribute_values(
            attribute_id=attribute_id,
            category_id=category_id,
            parent_category_id=parent_id,
            last_value_id=last_value_id,
            limit=2000,
            language="ZH_HANS"
        )

        print(f"     API 响应: {json.dumps(response, ensure_ascii=False, indent=2)[:500]}...")

        if not response.get("result"):
            print(f"     ⚠️ API 未返回 result 字段")
            # 如果有错误，打印错误信息
            if "error" in response:
                print(f"     ❌ API 错误: {response['error']}")
            break

        values = response.get("result", [])
        if not values:
            print(f"     ⚠️ result 为空数组")
            break

        print(f"     ✅ 获取到 {len(values)} 个值")
        all_values.extend(values)
        last_value_id = values[-1].get("id", 0)
        has_more = response.get("has_next", False)

    print(f"\n  📊 [DEBUG] 总计获取 {len(all_values)} 个字典值")
    return all_values


async def compare_with_local_data(db: AsyncSession, category_id: int):
    """对比本地数据"""
    # 获取本地特征
    stmt = select(OzonCategoryAttribute).where(
        OzonCategoryAttribute.category_id == category_id
    )
    result = await db.execute(stmt)
    local_attrs = result.scalars().all()

    print(f"\n📊 本地数据库中的特征数量: {len(local_attrs)}")

    return local_attrs


def format_attribute_info(attr_data):
    """格式化特征信息"""
    lines = []
    lines.append(f"  属性ID: {attr_data.get('id')}")
    lines.append(f"  名称: {attr_data.get('name')}")
    lines.append(f"  描述: {attr_data.get('description', 'N/A')}")
    lines.append(f"  类型: {attr_data.get('type')}")
    lines.append(f"  是否必填: {'是' if attr_data.get('is_required') else '否'}")
    lines.append(f"  是否变体: {'是' if attr_data.get('is_aspect') else '否'}")
    lines.append(f"  字典ID: {attr_data.get('dictionary_id', 'N/A')}")
    lines.append(f"  组名: {attr_data.get('group_name', 'N/A')}")

    return "\n".join(lines)


async def main():
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='检查OZON类目的特征和值指南')
    parser.add_argument('category', nargs='?', help='类目名称或ID')
    parser.add_argument('--category-id', type=int, help='类目ID')
    parser.add_argument('--client-id', help='OZON Client ID')
    parser.add_argument('--api-key', help='OZON API Key')

    args = parser.parse_args()

    category_name = None
    category_id = None

    if args.category_id:
        category_id = args.category_id
    elif args.category:
        if args.category.isdigit():
            category_id = int(args.category)
        else:
            category_name = args.category
    else:
        category_name = "手机支架"

    print(f"🔍 检查OZON类目特征")
    if category_name:
        print(f"   类目名称: {category_name}")
    else:
        print(f"   类目ID: {category_id}")
    print("=" * 80)

    # 创建数据库连接
    db_manager = DatabaseManager()
    engine = db_manager.create_async_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        # 查找类目
        if category_name:
            category = await find_category_by_name(db, category_name)
        else:
            stmt = select(OzonCategory).where(OzonCategory.category_id == category_id)
            result = await db.execute(stmt)
            category = result.scalar_one_or_none()

        if not category:
            print("❌ 类目不存在")
            return

        print(f"\n✅ 找到类目: {category.name}")
        print(f"   类目ID: {category.category_id}")
        print(f"   父ID: {category.parent_id}")
        print(f"   是否叶子: {category.is_leaf}")
        print(f"   是否禁用: {category.is_disabled}")

        if not category.parent_id:
            print("❌ 该类目没有父ID，无法获取特征")
            return

        # 对比本地数据
        local_attrs = await compare_with_local_data(db, category.category_id)

        # 获取店铺凭证
        client_id, api_key = await get_shop_credentials(db, args.client_id, args.api_key)

        # 创建API客户端
        async with OzonAPIClient(client_id, api_key) as client:
            # 从API获取特征
            api_attributes = await fetch_attributes_from_api(
                client,
                category.category_id,
                category.parent_id
            )

            if not api_attributes:
                return

            print(f"📊 OZON API返回的特征数量: {len(api_attributes)}")
            print("\n" + "=" * 80)
            print("详细特征列表（来自OZON API）:")
            print("=" * 80)

            # 输出每个特征
            for i, attr_data in enumerate(api_attributes, 1):
                print(f"\n【特征 {i}】")
                print(format_attribute_info(attr_data))

                # 如果有字典值，获取前10个示例
                if attr_data.get("dictionary_id"):
                    print(f"\n  📋 字典值（前10个）:")
                    values = await fetch_dictionary_values_from_api(
                        client,
                        attr_data.get("id"),
                        attr_data.get("dictionary_id"),
                        category.category_id,
                        category.parent_id
                    )

                    if values:
                        print(f"     总数: {len(values)}")
                        for j, value_data in enumerate(values[:10], 1):
                            value_text = value_data.get("value", "")
                            value_id = value_data.get("id", "")
                            info = value_data.get("info", "")
                            if info:
                                print(f"     {j}. [{value_id}] {value_text} ({info})")
                            else:
                                print(f"     {j}. [{value_id}] {value_text}")

                        if len(values) > 10:
                            print(f"     ... 还有 {len(values) - 10} 个值")
                    else:
                        print("     无字典值")

                print("-" * 80)

            # 对比分析
            print("\n" + "=" * 80)
            print("对比分析:")
            print("=" * 80)

            local_attr_ids = {attr.attribute_id for attr in local_attrs}
            api_attr_ids = {attr_data.get("id") for attr_data in api_attributes}

            # 本地有但API没有的
            local_only = local_attr_ids - api_attr_ids
            if local_only:
                print(f"\n⚠️ 本地有但API没有的特征 ({len(local_only)}个):")
                for attr_id in local_only:
                    attr = next((a for a in local_attrs if a.attribute_id == attr_id), None)
                    if attr:
                        print(f"   - {attr.name} (ID: {attr_id})")

            # API有但本地没有的
            api_only = api_attr_ids - local_attr_ids
            if api_only:
                print(f"\n⚠️ API有但本地没有的特征 ({len(api_only)}个):")
                for attr_id in api_only:
                    attr_data = next((a for a in api_attributes if a.get("id") == attr_id), None)
                    if attr_data:
                        print(f"   - {attr_data.get('name')} (ID: {attr_id})")

            # 共同特征
            common = local_attr_ids & api_attr_ids
            if common:
                print(f"\n✅ 共同特征数量: {len(common)}")

            if not local_only and not api_only:
                print("\n✅ 本地数据与OZON API完全一致！")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
