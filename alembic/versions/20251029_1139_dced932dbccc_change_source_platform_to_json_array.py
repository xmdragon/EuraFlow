"""change_source_platform_to_json_array

Revision ID: dced932dbccc
Revises: 69b70be6016c
Create Date: 2025-10-29 11:39:32.569199

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'dced932dbccc'
down_revision = '69b70be6016c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """将 source_platform 从 String 改为 JSONB 数组"""
    # 1. 添加新的 JSONB 列
    op.add_column('ozon_postings', sa.Column('source_platforms_temp', postgresql.JSONB(), nullable=True))

    # 2. 迁移旧数据：将 source_platform 转为数组存入 source_platforms_temp
    op.execute("""
        UPDATE ozon_postings
        SET source_platforms_temp =
            CASE
                WHEN source_platform IS NOT NULL AND source_platform != ''
                THEN jsonb_build_array(source_platform)
                ELSE NULL
            END
    """)

    # 3. 删除旧列
    op.drop_column('ozon_postings', 'source_platform')

    # 4. 重命名新列为原列名（为了向后兼容）
    op.alter_column('ozon_postings', 'source_platforms_temp', new_column_name='source_platform')

    # 5. 添加 GIN 索引（适用于 JSONB 查询）
    op.create_index('ix_ozon_postings_source_platform_gin', 'ozon_postings', ['source_platform'], postgresql_using='gin')


def downgrade() -> None:
    """回滚：将 JSONB 数组改回 String"""
    # 1. 删除索引
    op.drop_index('ix_ozon_postings_source_platform_gin', table_name='ozon_postings')

    # 2. 添加临时的旧格式列
    op.add_column('ozon_postings', sa.Column('source_platform_old', sa.String(50), nullable=True))

    # 3. 迁移数据：取第一个平台
    op.execute("""
        UPDATE ozon_postings
        SET source_platform_old = source_platform->>0
        WHERE source_platform IS NOT NULL AND jsonb_array_length(source_platform) > 0
    """)

    # 4. 删除 JSONB 列
    op.drop_column('ozon_postings', 'source_platform')

    # 5. 重命名为原列名
    op.alter_column('ozon_postings', 'source_platform_old', new_column_name='source_platform')