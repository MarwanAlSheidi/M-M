from rq import Worker

from .jobs.queue import queue, redis_conn

if __name__ == "__main__":
    Worker([queue], connection=redis_conn).work()
