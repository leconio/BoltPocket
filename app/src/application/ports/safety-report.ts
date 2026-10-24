export const safetyReportCategories = [
  "unsafe",
  "incorrect",
  "privacy",
  "copyright",
  "spam",
  "other",
] as const;

export type SafetyReportCategory = (typeof safetyReportCategories)[number];
export type SafetyReportTargetType =
  | "assistant_message"
  | "capability_entry"
  | "generated_image"
  | "generated_video"
  | "tool_output";

export type SafetyReportInput = Readonly<{
  category: SafetyReportCategory;
  targetType: SafetyReportTargetType;
  targetId: string;
  includeContent: boolean;
  excerpt?: string;
  note?: string;
}>;

export type SafetyReportReceipt = Readonly<{
  expiresAt: number;
  reportId: string;
  status: "received";
}>;

export type SafetyReportErrorCode =
  "invalid-response" | "rate-limited" | "submit-failed";

export class SafetyReportError extends Error {
  constructor(
    readonly code: SafetyReportErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "SafetyReportError";
  }
}

export interface SafetyReportPort {
  submit(
    input: SafetyReportInput,
    signal?: AbortSignal,
  ): Promise<SafetyReportReceipt>;
}
