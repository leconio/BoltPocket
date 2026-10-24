import type { PrivacyMessageKey } from "../zh-CN/privacy.ts";

export const enPrivacyMessages = {
  "privacy.consent.accept": "Agree and continue",
  "privacy.consent.adultConfirmation":
    "I am at least 18 years old and have read the Privacy Policy and Terms of Service",
  "privacy.consent.decline": "Do not agree",
  "privacy.consent.declinedDetail":
    "BoltPocket will not enter the main app or start sign-in restoration, the Agent, WebViews, or other network capabilities. You can close the app or review the documents and choose again.",
  "privacy.consent.declinedTitle": "Network and data processing stopped",
  "privacy.consent.failClosed":
    "BoltPocket does not bypass the privacy gate when your choice cannot be read or stored securely on this device.",
  "privacy.consent.operatorPending": "operator pending filing verification",
  "privacy.consent.point.local":
    "Projects, conversations, memory, credentials, and most work data stay in encrypted storage on this device by default.",
  "privacy.consent.point.network":
    "Only when you start an account, model, or safety feature is the data needed for that feature sent to a disclosed recipient.",
  "privacy.consent.point.permissions":
    "Camera, microphone, photos, location, local-network, and similar permissions are explained and requested in their specific feature.",
  "privacy.consent.point.tracking":
    "BoltPocket includes no advertising SDK, requests no advertising identifier, and performs no cross-app tracking.",
  "privacy.consent.privacyLink": "Privacy Policy (Simplified Chinese)",
  "privacy.consent.reading": "Reading your privacy choice",
  "privacy.consent.reconsider": "Review and choose again",
  "privacy.consent.retry": "Retry",
  "privacy.consent.saveError":
    "Your choice could not be saved securely. Unlock the device and try again.",
  "privacy.consent.separateConsent":
    "This choice does not replace separate consent for sensitive information, model recipients, or cross-border transfers. Each applicable feature explains those details before sending.",
  "privacy.consent.storageError":
    "Your on-device privacy choice could not be read securely",
  "privacy.consent.summary":
    "The operator is {operator}. Review this notice and the complete rules before using the Mainland China edition.",
  "privacy.consent.termsLink": "Terms of Service (Simplified Chinese)",
  "privacy.consent.thirdPartiesLink":
    "Third-party Services (Simplified Chinese)",
  "privacy.consent.title": "Privacy notice",
  "privacy.center.acceptedAt": "Accepted at",
  "privacy.center.account": "Account and deletion",
  "privacy.center.accountDetail":
    "Review account information or permanently delete the online account",
  "privacy.center.aiRules": "Generative AI services and model disclosure",
  "privacy.center.contact": "Privacy and complaint requests",
  "privacy.center.contactDetail":
    "Ask the operator to access, copy, correct, or delete information",
  "privacy.center.controls": "Data and authorizations",
  "privacy.center.documents": "Rules and lists",
  "privacy.center.emailSubject": "BoltPocket personal information request",
  "privacy.center.localData": "On-device data",
  "privacy.center.localDataDetail":
    "Projects, conversations, and attachments stay on this device. Delete them in their screen, clear app data, or uninstall to remove local copies.",
  "privacy.center.permissions": "System permission list",
  "privacy.center.personalInformation": "Personal information collection list",
  "privacy.center.policyVersion": "Policy version",
  "privacy.center.privacyPolicy": "Privacy policy",
  "privacy.center.revokeAction": "Withdraw and stop",
  "privacy.center.revokeConfirm":
    "The main app will close immediately and stop new account, Agent, WebView, and other network processing. On-device data is not deleted automatically.",
  "privacy.center.revokeFailed":
    "General privacy consent could not be withdrawn. Try again later.",
  "privacy.center.revokeGeneral": "Withdraw general privacy consent",
  "privacy.center.revokeTitle": "Withdraw general privacy consent?",
  "privacy.center.status": "General privacy choice",
  "privacy.center.statusAccepted": "Current version accepted",
  "privacy.center.statusNotRequired":
    "This edition requests authorization for each feature",
  "privacy.center.summary":
    "Review processing rules, recipients, permissions, retention, and authorizations in one place.",
  "privacy.center.thirdParties": "Third-party service and SDK list",
  "privacy.center.title": "Privacy and data",
  "privacy.center.userAgreement": "Terms of service",
} as const satisfies Record<PrivacyMessageKey, string>;
