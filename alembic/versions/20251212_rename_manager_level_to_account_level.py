"""rename manager_level to account_level

Revision ID: rename_to_account_level
Revises: 91b675bedbc8
Create Date: 2024-12-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'rename_to_account_level'
down_revision: Union[str, None] = '91b675bedbc8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 重命名表: manager_levels -> account_levels
    op.rename_table('manager_levels', 'account_levels')

    # 2. 重命名 users 表的外键列: manager_level_id -> account_level_id
    op.alter_column('users', 'manager_level_id',
                    new_column_name='account_level_id')

    # 3. 删除旧的外键约束并创建新的
    op.drop_constraint('fk_users_manager_level_id', 'users', type_='foreignkey')
    op.create_foreign_key(
        'fk_users_account_level_id',
        'users', 'account_levels',
        ['account_level_id'], ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    # 1. 删除新外键，恢复旧外键
    op.drop_constraint('fk_users_account_level_id', 'users', type_='foreignkey')
    op.create_foreign_key(
        'fk_users_manager_level_id',
        'users', 'manager_levels',
        ['manager_level_id'], ['id'],
        ondelete='SET NULL'
    )

    # 2. 重命名列: account_level_id -> manager_level_id
    op.alter_column('users', 'account_level_id',
                    new_column_name='manager_level_id')

    # 3. 重命名表: account_levels -> manager_levels
    op.rename_table('account_levels', 'manager_levels')
