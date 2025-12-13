"""add_label_printed_by_to_ozon_postings

Revision ID: 0e3e0663a0ce
Revises: rename_to_account_level
Create Date: 2025-12-13 16:42:26.338420

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0e3e0663a0ce'
down_revision = 'rename_to_account_level'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加 label_printed_by 字段，记录标签打印操作人
    op.add_column(
        'ozon_postings',
        sa.Column('label_printed_by', sa.Integer(), nullable=True, comment='标签打印操作人ID')
    )
    # 添加外键约束
    op.create_foreign_key(
        'fk_ozon_postings_label_printed_by',
        'ozon_postings',
        'users',
        ['label_printed_by'],
        ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    """Downgrade database schema"""
    op.drop_constraint('fk_ozon_postings_label_printed_by', 'ozon_postings', type_='foreignkey')
    op.drop_column('ozon_postings', 'label_printed_by')