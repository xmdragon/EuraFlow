"""make watermark config shop optional

Revision ID: e2f6b8c3d7a1
Revises: 5345990a3d6b
Create Date: 2025-09-24 17:05:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e2f6b8c3d7a1'
down_revision = 'c8f9a2b3d4e5'
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(col['name'] == column for col in inspector.get_columns(table))


def _fk_exists(table: str, name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(fk['name'] == name for fk in inspector.get_foreign_keys(table))


def upgrade() -> None:
    """Allow watermark configs to be global by making shop_id nullable."""

    if _column_exists('watermark_configs', 'shop_id'):
        op.alter_column(
            'watermark_configs',
            'shop_id',
            existing_type=sa.BigInteger(),
            nullable=True
        )


def downgrade() -> None:
    """Revert watermark configs to be shop-specific."""

    op.execute("DELETE FROM watermark_configs WHERE shop_id IS NULL")
    op.alter_column('watermark_configs', 'shop_id', existing_type=sa.BigInteger(), nullable=False)
