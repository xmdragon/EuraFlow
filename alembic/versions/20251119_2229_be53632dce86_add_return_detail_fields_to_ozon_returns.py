"""add_return_detail_fields_to_ozon_returns

Revision ID: be53632dce86
Revises: 701c33360ec4
Create Date: 2025-11-19 22:29:40.288842

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'be53632dce86'
down_revision = '701c33360ec4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema"""
    # 添加退货详情字段
    op.add_column('ozon_returns', sa.Column('return_reason_id', sa.Integer(), nullable=True, comment='退货原因ID'))
    op.add_column('ozon_returns', sa.Column('return_reason_name', sa.String(length=500), nullable=True, comment='退货原因名称'))
    op.add_column('ozon_returns', sa.Column('rejection_reason_id', sa.Integer(), nullable=True, comment='拒绝原因ID'))
    op.add_column('ozon_returns', sa.Column('rejection_reason_name', sa.String(length=500), nullable=True, comment='拒绝原因名称'))
    op.add_column('ozon_returns', sa.Column('rejection_reasons', sa.dialects.postgresql.JSONB(), nullable=True, comment='拒绝原因列表（详情数据）'))
    op.add_column('ozon_returns', sa.Column('return_method_description', sa.Text(), nullable=True, comment='退货方式描述'))
    op.add_column('ozon_returns', sa.Column('available_actions', sa.dialects.postgresql.JSONB(), nullable=True, comment='可用操作列表'))


def downgrade() -> None:
    """Downgrade database schema"""
    # 删除退货详情字段
    op.drop_column('ozon_returns', 'available_actions')
    op.drop_column('ozon_returns', 'return_method_description')
    op.drop_column('ozon_returns', 'rejection_reasons')
    op.drop_column('ozon_returns', 'rejection_reason_name')
    op.drop_column('ozon_returns', 'rejection_reason_id')
    op.drop_column('ozon_returns', 'return_reason_name')
    op.drop_column('ozon_returns', 'return_reason_id')