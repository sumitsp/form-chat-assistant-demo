# Pricing — live rates via LoanPASS

## What it is

After eligibility matching, the app can fetch **live product pricing** from **LoanPASS** for each matched program that has a `program_name_loanpass` link in MySQL (migration 017).

Shown on program cards and in **Results: Comparison Summary** (side-by-side rate/price columns).

**Pricing is optional.** Without LoanPASS credentials, intake, matching, Know More, and results Q&A work; Compare/pricing controls are unavailable or show empty.

## Architecture

Pricing runs as a **separate FastAPI app** so LoanPASS latency, token refresh, or hangs never take down intake or eligibility:

| Process | Port | Routes |
|---|---|---|
| Main API | 8080 | `/api/eligibility`, `/api/chat`, … |
| Pricing service | 8090 | `/api/loanpass/*` |
| Vite dev proxy | 5173 | `/api/loanpass` → 8090, other `/api` → 8080 |

Docker: supervisord runs api + pricing + frontend + a **watchdog** that restarts pricing if `/api/loanpass/health` fails.

Single-process dev: set **`MOUNT_PRICING_INLINE=1`** to mount the same router on the main API (8080).

## Request flow

1. User opens **Check pricing** on a matched program (or Compare).
2. Frontend calls pricing API with program id + scenario snapshot.
3. Backend maps wizard fields → LoanPASS application fields (`loanpass_fields.py`).
4. Client logs into LoanPASS (`loanpass_client.py`), runs product pricing (execute-summary / execute-product).
5. Grid returned to UI — lock period from **`LOANPASS_FOCUS_LOCK_DAYS`** (default 30).

Program ↔ LoanPASS product mapping lives in the database so renames on either side can be reconciled without redeploying code.

## Setup

In `.env`:

```bash
LOANPASS_ORIGIN=https://app.loanpass.io
LOANPASS_CLIENT_ACCESS_ID=newpoint
LOANPASS_EMAIL=
LOANPASS_PASSWORD=
```

Optional:

| Variable | Purpose |
|---|---|
| `LOANPASS_PRICING_LOG=1` | Dump request/response JSON to `logs/loanpass_pricing_*.json` |
| `LOANPASS_PRICING_LOG_KEEP` | Max log files to retain |
| `LOANPASS_FOCUS_LOCK_DAYS` | Lock days sent to LoanPASS and shown in grid |
| `VITE_PRICING_BASE_URL` | Frontend override when pricing is on another host (prod) |

## Operations

```bash
npm run dev:pricing                                    # local
curl http://localhost:8090/api/loanpass/health         # health
docker exec <container> supervisorctl restart pricing   # Docker bounce
```

If pricing is down, eligibility results remain; only rate columns fail. Check logs for `PRICING WATCHDOG` restart lines.

## Field mapping (high level)

Scenario inputs translated include: loan amount, LTV/CLTV, FICO, occupancy, purpose, doc type, DTI/DSCR, state, property type, lien position, and product-specific flags required by LoanPASS's application schema. Exact mapping is in `backend/loanpass_fields.py`.

---

*Code: `backend/pricing_app.py`, `backend/loanpass_routes.py`, `backend/loanpass_client.py`, watchdog `backend/tools/pricing_watchdog.py`.*
