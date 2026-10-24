import type { AuthMessageKey } from "../zh-CN/auth.ts";

export const enAuthMessages = {
  "auth.login.title": "Sign in to your account",
  "auth.login.subtitle":
    "Sign in, create an account, or recover your password on the secure BoltPocket account page.",
  "auth.login.continueWithEmail": "Continue with email",
  "auth.login.opening": "Opening account page",
  "auth.login.retry": "Try again",
  "auth.login.securityNote":
    "BoltPocket never reads or stores your password. Your session is kept in secure device storage.",
  "auth.error.accountMismatch":
    "Local data on this device is bound to another account. Account switching is temporarily blocked so one account cannot see another account's local conversations.",
  "auth.error.configuration":
    "The sign-in service is misconfigured. Contact the administrator.",
  "auth.error.authorizationFailed":
    "The account page could not complete secure authorization. Try again.",
  "auth.error.network":
    "Could not reach the sign-in service. Check your connection and try again.",
  "auth.error.secureStorage":
    "Secure device storage is unavailable, so the session cannot be saved safely.",
  "auth.error.sessionExpired": "Your session expired. Sign in again.",
  "auth.error.sessionRejected":
    "You signed in again, but the service still rejected the session. Try again later.",
  "auth.error.server": "The sign-in service is unavailable. Try again later.",
  "auth.account.title": "Account",
  "auth.account.profile": "Profile",
  "auth.account.nickname": "Nickname",
  "auth.account.email": "Email",
  "auth.account.provider": "Sign-in service",
  "auth.account.role": "Admin access",
  "auth.account.roleUser": "Standard user",
  "auth.account.roleViewer": "Admin viewer",
  "auth.account.roleReviewer": "Admin reviewer",
  "auth.account.roleAdmin": "Admin",
  "auth.account.mySkills": "My Skills",
  "auth.account.mySkillsUploaded": "Uploaded",
  "auth.account.mySkillsReviewing": "Under review",
  "auth.account.mySkillsEmpty": "No Skills uploaded yet",
  "auth.account.mySkillsNoneUploaded": "No published Skills",
  "auth.account.mySkillsNoneReviewing": "No Skills under review",
  "auth.account.mySkillsLoading": "Loading Skill status",
  "auth.account.mySkillsLoadFailed": "Could not load Skill status",
  "auth.account.mySkillsSessionExpired":
    "Your account session expired. Sign in again to load Skill status.",
  "auth.account.mySkillsSignInAgain": "Sign in again",
  "auth.account.mySkillsRetry": "Retry",
  "auth.account.mySkillsWithdraw": "Withdraw Skill",
  "auth.account.mySkillsWithdrawTitle": "Withdraw this Skill?",
  "auth.account.mySkillsWithdrawDetail":
    "It will be hidden from the public catalog immediately, and any pending review will stop.",
  "auth.account.mySkillsWithdrawFailed": "Could not withdraw Skill",
  "auth.account.mySkillsStatusPublished": "Published",
  "auth.account.mySkillsStatusReviewing": "Under review",
  "auth.account.mySkillsStatusRejected": "Rejected",
  "auth.account.mySkillsStatusWithdrawn": "Withdrawn",
  "auth.account.mySkillsStatusSuspended": "Suspended",
  "auth.account.refresh": "Refresh profile",
  "auth.account.refreshFailed": "Could not refresh profile",
  "auth.account.signOut": "Sign out",
  "auth.account.signOutTitle": "Sign out of this account?",
  "auth.account.signOutDetail":
    "Local conversations and projects remain encrypted and bound to this account. You can sign back in only with the same account.",
  "auth.account.signOutFailed": "Could not sign out safely",
  "auth.account.delete": "Delete account",
  "auth.account.deleteTitle": "Permanently delete this account?",
  "auth.account.deleteDetail":
    "Your account, server connections, and safety reports will be permanently deleted. Encrypted conversations and projects remain on this device and stay bound to this account. This cannot be undone.",
  "auth.account.deleteFailed": "Could not delete account",
  "auth.account.cancel": "Cancel",
} as const satisfies Record<AuthMessageKey, string>;
