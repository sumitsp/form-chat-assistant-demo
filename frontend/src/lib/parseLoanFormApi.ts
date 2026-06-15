export type ParseLoanFormResponse = {
  fields: Record<string, string>;
  source: string;
  filled_count: number;
};

export async function parseLoanFormFile(file: File): Promise<ParseLoanFormResponse> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/api/parse-loan-form", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    let detail = "Could not read that loan file.";
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  return (await res.json()) as ParseLoanFormResponse;
}
