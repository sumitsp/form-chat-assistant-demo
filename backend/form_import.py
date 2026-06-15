"""Parse uploaded 1003 PDFs and Fannie MISMO 3.4 XML/HTML into wizard field dicts."""

from __future__ import annotations

import io
import json
import re
import xml.etree.ElementTree as ET
from typing import Any

from backend import config

_WIZARD_FIELD_HINT = (
    "Extract structured mortgage intake fields. Return JSON only (no markdown). "
    "All values must be strings. Omit fields you cannot confidently infer.\n\n"
    "CHECKBOX RULES: In 1003 PDF text, checked boxes often appear as a lowercase 'l' or digit '4' "
    "immediately before the selected label (e.g. 'l Investment Property', 'l Purchase Refinance'). "
    "Use ONLY the option directly marked — never default citizenship to US Citizen.\n\n"
    "FIELD REFERENCE (use exact values shown):\n"
    "  citizenship: 'US Citizen' | 'Permanent Resident Alien' | 'Non-Permanent Resident Alien' | 'Foreign National'\n"
    "  occupancy: 'Primary Residence' | 'Second Home' | 'Investment Property'\n"
    "  loanPurpose: 'Purchase' | 'Refinance' | 'Cash-Out Refinance'\n"
    "  lienPosition: 'first_lien' | 'second_lien' | 'second_lien_piggyback'\n"
    "  propertyType: 'Single Family' | 'Condo' | 'Townhouse' | '2-4 unit' | '5-8 unit' | 'Manufactured' | 'Mixed Use'\n"
    "  investmentIncomePath: 'income' | 'dscr' (use 'dscr' when investment property has rental income)\n"
    "  dscr: decimal string — gross monthly rent divided by total monthly PITIA\n"
    "  rentalType: 'Long-term rental' | 'Short-term rental'\n"
    "  documentationType: 'Full Documentation' | 'Bank Statements (12 or 24 Months)' | "
    "'1099' | 'Asset Utilization' | 'P&L with 2 Month Bank Statement' | 'Alternative Documentation'\n"
    "  prepaymentTerms: '5 Year' | '4 Year' | '3 Year' | '2 Year' | '1 Year' | 'No Penalty'\n"
    "  firstTimeHomebuyer: 'Yes' | 'No'\n"
    "  state: 2-letter US state code\n"
    "  valueSalesPrice, loanAmount, existingFirstLien, existingSecondLienBalance, cashInHandRequest: "
    "numeric strings (digits only, no $ or commas)\n"
    "  ltv, estimatedDti: integer percent string\n"
    "  decisionCreditScore: integer 300–850\n"
    "  existingSecondLien: 'None' | 'Yes — needs subordination' | 'Yes — being paid off in this transaction'\n"
    "  existingSecondLienBalance: numeric string (digits only) when a subordinate lien balance is stated\n"
    "  paymentHistory: '0x30x12' | '1x30x12' | '0x60x12' | '1x60x12' (if stated)\n"
    "Do not guess values that are not clearly stated."
)

# Docusign / pdfplumber often renders checked 1003 boxes as "l <label>" or "4 <label>".
_CHECK_MARK = r"(?:l|4)\s+"

_CITIZENSHIP_CHECKS: list[tuple[str, str]] = [
    ("Non-Permanent Resident Alien", "Non-Permanent Resident Alien"),
    ("Permanent Resident Alien", "Permanent Resident Alien"),
    ("U.S. Citizen", "US Citizen"),
    ("US Citizen", "US Citizen"),
    ("Foreign National", "Foreign National"),
]

_OCCUPANCY_CHECKS: list[tuple[str, str]] = [
    ("Investment Property", "Investment Property"),
    ("Second Home", "Second Home"),
    ("Primary Residence", "Primary Residence"),
    ("FHA Secondary Residence", "Second Home"),
]

_LOAN_PURPOSE_CHECKS: list[tuple[str, str]] = [
    ("Cash-Out Refinance", "Cash-Out Refinance"),
    ("Cash Out Refinance", "Cash-Out Refinance"),
    ("Refinance", "Refinance"),
    ("Purchase", "Purchase"),
]

_PREPAY_MONTHS_TO_TERM: dict[int, str] = {
    12: "1 Year",
    24: "2 Year",
    36: "3 Year",
    48: "4 Year",
    60: "5 Year",
}

_EXISTING_SECOND_NONE = "None"
_EXISTING_SECOND_SUBORDINATION = "Yes — needs subordination"
_EXISTING_SECOND_PAYOFF = "Yes — being paid off in this transaction"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text(elem: ET.Element | None) -> str:
    if elem is None or elem.text is None:
        return ""
    return elem.text.strip()


def _first_text(root: ET.Element, name: str) -> str:
    for el in root.iter():
        if _local(el.tag) == name and el.text and el.text.strip():
            return el.text.strip()
    return ""


def _digits(value: str) -> str:
    raw = re.sub(r"[^\d.]", "", value or "")
    if not raw:
        return ""
    try:
        n = float(raw)
    except ValueError:
        return ""
    if n == int(n):
        return str(int(n))
    return str(round(n, 2)).rstrip("0").rstrip(".")


def _pct_from_amounts(loan: str, value: str) -> str:
    try:
        l = float(loan)
        v = float(value)
    except ValueError:
        return ""
    if v <= 0:
        return ""
    return str(int(round((l / v) * 100)))


def _map_occupancy(raw: str) -> str:
    m = {
        "PrimaryResidence": "Primary Residence",
        "SecondHome": "Second Home",
        "Investor": "Investment Property",
        "Investment": "Investment Property",
    }
    return m.get(raw, "")


def _map_citizenship(raw: str) -> str:
    m = {
        "USCitizen": "US Citizen",
        "PermanentResidentAlien": "Permanent Resident Alien",
        "NonPermanentResidentAlien": "Non-Permanent Resident Alien",
        "ForeignNational": "Foreign National",
    }
    return m.get(raw, "")


def _map_loan_purpose(purpose: str, cash_out: str) -> str:
    if purpose == "Purchase":
        return "Purchase"
    if cash_out in {"CashOut", "LimitedCashOut"}:
        return "Cash-Out Refinance"
    if purpose in {"Refinance", "Other"}:
        return "Refinance"
    return ""


def _map_lien(raw: str, loan_purpose: str) -> str:
    if raw == "FirstLien":
        return "first_lien"
    if raw == "SecondLien":
        return "second_lien_piggyback" if loan_purpose == "Purchase" else "second_lien"
    return ""


def _map_property_type(units: str, attachment: str, pud: str) -> str:
    try:
        n = int(units) if units else 1
    except ValueError:
        n = 1
    if n >= 5:
        return "5-8 unit"
    if n >= 2:
        return "2-4 unit"
    if pud.lower() == "true":
        return "Single Family"
    if attachment == "Attached":
        return "Townhouse"
    return "Single Family"


def _collect_mortgage_liabilities(root: ET.Element) -> list[dict[str, str]]:
    """Mortgage / HELOC liabilities with unpaid balance (not marked paid off)."""
    items: list[dict[str, str]] = []
    for liability in root.iter():
        if _local(liability.tag) != "LIABILITY":
            continue
        liab_type = _first_text(liability, "LiabilityType")
        if liab_type not in ("MortgageLoan", "HELOC"):
            continue
        bal = _digits(_first_text(liability, "LiabilityUnpaidBalanceAmount"))
        if not bal or bal == "0":
            continue
        payoff = _first_text(liability, "LiabilityPayoffStatusIndicator").lower() == "true"
        items.append(
            {
                "balance": bal,
                "type": liab_type,
                "payoff": "true" if payoff else "false",
            }
        )
    return items


def _infer_existing_second_lien(
    mortgages: list[dict[str, str]],
    *,
    first_lien: str,
    new_loan: str,
) -> tuple[str, str]:
    """
    When multiple mortgage liabilities exist, map the non-primary balance to
    existingSecondLien + existingSecondLienBalance. Returns ("", "") if none.
    """
    if not first_lien:
        return "", ""

    others: list[dict[str, str]] = []
    for m in mortgages:
        b = m["balance"]
        if b == first_lien or (new_loan and b == new_loan):
            continue
        others.append(m)

    if not others:
        return "", ""

    sub = max(others, key=lambda x: float(x["balance"]))
    label = (
        _EXISTING_SECOND_PAYOFF
        if sub.get("payoff") == "true"
        else _EXISTING_SECOND_SUBORDINATION
    )
    return label, sub["balance"]


def _subject_first_lien_balance(root: ET.Element) -> str:
    for asset in root.iter():
        if _local(asset.tag) != "ASSET":
            continue
        owned = None
        for child in asset:
            if _local(child.tag) == "OWNED_PROPERTY":
                owned = child
                break
        if owned is None:
            continue
        subject = _first_text(owned, "OwnedPropertySubjectIndicator")
        if subject.lower() != "true":
            continue
        upb = _first_text(owned, "OwnedPropertyLienUPBAmount")
        if upb:
            return _digits(upb)
    # Fallback: first mortgage liability balance
    for liability in root.iter():
        if _local(liability.tag) != "LIABILITY":
            continue
        liab_type = _first_text(liability, "LiabilityType")
        if liab_type != "MortgageLoan":
            continue
        bal = _first_text(liability, "LiabilityUnpaidBalanceAmount")
        if bal:
            return _digits(bal)
    return ""


def parse_fannie_xml(content: bytes) -> dict[str, str]:
    """Extract wizard-compatible fields from a Fannie MISMO 3.4 URLA XML file."""
    root = ET.fromstring(content)
    out: dict[str, str] = {}

    purpose_raw = _first_text(root, "LoanPurposeType")
    cash_out = _first_text(root, "RefinanceCashOutDeterminationType")
    loan_purpose = _map_loan_purpose(purpose_raw, cash_out)
    if loan_purpose:
        out["loanPurpose"] = loan_purpose
        out["primaryLoanPurpose"] = loan_purpose

    lien_raw = _first_text(root, "LienPriorityType")
    lien = _map_lien(lien_raw, purpose_raw)
    if lien:
        out["lienPosition"] = lien
        out["isSecondLien"] = "no" if lien == "first_lien" else "yes"

    loan_amt = _first_text(root, "BaseLoanAmount") or _first_text(root, "NoteAmount")
    if loan_amt:
        out["loanAmount"] = _digits(loan_amt)

    value = (
        _first_text(root, "PropertyValuationAmount")
        or _first_text(root, "PropertyEstimatedValueAmount")
    )
    if value:
        out["valueSalesPrice"] = _digits(value)

    if out.get("loanAmount") and out.get("valueSalesPrice"):
        ltv = _pct_from_amounts(out["loanAmount"], out["valueSalesPrice"])
        if ltv:
            out["ltv"] = ltv

    occupancy = _map_occupancy(_first_text(root, "PropertyUsageType"))
    if occupancy:
        out["occupancy"] = occupancy

    state = _first_text(root, "StateCode")
    if state and len(state) == 2:
        out["state"] = state.upper()

    county = _first_text(root, "CountyName")
    if county:
        out["stateCounty"] = county

    zip_code = _first_text(root, "PostalCode")
    if zip_code:
        out["stateZipCode"] = zip_code[:5]

    units = _first_text(root, "FinancedUnitCount")
    attachment = _first_text(root, "AttachmentType")
    pud = _first_text(root, "PUDIndicator")
    prop_type = _map_property_type(units, attachment, pud)
    if prop_type:
        out["propertyType"] = prop_type

    citizenship = _map_citizenship(_first_text(root, "CitizenshipResidencyType"))
    if citizenship:
        out["citizenship"] = citizenship

    fico = _first_text(root, "CreditScoreValue")
    if fico:
        out["decisionCreditScore"] = _digits(fico)

    dti = _first_text(root, "TotalDebtExpenseRatioPercent")
    if dti:
        out["estimatedDti"] = _digits(dti)

    first_lien = _subject_first_lien_balance(root)
    if first_lien and out.get("isSecondLien") == "yes":
        out["existingFirstLien"] = first_lien
        if out.get("loanAmount") and out.get("valueSalesPrice"):
            try:
                combined = float(first_lien) + float(out["loanAmount"])
                cltv = _pct_from_amounts(str(combined), out["valueSalesPrice"])
                if cltv:
                    out["cltv"] = cltv
            except ValueError:
                pass

    if out.get("isSecondLien") == "no" and loan_purpose in ("Refinance", "Cash-Out Refinance") and first_lien:
        out["existingFirstLien"] = first_lien
        mortgages = _collect_mortgage_liabilities(root)
        esl_label, esl_bal = _infer_existing_second_lien(
            mortgages,
            first_lien=first_lien,
            new_loan=out.get("loanAmount", ""),
        )
        if esl_label:
            out["existingSecondLien"] = esl_label
            if esl_bal and esl_label == _EXISTING_SECOND_SUBORDINATION:
                out["existingSecondLienBalance"] = esl_bal

    cash = _first_text(root, "CashToBorrowerAtClosingAmount")
    if cash and loan_purpose == "Cash-Out Refinance":
        out["cashInHandRequest"] = _digits(cash)

    self_emp = _first_text(root, "EmploymentBorrowerSelfEmployedIndicator")
    if self_emp.lower() == "true":
        out["documentationType"] = "Bank Statements (12 or 24 Months)"
    elif self_emp.lower() == "false":
        out["documentationType"] = "Full Documentation"

    intent_occupy = _first_text(root, "IntentToOccupyType")
    if intent_occupy == "Yes" and occupancy == "Primary Residence":
        out["firstTimeHomebuyer"] = "No"

    return {k: v for k, v in out.items() if v}


def _checked_label(text: str, options: list[tuple[str, str]]) -> str:
    """Return the wizard value for the first checkbox-marked option found."""
    for raw_label, wizard_value in options:
        if re.search(rf"{_CHECK_MARK}{re.escape(raw_label)}\b", text, re.IGNORECASE):
            return wizard_value
    return ""


def _first_amount(pattern: str, text: str) -> str:
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    return _digits(m.group(1)) if m else ""


def _map_units_to_property_type(units: str, *, mixed_use: bool, manufactured: bool) -> str:
    if manufactured:
        return "Manufactured"
    if mixed_use:
        return "Mixed Use"
    try:
        n = int(units) if units else 1
    except ValueError:
        n = 1
    if n >= 5:
        return "5-8 unit"
    if n >= 2:
        return "2-4 unit"
    return "Single Family"


def parse_1003_pdf_rules(text: str) -> dict[str, str]:
    """
    Deterministic extraction from Form 1003 PDF text (checkbox marks, labeled amounts).
    Used to override LLM guesses on Docusign-style exports.
    """
    if not text.strip():
        return {}

    out: dict[str, str] = {}

    citizenship = _checked_label(text, _CITIZENSHIP_CHECKS)
    if citizenship:
        out["citizenship"] = citizenship
    elif re.search(r"Individual Taxpayer Identification Number", text, re.IGNORECASE):
        # ITIN + non-US mailing address often indicates foreign-national product path.
        if re.search(r"PHILIPPINES|Country\s+US\b", text, re.IGNORECASE) and not citizenship:
            out["citizenship"] = "Foreign National"

    occupancy = _checked_label(text, _OCCUPANCY_CHECKS)
    if occupancy:
        out["occupancy"] = occupancy

    loan_purpose = _checked_label(text, _LOAN_PURPOSE_CHECKS)
    if not loan_purpose:
        purpose_line = re.search(
            r"Loan Purpose\s+" + _CHECK_MARK + r"(Purchase|Refinance|Cash[- ]?Out Refinance)",
            text,
            re.IGNORECASE,
        )
        if purpose_line:
            raw = purpose_line.group(1)
            loan_purpose = _LOAN_PURPOSE_CHECKS[-1][1] if raw.lower() == "purchase" else (
                "Cash-Out Refinance" if "cash" in raw.lower() else "Refinance"
            )
    if loan_purpose:
        out["loanPurpose"] = loan_purpose
        out["primaryLoanPurpose"] = loan_purpose

    loan_amt = _first_amount(
        r"4a\.\s*Loan and Property Information\s*.*?Loan Amount\s*\$\s*([\d,]+(?:\.\d+)?)",
        text,
    ) or _first_amount(r"Loan Amount\s*\$\s*([\d,]+(?:\.\d+)?)", text)
    if loan_amt:
        out["loanAmount"] = loan_amt

    value = _first_amount(
        r"Number of Units\s+\d+\s+Property Value\s*\$([\d,]+(?:\.\d+)?)",
        text,
    ) or _first_amount(r"Sales Contract Price\s*\$\s*([\d,]+(?:\.\d+)?)", text)
    if value:
        out["valueSalesPrice"] = value

    if out.get("loanAmount") and out.get("valueSalesPrice"):
        ltv = _pct_from_amounts(out["loanAmount"], out["valueSalesPrice"])
        if ltv:
            out["ltv"] = ltv

    state_m = re.search(
        r"Property Address\s+.*?State\s+([A-Z]{2})\s+ZIP",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if state_m:
        out["state"] = state_m.group(1).upper()

    county_m = re.search(
        r"Property Address\s+.*?County\s+([A-Za-z][A-Za-z\s]+?)(?:\s+Number of Units|\s+Occupancy|\n)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if county_m:
        out["stateCounty"] = county_m.group(1).strip()

    zip_m = re.search(
        r"Property Address\s+.*?ZIP\s+(\d{5})",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if zip_m:
        out["stateZipCode"] = zip_m.group(1)

    units_m = re.search(r"Number of Units\s+(\d+)", text, re.IGNORECASE)
    units = units_m.group(1) if units_m else "1"
    mixed_use = bool(
        re.search(
            r"Mixed-Use Property.*?your own business\?\s*.*?" + _CHECK_MARK + r"YES\b",
            text,
            re.IGNORECASE | re.DOTALL,
        )
    )
    manufactured = bool(
        re.search(
            r"Manufactured Home.*?permanent chassis\)\s*.*?" + _CHECK_MARK + r"YES\b",
            text,
            re.IGNORECASE | re.DOTALL,
        )
    )
    prop_type = _map_units_to_property_type(units, mixed_use=mixed_use, manufactured=manufactured)
    if prop_type:
        out["propertyType"] = prop_type

    if re.search(rf"{_CHECK_MARK}First Lien\b", text, re.IGNORECASE):
        out["lienPosition"] = "first_lien"
        out["isSecondLien"] = "no"
    elif re.search(rf"{_CHECK_MARK}Subordinate Lien\b", text, re.IGNORECASE):
        out["lienPosition"] = "second_lien_piggyback" if loan_purpose == "Purchase" else "second_lien"
        out["isSecondLien"] = "yes"

    rental_income = _first_amount(
        r"Expected Monthly Rental Income\s*\$\s*([\d,]+(?:\.\d+)?)",
        text,
    )
    pitia = _first_amount(r"TOTAL\s*\$\s*([\d,]+(?:\.\d+)?)", text)
    if occupancy == "Investment Property" and rental_income:
        out["investmentIncomePath"] = "dscr"
        if pitia:
            try:
                dscr_val = round(float(rental_income) / float(pitia), 2)
                if dscr_val > 0:
                    out["dscr"] = str(dscr_val)
            except ValueError:
                pass
        out.setdefault("rentalType", "Long-term rental")

    prepay_m = re.search(
        r"Prepayment Penalty\s*/\s*Prepayment Penalty Term\s+(\d+)\s*\(months\)",
        text,
        re.IGNORECASE,
    )
    if prepay_m:
        months = int(prepay_m.group(1))
        if months in _PREPAY_MONTHS_TO_TERM:
            out["prepaymentTerms"] = _PREPAY_MONTHS_TO_TERM[months]
        elif months == 0:
            out["prepaymentTerms"] = "No Penalty"

    return {k: v for k, v in out.items() if v}


def _strip_llm_hallucinations(fields: dict[str, str], text: str) -> dict[str, str]:
    """Drop LLM-only guesses when the source PDF text has no supporting signal."""
    out = dict(fields)
    if out.get("decisionCreditScore") and not re.search(
        r"(?:Credit Score|FICO|Representative Credit Score)\s*[:\s]*\d{3}",
        text,
        re.IGNORECASE,
    ):
        out.pop("decisionCreditScore", None)
    return out


def extract_pdf_text(content: bytes, max_pages: int = 12) -> str:
    import pdfplumber

    chunks: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages[:max_pages]:
            text = page.extract_text() or ""
            if text.strip():
                chunks.append(text)
    return "\n\n".join(chunks)


def parse_pdf_1003_with_llm(text: str) -> dict[str, str]:
    if not config.OPENAI_API_KEY or not text.strip():
        return {}
    from backend.connections.openai import get_openai

    oc = get_openai()
    prompt = (
        _WIZARD_FIELD_HINT
        + "\n\nThe following is OCR/text extracted from a Uniform Residential Loan Application (Form 1003). "
        "Extract every field you can find."
    )
    resp = oc.chat.completions.create(
        model=config.OPENAI_CHAT_MODEL,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": text[:28000]},
        ],
        max_tokens=700,
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    raw = (resp.choices[0].message.content or "{}").strip()
    data = json.loads(raw)
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if v is not None and str(v).strip()}


def parse_loan_form_upload(filename: str, content: bytes) -> dict[str, Any]:
    """Route upload to the appropriate parser. Returns {fields, source, filled_count}."""
    name = (filename or "").lower()
    fields: dict[str, str] = {}
    source = "unknown"

    if name.endswith(".xml") or name.endswith(".html") or name.endswith(".htm"):
        source = "fannie_xml"
        try:
            fields = parse_fannie_xml(content)
        except ET.ParseError:
            # Some HTML exports are XML-like; fall back to text + LLM
            text = content.decode("utf-8", errors="ignore")
            fields = parse_pdf_1003_with_llm(text)
            source = "fannie_html_llm"
    elif name.endswith(".pdf"):
        source = "pdf_1003"
        text = extract_pdf_text(content)
        llm_fields = parse_pdf_1003_with_llm(text)
        rule_fields = parse_1003_pdf_rules(text)
        fields = _strip_llm_hallucinations({**llm_fields, **rule_fields}, text)
    else:
        raise ValueError("Unsupported file type. Upload a .pdf, .xml, or .html loan file.")

    if not fields:
        raise ValueError("Could not extract any scenario fields from that file.")

    # Normalize derived companions
    if fields.get("loanPurpose") and not fields.get("primaryLoanPurpose"):
        fields["primaryLoanPurpose"] = fields["loanPurpose"]
    if fields.get("lienPosition") and not fields.get("isSecondLien"):
        fields["isSecondLien"] = "no" if fields["lienPosition"] == "first_lien" else "yes"
    if (
        fields.get("loanAmount")
        and fields.get("valueSalesPrice")
        and not fields.get("ltv")
    ):
        ltv = _pct_from_amounts(fields["loanAmount"], fields["valueSalesPrice"])
        if ltv:
            fields["ltv"] = ltv

    return {
        "fields": fields,
        "source": source,
        "filled_count": len(fields),
    }
