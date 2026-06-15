"""Delete eligibility trace logs from logs/.

Usage:
    python -m backend.tools.clean_logs                 # delete files older than 7 days
    python -m backend.tools.clean_logs --older-than 3d # custom age (d/h/m)
    python -m backend.tools.clean_logs --all           # delete everything
    python -m backend.tools.clean_logs --all --dry-run # preview only

The eligibility engine self-prunes when ELIGIBILITY_TRACE file logging is on
(keeps the most recent N files); this tool is for one-shot manual cleanup.
"""
from __future__ import annotations

import argparse
import re
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LOGS_DIR = REPO_ROOT / "logs"

_UNIT_SECONDS = {"d": 86400, "h": 3600, "m": 60}


def _parse_age(spec: str) -> float:
    m = re.fullmatch(r"\s*(\d+)\s*([dhm]?)\s*", spec.lower())
    if not m:
        raise SystemExit(f"Invalid --older-than value: {spec!r} (use e.g. 7d, 12h, 30m)")
    return int(m.group(1)) * _UNIT_SECONDS[m.group(2) or "d"]


def main() -> None:
    ap = argparse.ArgumentParser(description="Delete logs/*.txt eligibility trace files.")
    group = ap.add_mutually_exclusive_group()
    group.add_argument(
        "--older-than",
        default="7d",
        help="Delete files older than this age (e.g. 7d, 12h, 30m). Default: 7d.",
    )
    group.add_argument("--all", action="store_true", help="Delete ALL trace files.")
    ap.add_argument(
        "--dry-run", action="store_true", help="List what would be deleted without deleting."
    )
    args = ap.parse_args()

    if not LOGS_DIR.is_dir():
        print(f"No logs directory at {LOGS_DIR}")
        return

    files = sorted(LOGS_DIR.glob("*.txt"))
    if not args.all:
        cutoff = time.time() - _parse_age(args.older_than)
        files = [f for f in files if f.stat().st_mtime < cutoff]

    if not files:
        print("Nothing to delete.")
        return

    total = sum(f.stat().st_size for f in files)
    for f in files:
        if args.dry_run:
            print(f"[dry-run] {f.name}")
        else:
            f.unlink(missing_ok=True)

    verb = "Would delete" if args.dry_run else "Deleted"
    print(f"{verb} {len(files)} file(s), {total / 1_048_576:.1f} MB from {LOGS_DIR}")


if __name__ == "__main__":
    main()
