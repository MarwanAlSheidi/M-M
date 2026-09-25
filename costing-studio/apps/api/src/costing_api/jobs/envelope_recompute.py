"""Nightly: recompute every product's envelope (and market position) and store a snapshot.
Products not yet configured (no cost elements / margin) are reported, not failed."""
from __future__ import annotations

from ..repos import product_repo
from ..services.envelope_service import EnvelopeNotConfigured, build_envelope


def run(session, tenant_id=None):
    if not tenant_id:
        return {"skipped": True, "reason": "requires tenant_id"}
    ids = product_repo.list_product_ids(session, tenant_id)
    if not ids:
        return {"skipped": True, "reason": "no products"}
    stored, unconfigured = 0, []
    for pid in ids:
        try:
            with session.begin_nested():
                build_envelope(session, tenant_id, pid, computed_by="envelope_recompute")
            stored += 1
        except EnvelopeNotConfigured as e:
            unconfigured.append(str(e))
    reason = f"{len(unconfigured)} not configured: " + "; ".join(unconfigured[:5]) if unconfigured else None
    return {"rows": stored, "reason": reason}
