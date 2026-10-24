export type AppleMiniAppNativeApiApproval = Readonly<{
  status: "required-unconfirmed" | "approved";
  caseId: string | null;
  approvedAt: string | null;
}>;

/**
 * Apple Guideline 4.7.2 requires prior permission before a host exposes native
 * platform APIs to mini apps. Do not mark this approved until the operator has
 * archived Apple's written confirmation and exact case identifier.
 */
export const APPLE_MINI_APP_NATIVE_API_APPROVAL: AppleMiniAppNativeApiApproval =
  Object.freeze({
    status: "required-unconfirmed",
    caseId: null,
    approvedAt: null,
  });

export function miniAppProductionReleaseIssues(
  approval: AppleMiniAppNativeApiApproval = APPLE_MINI_APP_NATIVE_API_APPROVAL,
) {
  if (
    approval.status === "approved" &&
    approval.caseId &&
    /^\S.{2,118}\S$/u.test(approval.caseId) &&
    approval.approvedAt &&
    /^\d{4}-\d{2}-\d{2}$/u.test(approval.approvedAt)
  ) {
    return [];
  }
  return [
    "Apple 4.7.2 小程序原生 API 事先许可尚未确认；保留原生能力的 App Store 正式提交必须暂缓",
  ];
}
