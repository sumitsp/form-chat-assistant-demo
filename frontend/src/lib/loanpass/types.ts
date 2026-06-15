/** LoanPASS iframe API field value shapes (see docs.loanpass.io/iframe-api/messages). */

export type LoanpassFieldValue =
  | { type: "string"; value: string; format?: string }
  | { type: "number"; value: string }
  | { type: "enum"; enumTypeId: string; variantId: string }
  | { type: "duration"; unit: "months" | "years"; count: string };

export type LoanpassCreditField = {
  fieldId: string;
  value: LoanpassFieldValue | null;
};

export type LoanpassEmbedConfig = {
  origin: string;
  clientAccessId: string;
  email: string;
  password: string;
};

export type LoanpassHostMessage =
  | { message: "connect" }
  | {
      message: "log-in";
      clientAccessId: string;
      emailAddress: string;
      password: string;
    }
  | { message: "set-version"; version: string }
  | { message: "set-fields"; fields: LoanpassCreditField[] };

export type LoanpassIframeMessage = {
  message: string;
  error?: string;
};
