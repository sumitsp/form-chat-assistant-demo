"""One-off: run the 3 sample scenarios through eligibility + LoanPASS pricing and
write the exact request/response payloads to logs/pricing_payloads_scenarios.txt.

Run:  python -m backend.tools._dump_pricing_payloads
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend import config
from backend.eligibility import EligibilityRequest, build_full_response
from backend.loanpass_client import (
    LoanpassError,
    LoanpassPricingUnavailableError,
    fetch_product_pricing,
    list_program_products,
    map_form_to_loanpass_fields,
    _pricing_request_body,
)

# Force the per-call JSON log so we can read back the exact request + response.
config.LOANPASS_PRICING_LOG_TO_FILE = True

# Dotted divider between scenarios (clearly separates the 3 blocks).
DOTTED = "." * 100
SCENARIO_DIVIDER = "\n\n" + DOTTED + "\n" + DOTTED + "\n\n"

SCENARIOS: list[dict[str, Any]] = [
    {
        "_label": "Scenario 1 — Purchase, CA, 85% LTV, Full Doc 24mo",
        "citizenship": "US Citizen",
        "occupancy": "Primary Residence",
        "loanPurpose": "Purchase",
        "primaryLoanPurpose": "Purchase",
        "lienPosition": "First Lien",
        "propertyType": "single_family",
        "valueSalesPrice": "600000",
        "loanAmount": "510000",
        "ltv": "85",
        "decisionCreditScore": "720",
        "firstTimeHomebuyer": "No",
        "investmentIncomePath": "personal_income",
        "documentationType": "Full Documentation",
        "documentationTimeframe": "24",
        "estimatedDti": "41",
        "reservesMonths": "6",
        "paymentHistory": "0x30x12",
        "creditEvent": "No",
        "state": "CA",
        "stateCounty": "Alameda County",
        "isRuralProperty": "No",
        "loanTerm": "No preference",
        "rateTypePref": "No Preference",
        "interestOnlyPref": "No preference",
    },
    {
        "_label": "Scenario 2 — Purchase, CA, 70% LTV, Full Doc",
        "citizenship": "US Citizen",
        "occupancy": "Primary Residence",
        "loanPurpose": "Purchase",
        "primaryLoanPurpose": "Purchase",
        "lienPosition": "First Lien",
        "propertyType": "single_family",
        "valueSalesPrice": "600000",
        "loanAmount": "420000",
        "ltv": "70",
        "cltv": "70",
        "decisionCreditScore": "720",
        "firstTimeHomebuyer": "No",
        "investmentIncomePath": "personal_income",
        "documentationType": "Full Documentation",
        "estimatedDti": "42",
        "reservesMonths": "6",
        "paymentHistory": "0x30x12",
        "creditEvent": "No",
        "state": "CA",
        "isRuralProperty": "No",
        "loanTerm": "No preference",
        "rateTypePref": "No Preference",
        "interestOnlyPref": "No preference",
    },
    {
        "_label": "Scenario 3 — Cash-Out Refi, FL (Lee), 71% LTV, Full Doc",
        "citizenship": "US Citizen",
        "occupancy": "Primary Residence",
        "loanPurpose": "Cash-Out Refinance",
        "primaryLoanPurpose": "Cash-Out Refinance",
        "lienPosition": "First Lien",
        "propertyType": "single_family",
        "valueSalesPrice": "850000",
        "loanAmount": "600000",
        "ltv": "71",
        "existingFirstLien": "400000",
        "cltv": "71",
        "decisionCreditScore": "720",
        "firstTimeHomebuyer": "No",
        "investmentIncomePath": "personal_income",
        "documentationType": "Full Documentation",
        "estimatedDti": "42",
        "paymentHistory": "0x30x12",
        "creditEvent": "No",
        "state": "FL",
        "stateCounty": "lee",
        "isRuralProperty": "No",
        "loanTerm": "No preference",
        "rateTypePref": "No Preference",
        "interestOnlyPref": "No",
    },
]

LOGS_DIR = config.REPO_ROOT / "logs"


def _newest_pricing_log() -> Path | None:
    if not LOGS_DIR.exists():
        return None
    files = sorted(
        LOGS_DIR.glob("loanpass_pricing_*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return files[0] if files else None


def _eligibility_request(form: dict[str, Any]) -> EligibilityRequest:
    payload = {k: v for k, v in form.items() if not k.startswith("_")}
    return EligibilityRequest(
        **{k: v for k, v in payload.items() if k in EligibilityRequest.model_fields}
    )


def _price_first_available(
    form: dict[str, Any], program_id: int, program_name: str
) -> dict[str, Any]:
    try:
        listing = list_program_products(form, program_id=program_id, program_name=program_name)
    except (LoanpassPricingUnavailableError, LoanpassError) as exc:
        return {"ok": False, "errors": [f"list products: {exc}"], "products_listed": []}
    products = listing.get("products") or []
    errors: list[str] = []
    for pt in products:
        ptid = pt.get("product_type_id")
        if ptid is None:
            continue
        try:
            result = fetch_product_pricing(
                form,
                program_id=program_id,
                program_name=program_name,
                product_type_id=int(ptid),
                product_label=pt.get("product_name"),
            )
            log_path = _newest_pricing_log()
            raw = json.loads(log_path.read_text(encoding="utf-8")) if log_path else None
            return {
                "ok": True,
                "product_type_id": ptid,
                "product_name": pt.get("product_name"),
                "result": result,
                "raw_log": raw,
                "errors_before_success": errors,
                "products_listed": products,
            }
        except (LoanpassPricingUnavailableError, LoanpassError) as exc:
            errors.append(f"{pt.get('product_name')} (ptid={ptid}): {exc}")
            continue
    return {"ok": False, "errors": errors, "products_listed": products}


def _render_scenario(form: dict[str, Any]) -> list[str]:
    out: list[str] = []
    label = form["_label"]
    out.append("#" * 100)
    out.append(f"## {label}")
    out.append("#" * 100)

    out.append("\n--- WIZARD FORM (our internal scenario) ---")
    out.append(json.dumps({k: v for k, v in form.items() if not k.startswith("_")}, indent=2))

    credit_fields = map_form_to_loanpass_fields(form)
    body = _pricing_request_body(credit_fields)
    out.append("\n--- LOANPASS REQUEST BODY (POST /api/execute-product, before productId) ---")
    out.append(json.dumps(body, indent=2))

    try:
        resp = build_full_response(_eligibility_request(form))
    except Exception as exc:  # noqa: BLE001
        out.append(f"\n[!] Eligibility failed: {exc}")
        return out

    out.append(f"\n--- ELIGIBLE PROGRAMS ({len(resp.eligible)}) ---")
    for p in resp.eligible:
        out.append(f"  - program_id={p.program_id}  {p.program_name}")
    if not resp.eligible:
        out.append("  (no eligible programs — cannot price)")
        return out

    priced: dict[str, Any] = {"ok": False, "errors": []}
    for candidate in resp.eligible:
        out.append(
            f"\n--- PRICING program_id={candidate.program_id} ({candidate.program_name}) ---"
        )
        try:
            priced = _price_first_available(
                form, int(candidate.program_id), candidate.program_name
            )
        except Exception as exc:  # noqa: BLE001
            out.append(f"[!] Pricing crashed: {exc}")
            priced = {"ok": False, "errors": [str(exc)]}
        if priced.get("ok"):
            break
        out.append("    (no pricing for this program, trying next) Errors:")
        for e in priced.get("errors", []):
            out.append(f"      - {e}")

    if not priced.get("ok"):
        out.append("[!] No product priced successfully for any eligible program.")
        return out

    out.append(
        f"Priced product: {priced['product_name']} (product_type_id={priced['product_type_id']})"
    )
    raw = priced.get("raw_log") or {}
    calls = raw.get("calls") or []
    if calls:
        call = calls[-1]
        out.append("\n--- EXACT LOANPASS REQUEST (with productId) ---")
        out.append(json.dumps(call.get("request"), indent=2))
        out.append(f"\n--- LOANPASS RESPONSE (HTTP {call.get('status_code')}) ---")
        resp_str = json.dumps(call.get("response"), indent=2)
        if len(resp_str) > 60000:
            resp_str = resp_str[:60000] + "\n... [truncated] ..."
        out.append(resp_str)

    out.append("\n--- PROCESSED PRICING OUTPUT (what our API returns to the UI) ---")
    out.append(json.dumps(dict(priced["result"]), indent=2, default=str))
    return out


def main() -> None:
    blocks: list[str] = []
    header = [
        "=" * 100,
        "LoanPASS PRICING API — INPUT / OUTPUT PAYLOADS FOR 3 SAMPLE SCENARIOS",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Focus lock days: {config.LOANPASS_FOCUS_LOCK_DAYS}",
        "=" * 100,
    ]
    blocks.append("\n".join(header))

    for form in SCENARIOS:
        blocks.append("\n".join(_render_scenario(form)))

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    target = LOGS_DIR / "pricing_payloads_scenarios.txt"
    # Header, then each scenario separated by a clear dotted divider.
    text = blocks[0] + "\n" + SCENARIO_DIVIDER.join(blocks[1:])
    target.write_text(text, encoding="utf-8")
    print(f"Wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
