from redis import Redis
from rq import Queue

from ..settings import settings

redis_conn = Redis.from_url(settings.redis_url)
queue = Queue("costing", connection=redis_conn, default_timeout=1800)
