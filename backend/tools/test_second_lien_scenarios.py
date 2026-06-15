#!/usr/bin/env python3
"""Run second-lien eligibility scenario checks against live MySQL."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO))

from dotenv import load_dotenv

load_dotenv(_REPO / ".env")

from backend.eligibility import _layer1_programs, _normalise_form, find_eligible_programs
from sqlalchemy import create_engine


def _engine():
    return create_engine(
        f"mysql+pymysql://{os.environ['MYSQL_USER']}:{os.environ['MYSQL_PASSWORD']}"
        f"@{os.environ['MYSQL_HOST']}:{os.environ.get('MYSQL_PORT', '3306')}"
        f"/{os.environ['MYSQL_DATABASE']}"
    )


# Payload shape matching buildEligibilityPayloadFromForm + wizard sync
BASE = {
    "occupancy": "Primary Residence",
    "documentationType": "Full Doc",
    "decisionCreditScore": "720",
    "loanAmount": "100000",
    "valueSalesPrice": "500000",
    "ltv": "20",
    "cltv": "80",
    "citizenship": "US Citizen",
    "propertyType": "Single Family",
    "state": "FL",
    "estimatedDti": "35",
    "creditEvent": "None",
    "isSecondLien": "no",
    "firstTimeHomebuyer": "no",
    "firstTimeInvestor": "no",
    "paymentHistory": "0x30",
    "existingFirstLien": "300000",
}

SCENARIOS = [
    {
        "name": "1. First lien purchase",
        "payload": {
            **BASE,
            "lienPosition": "first_lien",
            "primaryLoanPurpose": "Purchase",
            "loanPurpose": "Purchase",
            "isSecondLien": "no",
            "ltv": "80",
            "cltv": "80",
            "loanAmount": "400000",
            "existingFirstLien": "",
        },
        "expect_l1_second": [],
        "expect_any_eligible": True,
    },
    {
        "name": "2. Piggyback purchase (full payload)",
        "payload": {
            **BASE,
            "lienPosition": "second_lien_piggyback",
            "primaryLoanPurpose": "Purchase",
            "loanPurpose": "Purchase",
            "isSecondLien": "yes",
            "ltv": "10",
            "cltv": "90",
            "loanAmount": "50000",
            "existingFirstLien": "400000",
        },
        "expect_l1_second": ["NQM_SECOND_LIEN_SELECT", "VMC_CLOSED_END_SECOND"],
        "expect_any_eligible": None,
    },
    {
        "name": "3. Standalone HELOC + cash-out",
        "payload": {
            **BASE,
            "lienPosition": "second_lien",
            "secondLienProduct": "heloc",
            "primaryLoanPurpose": "Cash-Out Refinance",
            "loanPurpose": "Cash-Out Refinance",
            "isSecondLien": "yes",
            "ltv": "10",
            "cltv": "75",
            "loanAmount": "100000",
        },
        "expect_l1_second": ["VMC_HELOC"],
        "expect_any_eligible": None,
    },
    {
        "name": "3b. Standalone HELOC + Rate & Term (UI purpose → cash_out for match)",
        "payload": {
            **BASE,
            "lienPosition": "second_lien",
            "secondLienProduct": "heloc",
            "primaryLoanPurpose": "Refinance",
            "loanPurpose": "Refinance",
            "isSecondLien": "yes",
            "ltv": "10",
            "cltv": "60",
            "loanAmount": "100000",
            "existingFirstLien": "500000",
            "valueSalesPrice": "1000000",
            "firstTimeHomebuyer": "no",
        },
        "expect_l1_second": ["VMC_HELOC"],
        "expect_any_eligible": None,
    },
    {
        "name": "4. Standalone HELOAN (closed_ended)",
        "payload": {
            **BASE,
            "lienPosition": "second_lien",
            "secondLienProduct": "heloan",
            "primaryLoanPurpose": "Refinance",
            "loanPurpose": "Refinance",
            "isSecondLien": "yes",
            "occupancy": "Investment Property",
            "ltv": "15",
            "cltv": "80",
            "loanAmount": "80000",
        },
        "expect_l1_second": ["NQM_SECOND_LIEN_SELECT"],
        "expect_any_eligible": None,
    },
    {
        "name": "5. Standalone second, no product (tag filter off)",
        "payload": {
            **BASE,
            "lienPosition": "second_lien",
            "primaryLoanPurpose": "Refinance",
            "loanPurpose": "Refinance",
            "isSecondLien": "yes",
        },
        "expect_l1_second": None,  # any is_second_lien=1
        "expect_min_l1_second": 3,
        "expect_any_eligible": None,
    },
    {
        "name": "6. Legacy payload (isSecondLien only, piggyback intent)",
        "payload": {
            **BASE,
            "loanPurpose": "Purchase",
            "isSecondLien": "yes",
            "ltv": "10",
            "cltv": "90",
            "loanAmount": "50000",
            "existingFirstLien": "400000",
        },
        "expect_l1_second": None,
        "expect_min_l1_second": 3,
        "note": "No lienPosition — piggyback tag filter may not run",
    },
]


def second_codes(programs: list) -> list[str]:
    return sorted(p["program_code"] for p in programs if p.get("is_second_lien"))


def main() -> int:
    failures: list[str] = []
    engine = _engine()

    print(f"Database: {os.environ.get('MYSQL_DATABASE')} @ {os.environ.get('MYSQL_HOST')}\n")

    with engine.connect() as conn:
        for sc in SCENARIOS:
            raw = sc["payload"]
            form = _normalise_form(raw)
            l1 = _layer1_programs(conn, form, quick=False)
            got = second_codes(l1)

            print(f"=== {sc['name']} ===")
            print(
                f"  norm: is_second={form['is_second_lien']} piggy={form['is_piggyback']} "
                f"product={form['second_lien_product']!r} purpose={form['loan_purpose']}"
            )
            print(f"  Layer1 2nd-lien: {got}")

            exp = sc.get("expect_l1_second")
            if exp is not None:
                if got != sorted(exp):
                    msg = f"  FAIL Layer1: expected {sorted(exp)}, got {got}"
                    print(msg)
                    failures.append(f"{sc['name']}: {msg}")
                else:
                    print("  OK Layer1")
            elif sc.get("expect_min_l1_second"):
                if len(got) < sc["expect_min_l1_second"]:
                    msg = f"  FAIL Layer1: expected >= {sc['expect_min_l1_second']} programs, got {len(got)}"
                    print(msg)
                    failures.append(f"{sc['name']}: {msg}")
                else:
                    print(f"  OK Layer1 (>= {sc['expect_min_l1_second']} programs)")

            if sc.get("note"):
                print(f"  Note: {sc['note']}")

            try:
                full = find_eligible_programs(raw, quick=False)
                eligible = full.get("eligible") or []
                codes = sorted(
                    {
                        (e.get("program_code") or e.get("program_name") or "")
                        for e in eligible
                        if e.get("is_second_lien") or "SECOND" in str(e.get("program_code", ""))
                        or "HELOC" in str(e.get("program_code", ""))
                        or "EQUITY" in str(e.get("program_code", ""))
                    }
                )
                print(f"  Full run eligible (2nd-related): {codes or '(none)'} (total eligible={len(eligible)})")
            except Exception as ex:
                print(f"  Full run error: {ex}")
                failures.append(f"{sc['name']}: full run failed: {ex}")

            print()

    if failures:
        print("FAILED:", len(failures))
        for f in failures:
            print(" -", f)
        return 1

    print("All scenario checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
