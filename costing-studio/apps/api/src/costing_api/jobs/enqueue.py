from .base import JOB_MODULES, run_job
from .queue import queue

JOB_NAMES = set(JOB_MODULES)


def enqueue(job_name: str, tenant_id: str | None):
    return queue.enqueue(run_job, job_name, tenant_id, job_timeout=1800, result_ttl=86400)
