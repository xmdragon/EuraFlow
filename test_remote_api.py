#!/usr/bin/env python3
"""
远程API Key测试脚本
用于诊断API Key认证问题
"""
import asyncio
import sys


async def test_database():
    """测试数据库连接"""
    print("1. Testing database connection...")
    try:
        from ef_core.database import get_async_session
        from sqlalchemy import text

        async for session in get_async_session():
            result = await session.execute(text("SELECT 1"))
            print("   ✓ Database connection OK")
            break
    except Exception as e:
        print(f"   ✗ Database connection failed: {e}")
        return False
    return True


async def test_api_keys_table():
    """测试api_keys表是否存在"""
    print("2. Testing api_keys table...")
    try:
        from ef_core.database import get_async_session
        from sqlalchemy import text

        async for session in get_async_session():
            result = await session.execute(
                text("SELECT COUNT(*) FROM api_keys")
            )
            count = result.scalar()
            print(f"   ✓ api_keys table exists, {count} keys found")
            break
    except Exception as e:
        print(f"   ✗ api_keys table check failed: {e}")
        return False
    return True


async def test_users_table():
    """测试users表"""
    print("3. Testing users table...")
    try:
        from ef_core.database import get_async_session
        from sqlalchemy import text

        async for session in get_async_session():
            result = await session.execute(
                text("SELECT COUNT(*) FROM users WHERE is_active = true")
            )
            count = result.scalar()
            print(f"   ✓ users table OK, {count} active users")
            break
    except Exception as e:
        print(f"   ✗ users table check failed: {e}")
        return False
    return True


async def test_api_key_service():
    """测试API Key服务"""
    print("4. Testing API Key service...")
    try:
        from ef_core.services.api_key_service import get_api_key_service

        service = get_api_key_service()
        test_key = service.generate_api_key()
        key_hash = service.hash_key(test_key)
        is_valid = service.verify_key(test_key, key_hash)

        if is_valid:
            print(f"   ✓ API Key service OK")
            print(f"   Generated key format: {test_key[:20]}...")
        else:
            print("   ✗ API Key verification failed")
            return False
    except Exception as e:
        print(f"   ✗ API Key service failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    return True


async def list_api_keys():
    """列出所有API Keys"""
    print("5. Listing all API keys...")
    try:
        from ef_core.database import get_async_session
        from ef_core.models.api_keys import APIKey
        from sqlalchemy import select

        async for session in get_async_session():
            stmt = select(APIKey)
            result = await session.execute(stmt)
            api_keys = result.scalars().all()

            if not api_keys:
                print("   ⚠ No API keys found in database")
            else:
                print(f"   Found {len(api_keys)} API key(s):")
                for key in api_keys:
                    status = "active" if key.is_active else "inactive"
                    expired = " (EXPIRED)" if (key.expires_at and key.expires_at < key.created_at) else ""
                    print(f"   - ID:{key.id} | Name:'{key.name}' | User:{key.user_id} | {status}{expired}")
            break
    except Exception as e:
        print(f"   ✗ Failed to list API keys: {e}")
        import traceback
        traceback.print_exc()
        return False
    return True


async def test_import_app():
    """测试应用导入"""
    print("6. Testing app import...")
    try:
        from ef_core.app import app
        print(f"   ✓ App imported successfully")
        print(f"   Number of routes: {len(app.routes)}")
    except Exception as e:
        print(f"   ✗ App import failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    return True


async def main():
    print("=" * 60)
    print("EuraFlow Remote API Key Diagnostic Tool")
    print("=" * 60)
    print()

    # 运行所有测试
    tests = [
        test_database,
        test_api_keys_table,
        test_users_table,
        test_api_key_service,
        list_api_keys,
        test_import_app,
    ]

    results = []
    for test in tests:
        result = await test()
        results.append(result)
        print()

    # 总结
    print("=" * 60)
    passed = sum(results)
    total = len(results)

    if passed == total:
        print(f"✓ All tests passed ({passed}/{total})")
        print()
        print("The system appears to be working correctly.")
        print("If you're still getting 500 errors, please:")
        print("1. Restart the backend service")
        print("2. Check the backend logs for detailed errors")
        print("3. Create a new API Key via the web interface")
    else:
        print(f"✗ Some tests failed ({passed}/{total} passed)")
        print()
        print("Please fix the issues above before proceeding.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
