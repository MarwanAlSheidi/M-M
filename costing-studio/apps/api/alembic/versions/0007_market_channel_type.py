"""market_sources.channel_type: trade | retail | export | import (default trade).

The simulator excludes retail and import channels by default; callers can override.

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE market_sources ADD COLUMN channel_type text NOT NULL DEFAULT 'trade' "
               "CONSTRAINT ck_market_sources_channel_type "
               "CHECK (channel_type IN ('trade', 'retail', 'export', 'import'))")


def downgrade() -> None:
    op.execute("ALTER TABLE market_sources DROP COLUMN channel_type")
