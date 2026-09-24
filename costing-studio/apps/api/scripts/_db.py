"""Migrator sessions for scripts only (BYPASSRLS). Never import from the API."""
from __future__ import annotations
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

_url = os.environ.get("MIGRATOR_DATABASE_URL")
if not _url:
    raise RuntimeError("MIGRATOR_DATABASE_URL must be set for seed/script runs.")
MigratorSessionLocal = sessionmaker(create_engine(_url, pool_pre_ping=True), expire_on_commit=False)
