from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str                       # costing_app (API runtime, RLS enforced)
    migrator_database_url: str | None = None  # alembic only; never used by the API
    worker_database_url: str | None = None    # costing_worker (global reference writes)
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str
    env: str = "dev"
    cors_origins: list[str] = ["http://localhost:5173"]
    model_store_root: str = "/var/lib/costing/models"
    upload_root: str = "/var/lib/costing/uploads"
    max_upload_mb: int = 10
    max_import_rows: int = 5000


settings = Settings()
