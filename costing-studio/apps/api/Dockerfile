FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev libgomp1 \
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.5.11
WORKDIR /app
COPY pyproject.toml uv.lock* ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN uv sync --all-packages --extra dev
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
WORKDIR /app/apps/api
