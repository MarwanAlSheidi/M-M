"""Scheduler process: enqueues nightly jobs (Asia/Muscat). The RQ worker executes them."""
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from ..db import SessionLocal
from .enqueue import enqueue


def _tenant_ids() -> list[str]:
    # tenants is RLS-protected; list via the security-definer function.
    with SessionLocal() as s:
        return [str(r[0]) for r in s.execute(text("SELECT id FROM list_tenant_ids()")).all()]


def _per_tenant(job_name: str):
    def _run():
        for tid in _tenant_ids():
            enqueue(job_name, tid)
    return _run


def main():
    sched = BlockingScheduler(timezone="Asia/Muscat")
    sched.add_job(lambda: enqueue("fx_refresh", None), CronTrigger(hour=1, minute=0), id="fx_refresh")
    sched.add_job(_per_tenant("market_refresh"), CronTrigger(hour=1, minute=30), id="market_refresh")
    sched.add_job(_per_tenant("envelope_recompute"), CronTrigger(hour=2, minute=0), id="envelope_recompute")
    sched.add_job(_per_tenant("retrain"), CronTrigger(hour=3, minute=0), id="retrain")
    sched.start()


if __name__ == "__main__":
    main()
