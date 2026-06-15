FROM node:22-bookworm-slim

# Install Python runtime for FastAPI backend + supervisor (process manager)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    supervisor \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps (frontend — package.json at repo root)
COPY package.json package-lock.json* ./
RUN npm ci

# Python deps (backend)
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# App source
COPY frontend ./frontend
COPY backend ./backend
COPY supervisord.conf ./supervisord.conf

EXPOSE 5173
EXPOSE 8000

# Single container, two independently-restartable processes (api, frontend)
# managed by supervisord. Each auto-restarts on crash without bouncing the other.
CMD ["supervisord", "-c", "/app/supervisord.conf"]
