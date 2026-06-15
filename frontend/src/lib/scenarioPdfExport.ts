import { formatProductsForScenario, type ProductDisplayPrefs } from "@/lib/nqmIntegratedForm";
import { programDisplayName } from "@/lib/programDisplayHelpers.tsx";

type PdfEligibleProgram = {
  program_name_np?: string | null;
  program_name?: string | null;
  min_fico?: number | null;
  max_loan?: number | null;
  max_ltv_purchase?: number | null;
  max_ltv_rate_term?: number | null;
  max_ltv_cashout?: number | null;
  max_dti?: number | null;
  min_dscr?: number | null;
  doc_type?: string | null;
  products?: string[] | null;
  products_available?: string | null;
  special_overlay?: string | null;
};

export type ScenarioPdfProfileSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildProfileHtml(sections: ScenarioPdfProfileSection[]): string {
  if (sections.length === 0) {
    return '<p class="empty">No profile fields captured yet.</p>';
  }
  return sections
    .map(
      (sec) => `
      <h3>${escapeHtml(sec.title)}</h3>
      <table>${sec.rows
        .map(
          (r) =>
            `<tr><td class="lbl">${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`,
        )
        .join("")}</table>
    `,
    )
    .join("");
}

function buildProgramsHtml(
  programs: PdfEligibleProgram[],
  productPrefs?: ProductDisplayPrefs,
): string {
  if (programs.length === 0) {
    return '<p class="empty">No matched programs.</p>';
  }
  return programs
    .map((p) => {
      const title = programDisplayName(p);
      const products =
        formatProductsForScenario(p.products, p.products_available, productPrefs) ||
        p.products_available ||
        "";
      const cells = [
        p.min_fico != null ? `<span class="k">Min FICO</span><span>${p.min_fico}</span>` : "",
        p.max_loan != null
          ? `<span class="k">Max Loan</span><span>$${p.max_loan.toLocaleString("en-US")}</span>`
          : "",
        p.max_ltv_purchase != null
          ? `<span class="k">Max LTV (Purchase)</span><span>${Math.round(p.max_ltv_purchase)}%</span>`
          : "",
        p.max_ltv_rate_term != null
          ? `<span class="k">Max LTV (Rate &amp; Term)</span><span>${Math.round(p.max_ltv_rate_term)}%</span>`
          : "",
        p.max_ltv_cashout != null
          ? `<span class="k">Max LTV (Cash-Out)</span><span>${Math.round(p.max_ltv_cashout)}%</span>`
          : "",
        p.max_dti != null ? `<span class="k">Max DTI</span><span>${p.max_dti}%</span>` : "",
        p.min_dscr != null ? `<span class="k">Min DSCR</span><span>${p.min_dscr}</span>` : "",
        p.doc_type ? `<span class="k">Doc Type</span><span>${escapeHtml(p.doc_type)}</span>` : "",
        products ? `<span class="k">Products</span><span>${escapeHtml(products)}</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      const overlay = p.special_overlay
        ? `<div class="overlay">Note: ${escapeHtml(p.special_overlay)}</div>`
        : "";
      return `
        <div class="prog">
          <div class="prog-title">${escapeHtml(title)}</div>
          <div class="prog-grid">${cells}</div>
          ${overlay}
        </div>
      `;
    })
    .join("");
}

export function buildScenarioPdfHtml(
  profileSections: ScenarioPdfProfileSection[],
  programs: PdfEligibleProgram[],
  generatedDate: string,
  productPrefs?: ProductDisplayPrefs,
): string {
  const profileHtml = buildProfileHtml(profileSections);
  const programsHtml = buildProgramsHtml(programs, productPrefs);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acme Mortgage — Loan Scenario</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;padding:0;margin:0}
      .pdf-page{padding:36px 48px}
      header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #012a5b;padding-bottom:12px;margin-bottom:28px}
      header h1{font-size:18px;font-weight:700;color:#012a5b}
      header span{font-size:11px;color:#888}
      h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#012a5b;margin:0 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:5px}
      h3{font-size:11px;font-weight:600;color:#444;margin:14px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
      td{padding:4px 6px;border-bottom:1px solid #f0f0f0;vertical-align:top}
      td.lbl{color:#888;width:44%}
      .empty{color:#888;font-size:12px}
      .prog{border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;break-inside:avoid}
      .prog-title{font-size:13px;font-weight:600;color:#012a5b;margin-bottom:8px}
      .prog-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 12px;font-size:11px}
      @media (min-width:640px){.prog-grid{grid-template-columns:repeat(4,1fr)}}
      .k{color:#888}
      .overlay{margin-top:8px;font-size:11px;color:#b45309;background:#fffbeb;border-radius:4px;padding:4px 8px}
      .pdf-profile-page{page-break-after:always;break-after:page}
      .pdf-programs-page{page-break-before:always;break-before:page}
      @media print{
        .pdf-page{padding:20px 28px}
        .pdf-profile-page{min-height:100vh}
      }
    </style></head><body>
    <section class="pdf-page pdf-profile-page">
      <header><h1>Acme Mortgage — Loan Scenario</h1><span>Generated ${escapeHtml(generatedDate)}</span></header>
      <h2>Borrower Profile</h2>
      ${profileHtml}
    </section>
    <section class="pdf-page pdf-programs-page">
      <header><h1>Acme Mortgage — Loan Scenario</h1><span>Generated ${escapeHtml(generatedDate)}</span></header>
      <h2>Program Scenarios (${programs.length})</h2>
      ${programsHtml}
    </section>
    </body></html>`;
}

export type ScenarioPdfRejectedProgram = {
  program_id: number;
  program_title: string;
  layer?: string;
  reason?: string;
};

export type ScenarioPdfDownloadPayload = {
  profile_sections: ScenarioPdfProfileSection[];
  programs: Array<{
    program_title: string;
    investor_name?: string;
    products_display: string;
    min_fico?: number | null;
    max_loan?: number | null;
    max_ltv_purchase?: number | null;
    max_ltv_rate_term?: number | null;
    max_ltv_cashout?: number | null;
    max_dti?: number | null;
    min_dscr?: number | null;
    doc_type?: string | null;
    occupancy?: string | null;
    documentation_type?: string;
    special_overlay?: string | null;
    considerations?: string[];
  }>;
  rejected_programs?: ScenarioPdfRejectedProgram[];
  form_fields?: Record<string, unknown>;
};

function parseFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

/** Phones/tablets — Safari ignores `<a download>` and blocks async popups. */
export function isMobilePdfEnvironment(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  return (
    typeof window !== "undefined" &&
    navigator.maxTouchPoints > 0 &&
    window.matchMedia("(max-width: 768px)").matches
  );
}

function scheduleBlobUrlRevoke(url: string, ms = 120_000): void {
  window.setTimeout(() => URL.revokeObjectURL(url), ms);
}

function openBlobInWindow(win: Window | null, blob: Blob): boolean {
  if (!win || win.closed) return false;
  const url = URL.createObjectURL(blob);
  win.location.href = url;
  scheduleBlobUrlRevoke(url);
  return true;
}

async function sharePdfBlob(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: "application/pdf" });
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: "Acme Loan Scenario" });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
  }
}

function triggerDesktopDownload(blob: Blob, filename: string): boolean {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  scheduleBlobUrlRevoke(url, 60_000);
  return true;
}

export type ScenarioPdfDownloadResult = "download" | "share" | "opened" | false;

export type ScenarioPdfDownloadOptions = {
  /** Opened synchronously on tap — required for iOS to show PDF after async fetch. */
  mobilePreviewWindow?: Window | null;
};

/** Server-side PDF via PyMuPDF; mobile opens in a pre-created tab or share sheet. */
export async function downloadScenarioPdf(
  apiBase: string,
  payload: ScenarioPdfDownloadPayload,
  options?: ScenarioPdfDownloadOptions,
): Promise<ScenarioPdfDownloadResult> {
  const base = apiBase.replace(/\/$/, "");
  const url = base ? `${base}/api/scenario/pdf` : "/api/scenario/pdf";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.includes("application/pdf")) return false;
    const blob = await res.blob();
    if (!blob.size) return false;
    const filename =
      parseFilenameFromDisposition(res.headers.get("Content-Disposition")) ||
      `Acme-Loan-Scenario-${new Date().toISOString().slice(0, 10)}.pdf`;

    if (isMobilePdfEnvironment()) {
      if (openBlobInWindow(options?.mobilePreviewWindow ?? null, blob)) return "opened";
      if (await sharePdfBlob(blob, filename)) return "share";
      const fallbackWin = window.open(URL.createObjectURL(blob), "_blank");
      if (fallbackWin) return "opened";
      return false;
    }

    if (triggerDesktopDownload(blob, filename)) return "download";
    return false;
  } catch {
    return false;
  }
}

export type ScenarioPdfPrintOptions = {
  targetWindow?: Window | null;
};

/** HTML preview fallback when API PDF generation fails. */
export function openScenarioPdfPrint(
  profileSections: ScenarioPdfProfileSection[],
  programs: PdfEligibleProgram[],
  productPrefs?: ProductDisplayPrefs,
  options?: ScenarioPdfPrintOptions,
): boolean {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const html = buildScenarioPdfHtml(profileSections, programs, date, productPrefs);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const mobile = isMobilePdfEnvironment();
  const win = options?.targetWindow ?? window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  if (options?.targetWindow || mobile) {
    win.location.href = url;
    scheduleBlobUrlRevoke(url);
    if (!mobile) {
      win.addEventListener("load", () => win.print(), { once: true });
    }
    return true;
  }
  win.addEventListener(
    "load",
    () => {
      win.print();
      scheduleBlobUrlRevoke(url);
    },
    { once: true },
  );
  return true;
}
