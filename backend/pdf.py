"""Server-side loan scenario PDF via PyMuPDF (cross-platform, native layout)."""

from __future__ import annotations

import html
import logging
import re
from collections.abc import Callable
from datetime import datetime
from io import BytesIO
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

# Layout constants (points, 72 pt = 1 inch)
_PAGE = None  # lazy fitz.paper_rect("letter")
_MARGIN = 54
_FOOTER_H = 28

_BRAND = (1 / 255, 42 / 255, 91 / 255)
_TEXT = (30 / 255, 41 / 255, 59 / 255)
_MUTED = (100 / 255, 116 / 255, 139 / 255)
_BORDER = (226 / 255, 232 / 255, 240 / 255)
_HEAD_BG = (248 / 255, 250 / 255, 252 / 255)
_ROW_ALT = (249 / 255, 250 / 255, 251 / 255)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ProfileRow(BaseModel):
    label: str
    value: str


class ProfileSection(BaseModel):
    title: str
    rows: list[ProfileRow] = Field(default_factory=list)


class ScenarioPdfProgramItem(BaseModel):
    program_title: str
    investor_name: str = ""
    products_display: str = ""
    min_fico: int | None = None
    max_loan: int | None = None
    max_ltv_purchase: float | None = None
    max_ltv_rate_term: float | None = None
    max_ltv_cashout: float | None = None
    max_dti: float | None = None
    min_dscr: float | None = None
    doc_type: str | None = None
    occupancy: str | None = None
    documentation_type: str | None = None
    special_overlay: str | None = None
    considerations: list[str] = Field(default_factory=list)


class ScenarioPdfRejectedItem(BaseModel):
    program_id: int
    program_title: str
    layer: str = ""
    reason: str = ""


class ScenarioPdfRequest(BaseModel):
    profile_sections: list[ProfileSection] = Field(default_factory=list)
    programs: list[ScenarioPdfProgramItem] = Field(default_factory=list)
    rejected_programs: list[ScenarioPdfRejectedItem] = Field(default_factory=list)
    form_fields: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _esc(text: str | None) -> str:
    return html.escape((text or "").strip(), quote=True)


def _safe_text(text: str) -> str:
    """Use PDF-safe punctuation (standard Helvetica lacks many Unicode glyphs)."""
    return (
        (text or "")
        .replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u00b7", " | ")
        .strip()
    )


def _fmt_money(amount: int) -> str:
    return f"${amount:,}"


def _short_layer(layer: str) -> str:
    mapping = {
        "Layer 1": "Program gate",
        "Layer 2": "LTV matrix",
        "Layer 3": "FTHB",
        "Layer 4": "Products",
        "Layer 5": "Geography",
        "Layer 6": "Credit seasoning",
        "Layer 7": "Housing history",
        "Layer 8": "Guidelines",
        "Layer 10": "Verification",
    }
    for key, label in mapping.items():
        if layer.startswith(key):
            return label
    return re.sub(r"\s*\(.*\)", "", layer).strip() or layer


def rejected_programs_from_trace(trace_data: dict[str, Any]) -> list[ScenarioPdfRejectedItem]:
    programs = trace_data.get("programs") or []
    items: list[ScenarioPdfRejectedItem] = []
    for entry in sorted(
        programs,
        key=lambda x: (x.get("lender_id", 0), x.get("program_id", 0)),
    ):
        if entry.get("status") != "rejected":
            continue
        items.append(
            ScenarioPdfRejectedItem(
                program_id=int(entry["program_id"]),
                program_title=str(entry.get("label") or ""),
                layer=str(entry.get("layer") or ""),
                reason=str(entry.get("reason") or ""),
            )
        )
    return items


def enrich_scenario_pdf_request(
    body: ScenarioPdfRequest,
    find_eligible_fn: Callable[..., dict[str, Any]] | None = None,
) -> ScenarioPdfRequest:
    """Resolve rejected programs from form_fields when not already supplied."""
    if body.rejected_programs or not body.form_fields or not find_eligible_fn:
        return body
    try:
        from backend.eligibility import EligibilityTraceCollector  # noqa: PLC0415

        result = find_eligible_fn(body.form_fields, collect_trace=True)
        trace_data = result.get("program_trace")
        if not trace_data or not isinstance(trace_data, dict):
            return body
        collector = EligibilityTraceCollector.from_dict(trace_data)
        rejected = rejected_programs_from_trace(collector.to_dict())
        if not rejected:
            return body
        return body.model_copy(update={"rejected_programs": rejected})
    except Exception as exc:
        _log.warning("PDF rejected-program trace failed: %s", exc)
        return body


def _page_rect():
    global _PAGE
    if _PAGE is None:
        import fitz

        _PAGE = fitz.paper_rect("letter")
    return _PAGE


class _PdfCanvas:
    """Low-level PyMuPDF layout with pagination and text wrapping."""

    def __init__(self) -> None:
        import fitz

        self._fitz = fitz
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=_page_rect().width, height=_page_rect().height)
        self.y = _MARGIN
        self.page_num = 1
        self.content_w = _page_rect().width - 2 * _MARGIN

    @property
    def bottom_limit(self) -> float:
        return _page_rect().height - _MARGIN - _FOOTER_H

    def _wrap_lines(self, text: str, width: float, fontsize: float) -> list[str]:
        text = _safe_text(text)
        if not text:
            return ["-"]
        max_chars = max(12, int(width / (fontsize * 0.52)))
        out: list[str] = []
        for paragraph in text.split("\n"):
            words = paragraph.split()
            if not words:
                out.append("")
                continue
            line = words[0]
            for word in words[1:]:
                candidate = f"{line} {word}"
                if len(candidate) <= max_chars:
                    line = candidate
                else:
                    out.append(line)
                    line = word
            out.append(line)
        return out or ["-"]

    def _draw_cell(self, x: float, y: float, w: float, h: float, text: str, fontsize: float = 8) -> None:
        lines = self._wrap_lines(text, w - 10, fontsize)
        line_h = fontsize + 3
        yy = y + fontsize + 2
        for line in lines:
            if yy > y + h - 2:
                break
            self.page.insert_text((x + 5, yy), line, fontsize=fontsize, fontname="helv", color=_TEXT)
            yy += line_h

    def _table_row(
        self,
        cells: list[tuple[str, float]],
        *,
        alt: bool = False,
        font_size: float = 8.5,
    ) -> None:
        """Draw one table row; each cell is (text, width)."""
        prepared = [(_safe_text(t), w) for t, w in cells]
        line_counts = [
            len(self._wrap_lines(t, w - 10, font_size)) for t, w in prepared
        ]
        row_h = max(18, max(line_counts) * (font_size + 3) + 10)
        if self.y + row_h > self.bottom_limit:
            self.new_page()
        row_y = self.y
        if alt:
            self.page.draw_rect(
                self._fitz.Rect(_MARGIN, row_y, _MARGIN + self.content_w, row_y + row_h),
                color=_ROW_ALT,
                fill=_ROW_ALT,
            )
        x = _MARGIN
        for text, w in prepared:
            self._draw_cell(x, row_y, w, row_h, text, font_size)
            x += w
        self.page.draw_line(
            self._fitz.Point(_MARGIN, row_y + row_h),
            self._fitz.Point(_MARGIN + self.content_w, row_y + row_h),
            color=_BORDER,
            width=0.5,
        )
        self.y = row_y + row_h

    def _draw_footer(self) -> None:
        text = f"NewPoint Mortgage - Confidential  |  Page {self.page_num}"
        self.page.insert_text(
            (_MARGIN, _page_rect().height - 18),
            text,
            fontsize=7.5,
            fontname="helv",
            color=_MUTED,
        )

    def new_page(self) -> None:
        self._draw_footer()
        self.page = self.doc.new_page(width=_page_rect().width, height=_page_rect().height)
        self.page_num += 1
        self.y = _MARGIN

    def ensure(self, needed: float) -> None:
        if self.y + needed > self.bottom_limit:
            self.new_page()

    def textbox(
        self,
        x: float,
        width: float,
        text: str,
        *,
        fontsize: float = 9,
        fontname: str = "helv",
        color=_TEXT,
        align: int = 0,
        min_height: float = 14,
    ) -> float:
        """Draw wrapped text; return height used."""
        if not text.strip():
            return min_height
        self.ensure(min_height)
        rect = self._fitz.Rect(x, self.y, x + width, self.bottom_limit)
        used = self.page.insert_textbox(
            rect,
            text,
            fontsize=fontsize,
            fontname=fontname,
            color=color,
            align=align,
        )
        if used >= 0:
            h = max(min_height, rect.height - used + 2)
            self.y += h
            return h
        # Overflow — estimate height from line count
        lines = max(1, len(text) // max(1, int(width / (fontsize * 0.55))))
        h = max(min_height, lines * (fontsize + 3))
        self.ensure(h)
        rect = self._fitz.Rect(x, self.y, x + width, self.y + h)
        self.page.insert_textbox(rect, text, fontsize=fontsize, fontname=fontname, color=color, align=align)
        self.y += h + 2
        return h

    def gap(self, h: float = 8) -> None:
        self.y += h

    def rule(self) -> None:
        self.ensure(6)
        self.page.draw_line(
            self._fitz.Point(_MARGIN, self.y),
            self._fitz.Point(_MARGIN + self.content_w, self.y),
            color=_BORDER,
            width=0.75,
        )
        self.y += 8

    def doc_header(self, title: str, subtitle: str) -> None:
        title = _safe_text(title)
        subtitle = _safe_text(subtitle)
        self.page.insert_text((_MARGIN, self.y + 14), title, fontsize=16, fontname="helv", color=_BRAND)
        self.y += 22
        self.page.insert_text((_MARGIN, self.y + 10), subtitle, fontsize=8.5, fontname="helv", color=_MUTED)
        self.y += 16
        self.rule()
        self.gap(6)

    def section_title(self, title: str, *, new_page: bool = False) -> None:
        if new_page and self.y > _MARGIN + 20:
            self.new_page()
        self.ensure(24)
        self.gap(4)
        self.page.insert_text((_MARGIN, self.y + 11), title.upper(), fontsize=9, fontname="helv", color=_BRAND)
        self.y += 14
        self.rule()

    def subsection_title(self, title: str) -> None:
        self.ensure(18)
        self.gap(6)
        self.page.insert_text((_MARGIN, self.y + 10), title, fontsize=9, fontname="helv", color=_TEXT)
        self.y += 14

    def profile_sections(self, sections: list[ProfileSection]) -> None:
        label_w = 118
        value_w = (self.content_w - label_w - 12) / 2
        col2_x = _MARGIN + label_w + value_w + 12
        pair_h = 16

        for sec in sections:
            if not sec.rows:
                continue
            self.subsection_title(sec.title)
            rows = sec.rows
            i = 0
            while i < len(rows):
                self.ensure(pair_h + 4)
                row_y = self.y
                for col in range(2):
                    if i >= len(rows):
                        break
                    r = rows[i]
                    lx = _MARGIN if col == 0 else col2_x
                    vx = lx + label_w
                    self.page.insert_text(
                        (lx, row_y + 11), _safe_text(r.label), fontsize=8.5, fontname="helv", color=_MUTED
                    )
                    self.page.insert_textbox(
                        self._fitz.Rect(vx, row_y, vx + value_w, row_y + pair_h),
                        _safe_text(r.value) or "-",
                        fontsize=9,
                        fontname="helv",
                        color=_TEXT,
                    )
                    i += 1
                self.y = row_y + pair_h + 2
            self.gap(4)

    def _table_header(self, cols: list[tuple[str, float]]) -> list[float]:
        """Draw shaded header row; return x positions for each column."""
        self.ensure(22)
        row_h = 20
        x = _MARGIN
        xs: list[float] = []
        self.page.draw_rect(
            self._fitz.Rect(_MARGIN, self.y, _MARGIN + self.content_w, self.y + row_h),
            color=_HEAD_BG,
            fill=_HEAD_BG,
        )
        for label, w in cols:
            xs.append(x)
            self.page.insert_text((x + 6, self.y + 13), label.upper(), fontsize=7.5, fontname="helv", color=_MUTED)
            x += w
        self.y += row_h
        return xs

    def programs_table(self, programs: list[ScenarioPdfProgramItem]) -> None:
        w_detail = self.content_w * 0.72
        w_loan = self.content_w - w_detail
        self.page.insert_text(
            (_MARGIN, self.y + 10),
            f"{len(programs)} program{'s' if len(programs) != 1 else ''} matched",
            fontsize=8.5,
            fontname="helv",
            color=_MUTED,
        )
        self.y += 16
        self._table_header([("Program / Products", w_detail), ("Max Loan", w_loan)])
        for idx, p in enumerate(programs):
            title = p.program_title
            if p.investor_name.strip():
                title += f" ({p.investor_name.strip()})"
            products = (p.products_display or "").strip()
            detail = title
            if products:
                detail += f"\n{products.replace(', ', ' | ')}"
            if p.special_overlay:
                short = p.special_overlay[:100] + ("..." if len(p.special_overlay) > 100 else "")
                detail += f"\nNote: {short}"
            loan = _fmt_money(p.max_loan) if p.max_loan else "-"
            self._table_row([(detail, w_detail), (loan, w_loan)], alt=idx % 2 == 1, font_size=8)

    def rejected_table(self, rejected: list[ScenarioPdfRejectedItem]) -> None:
        w_prog = self.content_w * 0.32
        w_reason = self.content_w - w_prog
        self.page.insert_text(
            (_MARGIN, self.y + 10),
            f"{len(rejected)} program{'s' if len(rejected) != 1 else ''} rejected",
            fontsize=8.5,
            fontname="helv",
            color=_MUTED,
        )
        self.y += 16
        self._table_header([("Program", w_prog), ("Reason", w_reason)])
        for idx, item in enumerate(rejected):
            layer = _short_layer(item.layer)
            reason = item.reason or "-"
            if layer:
                reason = f"{layer}: {reason}"
            title = item.program_title
            if item.program_id:
                title += f"  (#{item.program_id})"
            self._table_row([(title, w_prog), (reason, w_reason)], alt=idx % 2 == 1)

    def finish(self) -> bytes:
        self._draw_footer()
        return self.doc.tobytes()


def _render_pdf(body: ScenarioPdfRequest, generated_date: str) -> bytes:
    count = len(body.programs)
    rejected_count = len(body.rejected_programs)
    subtitle = f"Generated {generated_date}  |  {count} matched"
    if rejected_count:
        subtitle += f"  |  {rejected_count} rejected"

    cv = _PdfCanvas()
    cv.doc_header("NewPoint Mortgage - Loan Scenario", subtitle)

    cv.section_title("Borrower Profile")
    if body.profile_sections and any(s.rows for s in body.profile_sections):
        cv.profile_sections(body.profile_sections)
    else:
        cv.textbox(_MARGIN, cv.content_w, "No profile data.", fontsize=9, color=_MUTED)

    cv.section_title("Eligible Programs", new_page=True)
    if body.programs:
        cv.programs_table(body.programs)
    else:
        cv.textbox(_MARGIN, cv.content_w, "No matched programs.", fontsize=9, color=_MUTED)

    if body.rejected_programs:
        cv.section_title("Rejected Programs", new_page=True)
        cv.rejected_table(body.rejected_programs)

    return cv.finish()


def generate_scenario_pdf_bytes(body: ScenarioPdfRequest) -> bytes:
    now_et = datetime.now(_ET)
    hour = now_et.strftime("%I").lstrip("0") or "12"
    generated_date = now_et.strftime(f"%B %d, %Y at {hour}:%M %p ET")
    return _render_pdf(body, generated_date)


def scenario_pdf_filename() -> str:
    return f"NewPoint-Loan-Scenario-{datetime.now(_ET).strftime('%Y-%m-%d')}.pdf"


def build_profile_page_html(body: ScenarioPdfRequest, generated_date: str) -> str:
    return _build_full_html_legacy(body, generated_date)


def build_programs_page_html(body: ScenarioPdfRequest, generated_date: str) -> str:
    return _build_full_html_legacy(body, generated_date)


def build_scenario_pdf_html(body: ScenarioPdfRequest, generated_date: str) -> str:
    return _build_full_html_legacy(body, generated_date)


def _build_full_html_legacy(body: ScenarioPdfRequest, generated_date: str) -> str:
    """Minimal HTML fallback for print preview only."""
    count = len(body.programs)
    rows = "".join(
        f"<tr><td>{_esc(p.program_title)}</td><td>{p.max_loan or '—'}</td>"
        f"<td>{_esc(p.products_display or '—')}</td></tr>"
        for p in body.programs
    )
    return f"""<!DOCTYPE html><html><body>
<h1>NewPoint Mortgage — Loan Scenario</h1>
<p>{_esc(generated_date)} · {count} matched</p>
<h2>Programs</h2>
<table border="1" cellpadding="6"><tr><th>Program</th><th>Max Loan</th><th>Products</th></tr>{rows}</table>
</body></html>"""
