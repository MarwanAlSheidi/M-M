"""tenant_cost_config.insurance_rate: cargo insurance on (purchase + freight) x 110%.

Charged only where the buyer insures (EXW/FOB/CFR). Before this, nothing set
DealInputs.insurance_rate, so the API never charged insurance.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tenant_cost_config ADD COLUMN insurance_rate numeric(6,4) NOT NULL DEFAULT 0 "
               "CONSTRAINT ck_tcc_insurance_rate CHECK (insurance_rate >= 0 AND insurance_rate < 1)")


def downgrade() -> None:
    op.execute("ALTER TABLE tenant_cost_config DROP COLUMN insurance_rate")
