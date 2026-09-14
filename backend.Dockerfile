# Backend image: the FastAPI read-only API.
# The same image is also used to run ingestion (python -m revive.ingest).
#
# Build context is the repo root (see docker-compose.yml), where backend/ lives
# alongside these deployment files.
FROM python:3.12-slim

WORKDIR /app

# Install deps first so this layer is cached when only source changes.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Only the package itself — never the .venv, tests, or anything else.
COPY backend/revive ./revive

# Drop zone for the periodic .xlsx; mounted from the host in docker-compose.
RUN mkdir -p /data/incoming /data/processed

EXPOSE 8000
# 0.0.0.0 so the other containers can reach it on the private network.
# It is NOT published to the internet — only Caddy talks to it.
CMD ["uvicorn", "revive.api:app", "--host", "0.0.0.0", "--port", "8000"]
