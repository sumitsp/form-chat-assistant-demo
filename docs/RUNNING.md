# How to run

## Requirements

| Requirement | Notes |
|---|---|
| Node.js **22+** | Frontend; `npm ci` from repo root |
| Python **3.12** | **3.13 not supported** |
| `.env` at repo root | Copy from `.env.example` |

**Required for matching + chat:** `QDRANT_URL`, `OPENAI_API_KEY`, `MYSQL_*`  
**Optional for pricing:** `LOANPASS_*` — see [PRICING.md](./PRICING.md)

## Environment

```bash
cp .env.example .env
```

| Variable group | Purpose |
|---|---|
| `QDRANT_URL` | Vector store for guideline RAG and matrix cross-check |
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL` | Chat advisor, intake extraction, embeddings |
| `EMBEDDING_PROVIDER`, `OPENAI_EMBEDDING_MODEL`, `VECTOR_SIZE` | Must match ingest (1536 for `text-embedding-3-small`) |
| `MYSQL_*` | Structured eligibility tables (`dim_*`, `map_*`) |
| `LOANPASS_*` | Live pricing (optional) |
| `LOG_LEVEL`, `LOG_API_IO`, `LOG_API_IO_FILE` | Request/response logging — **disable `LOG_API_IO` in prod** (PII) |
| `ELIGIBILITY_TRACE`, `ELIGIBILITY_TRACE_KEEP` | Per-program trace files in `logs/` (debug only) |
| `MOUNT_PRICING_INLINE=1` | Fold pricing into main API for single-process dev |

## Install

```bash
python3.12 -m venv venv && source venv/bin/activate
pip install -U pip && pip install -r requirements.txt   # torch is large — let it finish
npm ci
```

Quick sanity check after editing Python:

```bash
python -c "import backend.api; import backend.eligibility; print('OK')"
```

## Database (first time)

```bash
mysql -u root -p newpoint_mortgage < ingest/schema.sql
# Apply every file in ingest/migrations/ in numeric order (001–019)
```

Then load lender data (from repo root, venv active):

```bash
python ingest/lenders/denali_flow_to_mysql_qdrant.py --apply
python ingest/lenders/everest_deephaven_flow_to_mysql_qdrant.py --apply
python ingest/lenders/summit_verus_flow_to_mysql_qdrant.py --apply
python ingest/lenders/denali_nqm_guidelines_qdrant.py --apply
python ingest/lenders/everest_deephaven_guidelines_qdrant.py --apply
python ingest/lenders/summit_verus_guidelines_qdrant.py --apply
```

Details: `ingest/README.md`.

## Local dev — three processes

Run from **repo root** with venv active (`source venv/bin/activate`).

| Command | Service | Port |
|---|---|---|
| `npm run dev:api` | Main API (`backend.api:app`) | **8000** |
| `npm run dev:pricing` | LoanPASS pricing (`backend.pricing_app:app`) | **8001** |
| `npm run dev` | Vite UI | **5173** |

**Equivalent uvicorn commands** (same as the npm scripts above):

```bash
# Main API — eligibility, chat intake, RAG, PDF, form history
python -m uvicorn backend.api:app --reload --host 0.0.0.0 --port 8000

# LoanPASS pricing (optional; only if LOANPASS_* is set)
python -m uvicorn backend.pricing_app:app --reload --host 0.0.0.0 --port 8001
```

Without auto-reload (closer to prod / Docker):

```bash
python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000
python -m uvicorn backend.pricing_app:app --host 0.0.0.0 --port 8001
```

Bind to localhost only if you don't need LAN access:

```bash
python -m uvicorn backend.api:app --reload --host 127.0.0.1 --port 8000
python -m uvicorn backend.pricing_app:app --reload --host 127.0.0.1 --port 8001
```

Open **http://localhost:5173**. Vite proxies `/api/*` → 8000 and `/api/loanpass/*` → 8001.

On macOS with an external SSD, prefer **`npm run dev:macos`** for the frontend — removes `._*` AppleDouble sidecars before starting (they break Python imports on exFAT). Run **`npm run clean:macos`** before uvicorn if you hit import errors on the API. The API also strips `._*` from the active venv's `site-packages` at startup.

Other useful scripts:

```bash
npm run lint              # ESLint (frontend)
npm run format            # Prettier — run after editing .tsx
npm run clean:macos       # Remove AppleDouble files only
npm run clean:logs        # Prune logs/*.txt older than 7 days
python -m backend.tools.clean_logs --all   # Delete all trace/log dumps
```

Health checks:

- Main API: `GET http://localhost:8000/api/health`
- Pricing: `GET http://localhost:8001/api/loanpass/health`

## Docker (one container)

Supervisord runs **api**, **pricing**, **frontend**, and a **pricing watchdog**.

```bash
docker build -t newpoint-assistant .
docker run --rm -p 5173:5173 -p 8000:8000 -p 8001:8001 --env-file .env newpoint-assistant

docker exec <container> supervisorctl status
docker exec <container> supervisorctl restart pricing   # bounce pricing only
```

## Deploy

Every push to **`main`** auto-deploys to production (GitHub Action → SSH → `docker compose up -d --build` → health check). There is no CI test gate — run `npm run lint` and `npm run format` before pushing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `UnicodeDecodeError` in `transformers` / import errors | Broken venv or `._*` files — recreate venv with Python 3.12; run `npm run clean:macos` |
| OpenAI key errors at startup | `.env` must be at **repo root**, not only in `frontend/` |
| Eligible count stuck at 0 | Check `MYSQL_*`, run ingest scripts, confirm tables populated |
| Pricing unavailable but app works | Expected without `LOANPASS_*`; restart pricing service or check `/api/loanpass/health` |
| Qdrant / RAG failures on Submit | Check `QDRANT_URL`; full eligibility still returns SQL matches, notes may be thin |
| AppleDouble keeps returning | On external disks: `dot_clean` on the volume or `com.apple.metadata:com_apple_backup_excludeItem` — see macOS docs |
