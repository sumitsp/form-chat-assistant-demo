"""
Health watchdog for the standalone LoanPASS pricing service.

`supervisord`'s ``autorestart`` only restarts the pricing process when it
*exits*. It does NOT catch a HANG — when LoanPASS rate-limits / token churn
leaves the process alive but unresponsive. This watchdog closes that gap: it
polls ``/api/loanpass/health`` and, after enough consecutive failures, runs
``supervisorctl restart pricing`` — restarting ONLY the pricing program, never
the main API or frontend.

Everything it does is logged loudly to stdout (so it shows up in the container
logs). Grep for ``PRICING WATCHDOG``.

Run as its own supervisor program (see supervisord.conf). Tunables via env:
  PRICING_HEALTH_URL   (default http://127.0.0.1:8090/api/loanpass/health)
  PRICING_WD_INTERVAL  seconds between probes              (default 15)
  PRICING_WD_TIMEOUT   per-probe HTTP timeout in seconds   (default 8)
  PRICING_WD_FAILS     consecutive fails before a restart  (default 3)
  PRICING_WD_PROGRAM   supervisor program name to restart  (default pricing)
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s PRICING WATCHDOG: %(message)s",
    stream=sys.stdout,
)
_log = logging.getLogger("pricing.watchdog")

HEALTH_URL = os.environ.get(
    "PRICING_HEALTH_URL", "http://127.0.0.1:8090/api/loanpass/health"
)
INTERVAL = float(os.environ.get("PRICING_WD_INTERVAL", "15"))
TIMEOUT = float(os.environ.get("PRICING_WD_TIMEOUT", "8"))
MAX_FAILS = int(os.environ.get("PRICING_WD_FAILS", "3"))
PROGRAM = os.environ.get("PRICING_WD_PROGRAM", "pricing")
SUPERVISOR_CONF = os.environ.get("SUPERVISOR_CONF", "/app/supervisord.conf")


def _probe() -> tuple[bool, str]:
    """Return (healthy, detail)."""
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=TIMEOUT) as resp:
            body = resp.read().decode("utf-8", "replace")
            if resp.status != 200:
                return False, f"HTTP {resp.status}"
            try:
                data = json.loads(body)
            except Exception:
                return False, f"bad JSON: {body[:120]}"
            if data.get("status") != "ok":
                pricing = data.get("pricing") or {}
                return False, (
                    f"status={data.get('status')!r} "
                    f"consecutive_failures={pricing.get('consecutive_failures')} "
                    f"last_error={pricing.get('last_error')!r}"
                )
            return True, f"pid={data.get('pid')} uptime={data.get('uptime_s')}s"
    except urllib.error.URLError as exc:  # connection refused / timeout
        return False, f"{type(exc).__name__}: {exc.reason}"
    except Exception as exc:  # noqa: BLE001 — never let the watchdog die
        return False, f"{type(exc).__name__}: {exc}"


def _restart() -> None:
    _log.warning(
        "RESTARTING program '%s' via supervisorctl (%d consecutive health failures)",
        PROGRAM,
        MAX_FAILS,
    )
    try:
        out = subprocess.run(
            ["supervisorctl", "-c", SUPERVISOR_CONF, "restart", PROGRAM],
            capture_output=True,
            text=True,
            timeout=60,
        )
        _log.warning(
            "supervisorctl restart %s -> rc=%s stdout=%s stderr=%s",
            PROGRAM,
            out.returncode,
            out.stdout.strip(),
            out.stderr.strip(),
        )
    except Exception as exc:  # noqa: BLE001
        _log.error("supervisorctl restart failed: %s: %s", type(exc).__name__, exc)


def main() -> None:
    _log.info(
        "started — polling %s every %.0fs (timeout %.0fs, restart '%s' after %d fails)",
        HEALTH_URL,
        INTERVAL,
        TIMEOUT,
        PROGRAM,
        MAX_FAILS,
    )
    fails = 0
    was_healthy = True
    while True:
        healthy, detail = _probe()
        if healthy:
            if not was_healthy:
                _log.info("pricing HEALTHY again (%s)", detail)
            fails = 0
            was_healthy = True
        else:
            fails += 1
            was_healthy = False
            _log.warning("pricing UNHEALTHY (%d/%d): %s", fails, MAX_FAILS, detail)
            if fails >= MAX_FAILS:
                _restart()
                fails = 0
                # Give the restarted process room to boot before re-probing.
                time.sleep(max(INTERVAL, 10))
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
