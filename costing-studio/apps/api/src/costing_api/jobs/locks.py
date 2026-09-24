from __future__ import annotations
import uuid
from contextlib import contextmanager

from .queue import redis_conn

_RELEASE = """
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
"""


@contextmanager
def tenant_lock(tenant_id: str, job_name: str, ttl: int = 1800):
    key = f"lock:{job_name}:{tenant_id}"
    token = str(uuid.uuid4())
    if not redis_conn.set(key, token, nx=True, ex=ttl):
        yield False
        return
    try:
        yield True
    finally:
        redis_conn.eval(_RELEASE, 1, key, token)   # only delete our own lock
