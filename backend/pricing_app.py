"""
Standalone LoanPASS pricing service.

Run this as its OWN process so LoanPASS hiccups (rate limits, token churn) can be
restarted without bouncing the main API:

    python -m uvicorn backend.pricing_app:app --reload --host 0.0.0.0 --port 8090

It serves only ``/api/loanpass/*`` (the same router the main API can mount
inline). The frontend reaches it through the Vite proxy rule for
``/api/loanpass`` (dev) or a reverse-proxy / ``VITE_PRICING_BASE_URL`` (prod).
"""

from __future__ import annotations

import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Repo root (parent of `backend/`) on sys.path so `backend.*` imports resolve
# when launched as `uvicorn backend.pricing_app:app`.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.connections.logging import setup_logging  # noqa: E402
from backend.loanpass_routes import router as loanpass_router  # noqa: E402

setup_logging()
_log = logging.getLogger("backend.pricing")

# Process start time — surfaced in /health as uptime so the watchdog (and you)
# can SEE in the logs whether/when the process actually restarted.
_STARTED_AT = time.time()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Loud, greppable banner on EVERY (re)start so supervisor restarts are
    # obvious in the container logs: `grep "PRICING SERVICE" logs`.
    _log.info(
        "================ PRICING SERVICE STARTED (pid=%s, port=8090) ================",
        os.getpid(),
    )
    yield
    _log.info(
        "================ PRICING SERVICE STOPPING (pid=%s, uptime=%.0fs) ================",
        os.getpid(),
        time.time() - _STARTED_AT,
    )


app = FastAPI(title="Newpoint Mortgage Pricing API", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https?://newpointassist\.algodel\.com(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(loanpass_router)


@app.get("/api/loanpass/health")
def health() -> dict[str, object]:
    """Health probe for the pricing service (polled by the watchdog).

    Returns ``status: "degraded"`` (not just liveness) once LoanPASS calls have
    been consistently failing, so the watchdog restarts pricing and clears the
    stale cached session token.
    """
    from backend.loanpass_client import pricing_health_snapshot  # noqa: PLC0415

    snap = pricing_health_snapshot()
    return {
        "status": snap.get("status", "ok"),
        "service": "pricing",
        "pid": os.getpid(),
        "uptime_s": round(time.time() - _STARTED_AT, 1),
        "pricing": {
            "consecutive_failures": snap.get("consecutive_failures"),
            "total_success": snap.get("total_success"),
            "total_failure": snap.get("total_failure"),
            "last_error": snap.get("last_error"),
            "last_success_ts": snap.get("last_success_ts"),
            "last_failure_ts": snap.get("last_failure_ts"),
        },
    }
