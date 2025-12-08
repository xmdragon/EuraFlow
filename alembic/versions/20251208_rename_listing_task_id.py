"""rename listing_task_id to listing_task_count

Revision ID: rename_listing_task
Revises: add_composite_idx
Create Date: 2025-12-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'rename_listing_task'
down_revision: Union[str, None] = 'adc7d21ecd0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 删除旧列，添加新列（INTEGER 类型）
    op.drop_column('ozon_product_collection_records', 'listing_task_id')
    op.add_column(
        'ozon_product_collection_records',
        sa.Column('listing_task_count', sa.Integer(), nullable=True, comment='Celery 任务数量（变体数）')
    )


def downgrade() -> None:
    # 恢复旧列
    op.drop_column('ozon_product_collection_records', 'listing_task_count')
    op.add_column(
        'ozon_product_collection_records',
        sa.Column('listing_task_id', sa.String(500), nullable=True, comment='Celery 任务 ID（多变体时逗号分隔）')
    )
