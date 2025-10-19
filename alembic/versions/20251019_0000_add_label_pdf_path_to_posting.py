"""add label_pdf_path to ozon_postings

Revision ID: add_label_pdf_path
Revises: adf94d01c529
Create Date: 2025-10-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_label_pdf_path'
down_revision = 'adf94d01c529'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """添加标签PDF文件路径字段"""
    op.add_column(
        'ozon_postings',
        sa.Column(
            'label_pdf_path',
            sa.String(500),
            nullable=True,
            comment='标签PDF文件路径（70x125mm竖向格式）'
        )
    )


def downgrade() -> None:
    """回滚：删除标签PDF文件路径字段"""
    op.drop_column('ozon_postings', 'label_pdf_path')
