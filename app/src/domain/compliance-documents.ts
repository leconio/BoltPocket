import {
  cloudDocumentConnectorsEnabled,
  generatedImagesEnabled,
  generatedVideoEnabled,
  thirdPartyMcpEnabled,
  type ComplianceConfig,
} from "@/config/compliance";

export type ComplianceDocumentId =
  | "privacy"
  | "terms"
  | "ai-rules"
  | "third-parties"
  | "personal-information"
  | "permissions";

export type ComplianceDocument = {
  id: ComplianceDocumentId;
  title: string;
  markdown: string;
};

function operator(config: ComplianceConfig) {
  return config.operatorName ?? "【待填写：运营主体全称】";
}

function contact(config: ComplianceConfig) {
  return config.supportEmail ?? "【待填写：个人信息保护/客服邮箱】";
}

function aiServiceTable(config: ComplianceConfig) {
  if (config.registeredAiServices.length === 0) {
    return config.distributionRegion === "global"
      ? "- BoltPocket不预设运营者管理的模型服务。用户自行选择兼容的模型提供商；发送前授权页会显示该提供商、模型和处理地点。"
      : "- 【待填写：服务商、模型名称、接收方、处理地点及备案/登记编号】";
  }
  return config.registeredAiServices
    .map(
      (service) =>
        `- ${service.providerName} / ${service.modelName}：接收方 ${service.recipientName}，处理地点 ${service.recipientLocation}，备案或登记编号 ${service.filingNumber}。`,
    )
    .join("\n");
}

function oauthDisclosure(config: ComplianceConfig) {
  if (!cloudDocumentConnectorsEnabled(config)) {
    return "中国大陆发行版不提供新的 Google Workspace 或 Notion 云文档授权，以避免在境外接收方告知、单独同意、跨境机制和网络可用性尚未完成发行验收时传输账号或文档数据。历史版本遗留的有效 OAuth 连接仍可在“隐私与数据”中删除服务端加密授权和本机设备会话；上游授权需在相应服务商账号安全页面撤销。";
  }
  return "Google/Notion 授权令牌由BoltPocket OAuth 服务加密保存，服务同时保存外部账号标识、账号显示名、必要元数据和最长 90 天的设备会话，用于换取短期访问租约。文档正文不会经过该 OAuth 服务。你可以在“隐私与数据”删除服务端加密授权和本机设备会话；无有效设备会话或待完成授权时，服务会自动清理相应加密授权。上游服务商授权可在其账号安全页面进一步撤销。项目中已保存的本地加密副本需由你在相应项目中另行删除。";
}

function mcpDisclosure(config: ComplianceConfig) {
  return thirdPartyMcpEnabled(config)
    ? "客户自行配置的 MCP 服务使用你提供的账号、API Token 或 OAuth 授权。连接为 App 全局服务，启用后可用于项目对话和快速对话。手动输入的 MCP Token 仅保存在本机密码本；OAuth 刷新授权由BoltPocket OAuth 服务加密保存，并只租约短期访问令牌。此类 MCP 请求内容由 App 直接发送给你选择的服务商。公网 MCP 必须使用 HTTPS；你明确配置的局域网 MCP 可使用未加密的 HTTP，但 OAuth 仍必须使用 HTTPS。"
    : "中国大陆发行版不建立或调用第三方 MCP 连接。历史版本保存的连接仍可删除，但不会连接、授权或执行工具。";
}

function generatedMediaDisclosure(config: ComplianceConfig) {
  if (!generatedImagesEnabled(config) && !generatedVideoEnabled(config)) {
    return "中国大陆发行版在导出文件的显式标识、技术标识和传播链路验收完成前，不开放 AI 图片或视频生成。";
  }
  return "生成媒体预览会显示“AI 生成”标识。导出或分享媒体时，你仍应核对适用地区对显式标识、机器可读来源信息及公开传播的要求。";
}

function englishOperator(config: ComplianceConfig) {
  return config.operatorName ?? "[To be completed: full legal operator name]";
}

function englishContact(config: ComplianceConfig) {
  return config.supportEmail ?? "[To be completed: privacy/support email]";
}

function englishAiServiceTable(config: ComplianceConfig) {
  if (config.registeredAiServices.length === 0) {
    return config.distributionRegion === "global"
      ? "- BoltPocket does not preconfigure an operator-managed model service. The user selects a compatible provider, and the consent screen identifies that provider, model, and processing location before data is sent."
      : "- [To be completed: provider, model, recipient, processing location, and filing/registration number]";
  }
  return config.registeredAiServices
    .map(
      (service) =>
        `- ${service.providerName} / ${service.modelName}: recipient ${service.recipientName}; processing location ${service.recipientLocation}; filing or registration number ${service.filingNumber}.`,
    )
    .join("\n");
}

function englishOauthDisclosure(config: ComplianceConfig) {
  if (!cloudDocumentConnectorsEnabled(config)) {
    return "The Mainland China release does not offer new Google Workspace or Notion cloud-document authorization. This prevents account or document data from being transferred before overseas-recipient notices, separate consent, cross-border mechanisms, network availability, and release acceptance are complete. Valid OAuth connections left by earlier versions can still be deleted under Privacy & Data, including the encrypted server authorization and local device session. Revoke upstream authorization separately on the provider’s account-security page.";
  }
  return "Google and Notion authorization tokens are encrypted by the BoltPocket OAuth service. The service also stores the external account identifier, display name, required metadata, and a device session lasting no more than 90 days so it can lease short-lived access tokens. Document bodies do not pass through the OAuth service. Under Privacy & Data, you can delete the encrypted server authorization and local device session. The service automatically cleans up authorization when no valid device session or pending authorization remains. You can also revoke the upstream provider authorization on its account-security page. Delete encrypted local copies separately from their projects.";
}

function englishMcpDisclosure(config: ComplianceConfig) {
  return thirdPartyMcpEnabled(config)
    ? "Customer-configured MCP services use the account, API token, or OAuth grant you provide. Connections are app-global services and, while enabled, are available to project and quick conversations. Manually entered MCP tokens remain in the device password vault; OAuth refresh grants are encrypted by the BoltPocket OAuth service, which leases only short-lived access tokens. MCP request content is sent directly from the app to the provider you selected. Public MCP endpoints require HTTPS. A local-network MCP endpoint you explicitly configure may use unencrypted HTTP, but OAuth still requires HTTPS."
    : "The Mainland China edition does not create or call third-party MCP connections. Connections retained from an earlier edition can be deleted, but cannot connect, authorize, or execute tools.";
}

function englishGeneratedMediaDisclosure(config: ComplianceConfig) {
  if (!generatedImagesEnabled(config) && !generatedVideoEnabled(config)) {
    return "The Mainland China edition does not expose AI image or video generation until visible labels, technical provenance labels, and the distribution path have passed release acceptance.";
  }
  return "Generated-media previews carry an AI-generated label. Before exporting or sharing media, check the applicable requirements for visible labels, machine-readable provenance, and public distribution.";
}

function englishPrivacy(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "privacy",
    title: "Privacy policy",
    markdown: `# BoltPocket Privacy Policy

Effective date: August 21, 2026

Operator: ${englishOperator(config)}

Contact: ${englishContact(config)}

${config.distributionRegion === "china-mainland" ? "> If this page still shows “To be completed,” this version is for development and review preparation only and must not be used as an official Mainland China release.\n\nIn the Mainland China edition, this policy, the terms, the personal-information collection list, the third-party service list, and the system-permission list are available in Simplified Chinese before the main application mounts. Until you agree to the current version, BoltPocket does not start sign-in restoration, the Agent, WebViews, or other network capabilities. Your versioned choice and the exact document digest stay in device secure storage. You may withdraw the general choice under Privacy & Data; the main application then closes and no new network processing starts. Separate consent is still required for sensitive information and each model recipient/data scope.\n" : ""}

## 1. How we process information

BoltPocket is a conversation-first general-purpose Agent. Most projects, conversations, memories, Skills, Diffs, receipts, credential descriptions, and connector caches stay on your device and are protected by system secure storage and an encrypted database. A Skill downloaded from the BoltPocket Skill Market keeps its executable SKILL.md in a separate encrypted local store; the app does not display or edit that content and decrypts it into volatile memory only for an Agent run in which the Skill is enabled. A Skill and README that you choose to publish are an exception to local-only processing and are sent to the first-party market as described below. Secrets such as model API keys, personal Codex OAuth tokens, SSH passwords, and private keys stay in system secure storage, are not written to ordinary project files, and are not logged.

To complete tasks you initiate, BoltPocket may process:

- Conversations and attachments: text you enter and images or files you select.
- Project context: project instructions, memory, enabled Skills, relevant files, and required conversation history.
- External documents: account identifiers you explicitly authorize for Google or Notion and document content required for reading or editing.
- Device capabilities: device/power/storage/network status, camera, microphone, photos, current location, Wi-Fi and Bluetooth discovery, bounded local-device communication, external-App handoff, calendar and reminders, foreground sensor samples, audio playback metadata, file selection, or clipboard access only when you, an authorized Agent task, or an authorized website/H5 app actively uses them. A project H5 app separately shows each capability, concrete purpose, one-operation/session scope, and any external recipient before access. A Device Profile restricts communication only if you explicitly create it as an allowlist.
- Operations and security information: error states, change Diffs, internal hashes, versions, recovery points, and receipts. The OAuth service records only request method, path, status, and request identifier—not tokens or full sensitive content.

## 2. Third-party AI and cross-border transfers

BoltPocket sends only task-required data to the model service you select. Before messages, attachments, project context, or authorized documents are first sent to a recipient and model, the app lists the recipient, model, data categories, and processing location and asks for explicit consent. A different model or broader data scope requires consent again. Nothing is sent for a request you deny.

If you choose the experimental personal Codex provider, the app starts OpenAI's device-code authorization directly, stores its access, refresh, and ID tokens only in device secure storage, and refreshes them directly with OpenAI. Those credentials are technically restricted to the exact official ChatGPT Codex endpoint and are never sent to a BoltPocket backend or a custom model host. Signing out removes the local credential and attempts upstream revocation.

The Mainland China release allows only models listed in its release registry. Currently configured services:

${englishAiServiceTable(config)}

If a recipient is outside Mainland China or its processing location is unknown, the consent page separately identifies the cross-border transfer. You can withdraw all AI data consent under Privacy & Data. Withdrawal does not affect processing already completed with consent, but no new data is sent until you consent again.

## 3. Connectors and OAuth

${englishOauthDisclosure(config)}

${englishMcpDisclosure(config)}

BoltPocket provides a searchable first-party Skill Market. Catalog requests include the release region, while search terms and category filtering stay on the device. Opening an entry sends its identifier to the market and returns only its public README.md and recommendation metadata. Downloading separately returns the exact reviewed SKILL.md with a no-store response; the app saves it in a dedicated encrypted local store, does not expose it in a detail or editor, and decrypts it only during an enabled Agent run. Browsing and downloading do not send project files, conversations, model credentials, or MCP credentials. If you explicitly ask the Agent to publish a project Skill while signed in, the app sends that exact SKILL.md, its public README.md, and the public publisher, category, tags, and license metadata to the first-party market for deterministic sensitive-data and security review. Blockers prevent publication; a passing review is repeated before a hash-bound, version-checked publication. The README and metadata then become public and the reviewed SKILL.md becomes available to downloaders, although it is never shown on the detail page. Direct Skill installation remains available by entering an HTTPS URL, or an HTTP URL on your local network, that returns SKILL.md, or by entering a public GitHub repository root containing SKILL.md. For an ordinary URL, the app sends a credential-free request directly from your device; local HTTP traffic is not encrypted in transit. For a GitHub repository root, the device reads public GitHub metadata and a bounded archive for an exact commit; if unauthenticated metadata is rate-limited, it can read the public HEAD archive and bind the package to its downloaded hashes. For a canonical Skills.sh URL, the first-party relay receives that entry identifier and reads the complete Skill directory from its public GitHub repository at a pinned commit. BoltPocket validates the complete size-bounded package and does not execute repository scripts, packages, native code, or supporting files during diagnosis or installation.${thirdPartyMcpEnabled(config) ? " MCP remains outside the market; customer-configured MCP traffic is sent directly to the endpoint you enter." : " MCP remains outside the market and is unavailable in this edition."}

## 4. Sharing, processors, and disclosure

We do not sell personal information. Apart from models, connectors, websites, and system share targets you choose, information is shared or disclosed only to meet legal obligations, protect personal or property safety, or with separate authorization. When you publish a Skill, you direct BoltPocket to disclose its README and public metadata and to provide its reviewed SKILL.md to downloaders under the license you select. Independent third-party processing rules are listed under Third-party Services & Permissions.

## 5. Retention and security

You control on-device content, which remains until you delete it, clear app data, or uninstall the app. This includes encrypted market downloads; disabling a Skill stops later use but does not itself remove the protected local payload. A personal Codex credential remains in device secure storage until you sign out, delete model settings, clear app data, or uninstall; OpenAI account controls govern any upstream authorization record. Google and Notion OAuth device sessions last no more than 90 days. MCP OAuth sessions renew when used and expire after 90 days of inactivity. Encrypted authorization is cleaned up when you delete a connection or no valid device session or pending authorization remains. Published Skill versions, review records, patches, and receipts remain account-bound in the first-party market until BoltPocket account deletion; recovery can restore a previous listing state but cannot erase copies already downloaded by other users. Deleting the BoltPocket account from its account page permanently deletes the hosted identity and live first-party records bound to its pseudonymous subject hash. Minimal security audit records expire within 30 days. Deleted live records may remain in access-restricted disaster-recovery backups for no more than 14 days before automatic expiry. Safeguards include encrypted storage, least privilege, short-lived token leases, redacted findings and logs, version checks before external writes, and recovery points. Internet services cannot guarantee absolute security; if an incident may affect your rights, the operator will take legally required remedial and notification steps.

## 6. Your rights

Subject to applicable law, you may access, copy, correct, supplement, delete, or restrict processing; withdraw consent; and request an explanation of this policy. The app lets you review and withdraw AI consent, delete server-side OAuth connections, delete model credentials, manage browser permissions, and permanently delete the BoltPocket account from its account page. A BoltPocket account is optional for general on-device app use, Skill Market browsing and downloading, and direct Skill URL loading. Sign-in is required for account-bound BoltPocket backend capabilities such as Skill publication, OAuth brokering, and safety services. The backend validates a short-lived account token, briefly caches only its digest-to-subject result, and binds stored publications, OAuth sessions, and grants to a pseudonymous account-subject hash. Account deletion does not remove encrypted content that exists only on your device or copies of a published Skill that other users already downloaded; delete local projects and conversations in the app, and clear app data or uninstall to erase protected market downloads. For requests that cannot be completed in the app, contact ${englishContact(config)}. We will verify only the identity information needed and respond within the legally required period.

## 7. Children

${config.distributionRegion === "china-mainland" ? "The Mainland China edition is provided only to users who confirm they are at least 18 years old. It does not collect a birth date or identity document for this confirmation. A minor must not use this edition. If the operator learns that a child’s personal information was processed, it will stop that processing and delete the information as required by law." : "This product is not directed to children under 14. A child under 14 should use it only with a guardian’s consent and guidance. If the operator learns that a child’s personal information was processed without guardian consent, it will be deleted as required by law. Open web pages, AI output, SSH, and other professional capabilities may be unsuitable for minors."}

## 8. Updates and contact

Material changes will be presented prominently in the app and any required consent will be obtained again. Operator address: ${config.operatorAddress ?? "[To be completed: operator contact address]"}. Send privacy, content-safety, complaint, and account-data questions to ${englishContact(config)}.`,
  };
}

function englishTerms(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "terms",
    title: "Terms of service",
    markdown: `# BoltPocket Terms of Service

Effective date: August 21, 2026

Service provider: ${englishOperator(config)}

${config.distributionRegion === "china-mainland" ? "> Before a Mainland China release, the operator and qualified counsel must confirm these terms. Do not publish while any “To be completed” item remains.\n" : ""}

## 1. Service

BoltPocket provides a conversational Agent, project files, memory, Skills, a searchable first-party Skill Market, a browser, H5 previews, external-document connections, SSH, and related tools. Market detail displays a publisher's README but not its executable SKILL.md; a download is encrypted locally and is decrypted only for an enabled Agent run. Models and some connectors are provided by third parties you select. Every external change, including Skill publication, produces a deterministic text Diff, binds it to an internal hash, rechecks the target version, creates a recovery point, and then applies automatically. The Diff, receipt, and recovery action remain available for review.

## 2. Eligibility and authorization

You must have legal capacity and valid authorization for connected accounts, devices, files, and services.${config.distributionRegion === "china-mainland" ? " You must be at least 18 years old to use the Mainland China edition." : ""} You are responsible for protecting model API keys, SSH credentials, and device unlock methods, and for reviewing third-party pricing, data policies, and usage limits.

## 3. Prohibited conduct

Do not use the product for unlawful activity, rights violations, bypassing access controls, illegal or harmful content, malware, unauthorized device control, bulk personal-data collection, or intellectual-property infringement. Do not publish credentials, private keys, personal information you lack authority to disclose, instructions that conceal external mutations, or content designed to bypass safety controls. Automated review reduces common risks but is not an endorsement or guarantee of safety. Do not treat AI output as the sole basis for medical, legal, financial, or safety-critical action.

## 4. AI output

AI content may be inaccurate, incomplete, or outdated and is marked as AI-generated in the interface. Verify facts, rights, and risks before using, publishing, or acting on it. For external writes, review the Diff, receipt, and recovery point. See Generative AI Service Rules for model rules and filing information.

## 5. Third-party services

Google, Notion, model APIs, external websites, system sharing, and SSH are also governed by their own terms. The operator does not control their availability, pricing, or independent processing, but obtains the authorization described in the app before sending data.

## 6. Intellectual property

Rights in the app software, built-in interface, and owned resources remain with their owners. You retain rights in lawful inputs and project material and authorize processing only as needed to complete your instructions. When publishing a Skill, you represent that you have the necessary rights and authority and instruct BoltPocket to host and publicly display its README and metadata and distribute its reviewed SKILL.md under the license you select. Recovery may withdraw or restore a listing state but does not revoke rights already granted under that license or erase copies already downloaded. Third-party and open-source resources follow their licenses. You are responsible for checking whether AI output includes third-party rights.

## 7. Changes and liability

The service may change or pause for security, compliance, or maintenance. To the extent permitted by law, the operator is not liable beyond mandatory legal obligations for third-party outages, user misconfiguration, or unverified AI output. This does not exclude consumer or personal-injury rights that cannot legally be limited.

## 8. Contact and disputes

Send complaints, reports, and data requests to ${englishContact(config)}. Disputes should first be discussed in good faith. Mandatory consumer protections and the law and courts that have jurisdiction under applicable rules continue to apply.`,
  };
}

function englishAiRules(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "ai-rules",
    title: "Generative AI service rules",
    markdown: `# BoltPocket Generative AI Service Rules

Updated: August 21, 2026

## Service and model disclosure

BoltPocket is a work assistant and knowledge Q&A Agent; anthropomorphic emotional companionship is not its primary purpose. The Mainland China release connects only to models recorded in its approved filing or registration configuration:

${englishAiServiceTable(config)}

## Data consent

Before content is first sent to a third-party model, the app lists the recipient, model, data categories, processing location, and filing or registration details. Data is transferred only after you select “Consent separately and send.” A changed recipient, model, or expanded data scope requires consent again. Consent can be withdrawn under Privacy & Data.

## Content labels

Chat, full-answer pages, Agent change reviews, and copied answers display an AI-generated label. Do not maliciously remove, alter, or hide labels required by law or use AI content to mislead the public. To keep code, configuration, and third-party documents functional, files written by the Agent at your request may not embed a label. Before publishing or distributing those files, add any explicit label required by applicable rules. The operator must verify the terms, user initiation, and necessary log-retention controls for this path before release; otherwise unlabeled file output must be disabled in the Mainland China build. ${englishGeneratedMediaDisclosure(config)}

## Safety and acceptable use

Do not generate or distribute legally prohibited information or violate national security, the public interest, personal information, likeness, reputation, trade secrets, or intellectual property. Do not submit sensitive personal information, state secrets, or third-party secrets you are not authorized to provide. Qualified people must review medical, legal, financial, news, child-safety, and other high-risk uses.

## Complaints and response

For illegal or harmful content, labeling issues, rights violations, or model anomalies, preserve the conversation time, model name, and only the screenshots needed, then contact ${englishContact(config)}. The operator will register and assess the issue, preserve minimum necessary evidence, and take legally required actions such as stopping generation, blocking a model, deleting content, notifying a provider, or reporting to authorities. For immediate personal-safety risks, contact local emergency services.`,
  };
}

function englishThirdParties(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "third-parties",
    title: "Third-party services & permissions",
    markdown: `# Third-party Services & Permissions

Updated: August 21, 2026

## Third-party services

${englishAiServiceTable(config)}

- OpenAI ChatGPT/Codex (where enabled and selected by the user): processes device authorization, account-scoped OAuth tokens, and model request content. Tokens stay in device secure storage and requests go directly to OpenAI's official endpoints.
- BoltPocket Skill Market (first party): receives release region and selected entry identifiers for browsing or downloading; search text remains on the device. When you publish while signed in, it receives the exact project SKILL.md, public README.md, publisher name, category, tags, license, and account-bound version/review records. Public detail exposes only README and metadata; the reviewed Skill document is delivered only through the separate download response.

${
  cloudDocumentConnectorsEnabled(config)
    ? `- Google Workspace: accesses Docs, Sheets, Slides, and Drive resources you authorize; processes account identifiers, authorization tokens, and selected document content.
- Notion: accesses workspace pages you authorize; processes workspace identifiers, authorization tokens, and selected page content.
- BoltPocket OAuth Broker: stores encrypted Google/Notion tokens, external account identifiers, required metadata, and device sessions; it does not relay document bodies. The release configuration determines the service URL.`
    : "- Google Workspace, Notion, and the BoltPocket OAuth Broker: new authorization and access are unavailable in the Mainland China release; only deletion of valid legacy connections remains available."
}
${
  thirdPartyMcpEnabled(config)
    ? "- Customer-configured Remote MCP services: receive tool arguments directly from the app using the account, API token, or OAuth grant you provide."
    : "- Remote MCP services: unavailable in the Mainland China edition; retained connections cannot make network requests."
}
- Skill URL hosts: when you enter a direct HTTPS URL or local-network HTTP URL, the app requests the SKILL.md text from that host without credentials. Local HTTP traffic is unencrypted.
- Skills.sh and public GitHub: for a canonical Skills.sh URL, the bounded relay reads and validates the complete public Skill directory at a pinned commit. For a public GitHub repository root, the device requests public repository metadata and a bounded archive without credentials, then binds every retained file to its hash.
- Websites you visit, system share targets, and SSH hosts: receive data you actively submit and process it under their own rules.
- Project H5 recipient origins: a schema 3 app may list exact HTTPS/WSS recipients and purposes. The host shows that dynamic list and does not load the app until you agree. When any recipient is declared, every device capability must explicitly name its declared recipients or state that processing remains local. The exact-origin network boundary is enforced by the host; the global edition accepts validated declarations, while the Mainland China edition additionally requires the origin in the signed release registry and currently keeps that registry empty.

## System permissions

- Camera: captures conversation images or serves a website/H5 app you explicitly authorize.
- Microphone: serves a website/H5 app you explicitly authorize.
- Photos and files: selects and attaches content; the app does not scan your photo library in the background.
- Location while in use: provides approximate or precise current location to an Agent task or website/H5 app you explicitly authorize.
- Calendars and reminders: reads or changes only the calendars, events, and reminder items needed for an Agent action you authorize; reminders use the public iOS interface and are unavailable on Android.
- Motion and orientation: serves an Agent sensor request, game, or interactive page you explicitly authorize; Agent sampling is foreground-only and bounded.
- Nearby Wi-Fi devices (Android): reads the current network and performs a bounded nearby-network scan for an authorized Agent task; results omit BSSID/MAC addresses and passwords.
- Nearby Bluetooth devices (Android): performs a bounded BLE scan or connects to the temporary device handle selected for an authorized Agent task; UUIDs and bounded values may be supplied for that task, and an optional user-created Device Profile allowlist can restrict them.
- Local network: connects only to an exact local endpoint supplied for the authorized Agent task, an endpoint permitted by an optional user-created Device Profile allowlist, or an SSH host explicitly configured for that project. Public destinations are rejected by the device communication tool.
- Clipboard, system sharing, downloads, external apps, and full-screen media: controlled by their corresponding feature controls and per-task authorization.
- Notifications and foreground services (Android): indicate Agent tasks that are still running and provide the required media notification/channel during audio playback; they are not used for advertising tracking.

The app does not request an advertising identifier, perform cross-app tracking, or include an advertising SDK. App Store privacy labels must be checked against the final release binary, model services, and operator deployment.`,
  };
}

function englishPersonalInformation(
  config: ComplianceConfig,
): ComplianceDocument {
  return {
    id: "personal-information",
    title: "Personal information collection list",
    markdown: `# Personal Information Collection List

Updated: August 21, 2026

This list distinguishes information that stays on the device from information received by the operator or another recipient. Merely storing content in BoltPocket's encrypted local database does not send it to the operator.

## On-device information

- Projects, conversations, memory, Skills, browser bookmarks, Diffs, receipts, recovery points, and downloaded attachments: created when you use the corresponding feature; stored in the encrypted local database until you delete the item, clear app data, or uninstall. A market-downloaded SKILL.md is kept in a separate encrypted local repository, cannot be viewed or edited in the UI, and is decrypted into memory only while an enabled Agent run uses it.
- Model API keys, personal Codex credentials, SSH passwords and private keys: entered or authorized by you; stored in platform secure storage until you delete or sign out; never included in ordinary project files or logs.
- Privacy and model-recipient consent records: record policy/model scope, recipient, data categories, and decision time; stored locally until superseded or withdrawn. Platform secure storage may retain the current record across an app reinstall; when no current record is readable, BoltPocket asks again before the main app starts.
- Mainland adult-eligibility confirmation: stores only a local yes/no confirmation with the current privacy decision; it does not collect a birth date or identity document.

## Information sent only when you start a feature

- BoltPocket account: account subject identifier, username, display name, email address, and optional avatar URL. It is received by the account service at ${config.authenticationUrl ?? "[account service pending]"} when you sign in or restore an existing signed-in session. An account is not required for general on-device use. Hosted identity and live account-bound records remain until account deletion; restricted disaster-recovery backups expire within 14 days.
- Model request: the message, attachments you select, required conversation history, project instructions, memory, enabled Skills, and authorized connected-document excerpts. It is sent directly to the model recipient shown on the separate-consent sheet only after you approve that exact recipient, model, and data scope. BoltPocket's first-party backend does not relay model request content. The independent recipient's disclosed retention rules also apply.
- Safety report: account-subject hash, random installation identifier hash, network-address hash, category, target identifier hash, app version, platform, language, and—only when you opt in—an encrypted excerpt or note. A Skill Market report also retains the reported entry's public identifier so moderators can locate it; it does not retain the publisher's account identifier. It is sent to ${config.firstPartyApiUrl ?? "[first-party service pending]"}; records expire within 30 days.
- Skill Market execution status: before decrypting an enabled market Skill, the app sends its public entry identifier, revision, SHA-256 and release region to ${config.firstPartyApiUrl ?? "[first-party service pending]"} and refuses execution when the exact version is no longer approved. Publisher blocks are encrypted on this device and are not uploaded.
- Skill Market browse or download: release region and the selected entry identifier are sent to ${config.firstPartyApiUrl ?? "[first-party service pending]"}; the service also receives ordinary connection data such as the network address. Search text and category filters stay on the device. No project file, conversation, or credential is included.
- Skill Market publication: after explicit upload intent and sign-in, the exact project SKILL.md, public README.md, public publisher name, category, tags, license, review hashes, and version preflight are sent to ${config.firstPartyApiUrl ?? "[first-party service pending]"}. Passing content, versions, deterministic patches, and receipts remain bound to a pseudonymous account-subject hash until account deletion. README and public metadata are visible to anyone; the reviewed Skill document is available to downloaders but is not shown on the detail page.
- Direct Skill URL, website, or SSH host: the destination receives the network address and data you actively request or submit. Direct Skill retrieval carries no BoltPocket credential. Website and SSH content is not relayed through BoltPocket's first-party API.
- Project H5 recipient: after the pre-load recipient disclosure and any separate capability consent, an exact manifest-declared HTTPS/WSS origin may receive the network address and only the data the mini app sends for its displayed purpose. Preview cookies and normal-browser sign-in state are not shared. The Mainland China edition blocks origins absent from its signed registry.
${
  cloudDocumentConnectorsEnabled(config)
    ? "- Cloud-document authorization: provider account identifier, display name, encrypted authorization grant, device session, and selected document content needed for the task. Authorization metadata is retained while the connection is active; device sessions last no more than 90 days. Document bodies go directly between the device and provider."
    : "- Google Workspace and Notion cloud-document collection is disabled in the Mainland China edition."
}
${
  thirdPartyMcpEnabled(config)
    ? "- Customer-configured MCP: endpoint metadata, authorization state, and tool arguments you approve. Manually entered tokens remain in device secure storage; tool requests go directly to the configured service."
    : "- Third-party MCP collection and transmission is disabled in the Mainland China edition."
}

## System-permission information

Camera images, microphone media, selected photos/files, current location, nearby Wi-Fi names, BLE advertisements, motion data, clipboard content, and profile-declared local-network responses are processed only after the corresponding feature and system authorization are triggered. Agent device access additionally follows the per-capability Allow, Ask Each Time, or Block setting. Project H5 access uses a separate content-hash-bound sheet for every declared capability; denial suppresses repeat prompts for that preview and the user can reset it under Permissions & data. The exact purpose and denial effect are listed in the System Permission List.

## Rights and contact

Use Privacy & Data and the account page to withdraw consent, delete authorizations, or delete the account. Delete on-device items in their own screen. For access, copy, correction, supplementation, deletion, restriction, or an explanation, contact ${englishContact(config)}.`,
  };
}

function englishPermissions(_config: ComplianceConfig): ComplianceDocument {
  return {
    id: "permissions",
    title: "System permission list",
    markdown: `# System Permission List

Updated: August 21, 2026

BoltPocket does not request these permissions in bulk at launch. A system prompt appears only after you start the relevant feature, and refusal does not disable unrelated features.

For a project H5 app, BoltPocket first displays the exact capability, authored purpose, one-operation or preview-session scope, and external recipients. A refusal is remembered only for that preview to prevent repeated prompting. The user can review or reset the decision under Permissions & data. Switching, closing, backgrounding, or changing app content expires the decision and releases active resources.

- Camera: take a conversation photo, scan a code, or let a website/project H5 app you explicitly authorize capture media. Data is used for that active task; no background capture.
- Microphone: let a website/project H5 app you explicitly authorize capture audio. Data is used for that active task; tracks stop when the page closes or loses authorization.
- Photos and files: choose an attachment or website upload. BoltPocket receives only the item you select and does not scan the library in the background.
- Location while in use: provide approximate or precise current location to an Agent task or website/project H5 app you explicitly authorize. BoltPocket does not request background location.
- Calendars and reminders: list or change only the calendar events and reminder items needed for an Agent action you authorize. Reminder access is iOS-only; every write is version-rechecked, receipted, and recoverable.
- Motion, orientation, pressure, light, and steps: provide only a bounded foreground sensor sample for an Agent action you authorize, or support an explicitly authorized game or interaction while it is open.
- Nearby Wi-Fi devices (Android): read current Wi-Fi and perform a bounded nearby-network scan for an Agent task. BoltPocket omits BSSID/MAC addresses and passwords, does not silently join a network, and does not scan in the background.
- Nearby Bluetooth devices (Android): perform a bounded BLE scan and direct GATT service discovery, read, notification, or reversible write for an Agent task. BoltPocket returns temporary app-session device handles instead of hardware addresses, does not scan in the background, and enforces a Device Profile allowlist only when the user explicitly creates one.
- Local network: connect to a local model, MCP service, Skill URL, website, exact HTTP/TCP/UDP endpoint supplied for an authorized task, endpoint permitted by an optional user-created Device Profile allowlist, or project-authorized SSH host that you explicitly configure, open, or authorize. Public model, MCP, and Skill endpoints still require HTTPS; direct device communication rejects public destinations, and local HTTP is unencrypted. It is not used for advertising.
- Agent device controls: each base capability has Allow, Ask Each Time, and Block choices under Settings. Ask Each Time approves only the displayed operation and purpose; leaving the app rejects an unanswered request. Operating-system permission remains authoritative.
- Clipboard read/write: only after a user or separately authorized browser task invokes the operation; never polled in the background.
- Notifications and Android foreground service: show an Agent task that continues while the app is not foregrounded and the required media notification/channel for audio playback; not used for marketing.
- Sharing, printing, downloads, external apps, picture-in-picture, AirPlay, screen orientation, wake lock, vibration, and protected media: available only through the corresponding user action and browser capability switch.

Privacy-relevant native components in the release include React Native/Expo device modules, Expo Audio, Calendar, Sensors, Camera, Image Picker, Location, Clipboard, Secure Store, SQLite, Sharing and Web Browser, React Native WebView, community Geolocation, and the repository-owned device-capability, SSH, and background modules. They provide local platform integration and do not independently operate an advertising or analytics backend. The final signed binary and package versions must be re-audited before every store submission.

BoltPocket requests no advertising identifier, performs no cross-app tracking, and includes no advertising or behavioral-analytics SDK.`,
  };
}

function privacy(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "privacy",
    title: "隐私政策",
    markdown: `# BoltPocket隐私政策

生效日期：2026 年 8 月 21 日

运营者：${operator(config)}

联系邮箱：${contact(config)}

${config.distributionRegion === "china-mainland" ? "> 如本页仍显示“待填写”，本版本仅供开发和送审准备使用，不得作为中国大陆正式发布版本。\n\n中国大陆发行版会在进入主界面前提供本政策、用户协议、个人信息收集清单、第三方服务清单和系统权限清单的简体中文版。在你同意当前版本前，BoltPocket不会启动登录恢复、Agent、WebView 或其他联网能力。规则版本、完整文档摘要和选择时间仅保存在设备安全存储中。你可在“隐私与数据”撤回总体选择；撤回后主界面立即关闭，不再开始新的联网处理。敏感个人信息以及每个模型接收方和数据范围仍会另行取得单独同意。\n" : ""}

## 一、我们如何处理信息

BoltPocket是以对话为主的通用 Agent。大部分项目、对话、记忆、Skills、Diff、回执、凭据说明和连接器缓存保存在你的设备上，并使用系统安全存储与加密数据库保护。从BoltPocket Skill 市场下载的可执行 SKILL.md 会进入独立的本机加密存储；App 不展示或编辑其内容，仅在该 Skill 已启用且参与 Agent 运行时临时解密到内存。你主动发布的 Skill 与 README 是本机处理的例外，会按下文说明发送到第一方市场。模型 API Key、个人 Codex OAuth 令牌、SSH 密码或私钥等秘密保存在系统安全存储中，不写入普通项目文件，也不会在日志中输出。

为完成你主动发起的任务，可能处理以下信息：

- 对话与附件：你输入的文字、主动选择的图片或文件。
- 项目上下文：项目指令、记忆、启用的 Skills、相关文件和必要的对话历史。
- 外部文档：你明确授权的 Google 或 Notion 账号标识，以及任务需要读取或修改的文档内容。
- 设备能力：仅在你、获准的 Agent 任务或获准的网站/H5主动使用时，处理设备/电源/存储/网络状态、相机、麦克风、照片、当前位置、Wi-Fi 与蓝牙发现、有界本地设备通信、外部 App 唤起、日历与提醒事项、前台传感器样本、音频播放元数据、文件选择或剪贴板等能力；项目 H5 会在访问前另行展示每项能力、具体用途、单次/会话范围及外部接收方；只有你明确新建 Device Profile 白名单时才按其限制通信。
- 运行与安全信息：错误状态、修改 Diff、内部哈希、版本、恢复点和回执。OAuth 服务仅记录请求方法、路径、状态和请求标识，不记录令牌或完整敏感内容。

## 二、第三方 AI 与跨境提供

你选择模型服务后，BoltPocket才会向相应接口发送完成任务所必需的数据。首次向某一接收方及模型发送消息、附件、项目上下文或已授权文档前，App 会单独展示接收方、模型、数据类别和处理地点，并取得你的明确同意。不同模型或更大的数据范围会重新征求同意。你拒绝时不会发送该次内容。

如你选择实验性的个人 Codex 服务，App 会直接发起 OpenAI 设备代码授权，把访问令牌、刷新令牌和 ID 令牌仅保存在设备安全存储中，并直接向 OpenAI 刷新。该凭据在技术上只允许发送到官方 ChatGPT Codex 精确地址，不会发送到BoltPocket后端或自定义模型地址。退出登录会删除本机凭据并尝试撤销上游授权。

中国大陆发行版只允许运行已写入发行登记表的模型；未登记模型会被客户端阻止。当前配置的服务为：

${aiServiceTable(config)}

接收方位于中国大陆境外或处理地点不明确时，授权页会单独提示跨境提供。你可以在“隐私与数据”撤回全部 AI 数据授权；撤回不影响撤回前基于同意完成的处理，但新数据不会继续发送，除非你再次同意。

## 三、连接器与 OAuth

${oauthDisclosure(config)}

${mcpDisclosure(config)}

BoltPocket提供可搜索的第一方 Skill 市场。读取目录时会发送发行地区，搜索词和分类筛选只在设备本地处理；打开详情会向市场发送条目标识，并且只返回公开的 README.md 与推荐基础信息。单独点击下载后，接口以禁止缓存的响应返回经过审核的准确 SKILL.md；App 将其写入独立的本机加密存储，不在详情页或编辑器展示，并只在已启用的 Agent 运行期间解密。浏览与下载不会发送项目文件、对话、模型凭据或 MCP 凭据。你在登录后明确要求 Agent 发布项目 Skill 时，App 会把准确的 SKILL.md、公开 README.md、发布者名称、分类、标签和许可证发送到第一方市场，进行确定性的敏感数据与安全检查；存在阻断项时不得发布，通过后还会在绑定哈希、复核版本的发布前再次审核。发布后 README 与基础信息公开，经过审核的 SKILL.md 可由下载者取得，但不会显示在详情页。你仍可输入一个返回 SKILL.md 的 HTTPS 地址、局域网 HTTP 地址，或根目录包含 SKILL.md 的公开 GitHub 仓库地址直接安装 Skill；普通文档地址由设备发起不带凭据的请求，局域网 HTTP 流量在传输中不加密。GitHub 仓库地址由设备读取公开元数据及固定 commit 的大小受限归档，未认证元数据受限时可读取公开 HEAD 归档并把每个文件绑定到实际下载哈希；规范 Skills.sh 地址则由第一方中转按条目标识读取公开 GitHub 仓库中固定 commit 的完整 Skill 目录。BoltPocket校验完整、大小受限的包，诊断或安装时不执行仓库脚本、软件包、原生代码或配套文件。${thirdPartyMcpEnabled(config) ? "MCP 不进入 Skill 市场；客户自行配置的 MCP 流量直接发送到你输入的地址。" : "MCP 不进入 Skill 市场，当前版本也不提供 MCP 添加入口。"}

## 四、共享、委托处理与公开披露

除你主动选择的模型、连接器、网站和系统分享目标外，我们不会出售个人信息。只有在履行法定义务、保护人身财产安全或取得你的另行授权时，才会依法共享或披露。你发布 Skill 时，即指示BoltPocket公开其 README 与发布基础信息，并按照你选择的许可证向下载者提供经过审核的 SKILL.md。第三方服务的独立处理规则见“第三方服务与权限”。

## 五、保存期限与安全

本机内容由你控制，保留至你删除、清除 App 数据或卸载 App，其中包括加密保存的市场下载内容；停用 Skill 会阻止后续使用，但不会自动删除受保护载荷。个人 Codex 凭据会保留在设备安全存储中，直至你退出登录、删除模型设置、清除 App 数据或卸载 App；上游授权记录由 OpenAI 账号控制。Google 和 Notion OAuth 设备会话最长 90 天；MCP OAuth 会话在使用时自动续期，连续 90 天未使用后失效。你主动删除连接，或服务端不再存在有效设备会话和待完成授权时，相应加密授权会被清理。已发布 Skill 的版本、审核记录、Patch 和回执会按账号绑定保存在第一方市场，直至删除BoltPocket账号；恢复操作可还原先前的上架状态，但不能删除其他用户已经下载的副本。在账号页删除BoltPocket账号会永久删除托管身份，以及按账号主体哈希绑定的在线第一方记录；最小化安全审计记录在 30 天内过期，已删除在线记录可能继续存在于隔离的灾难恢复备份中，并在最长 14 天内自动过期。我们采取加密存储、最小权限、短期令牌租约、审核结果和日志脱敏、外部写入前版本复核与恢复点等措施。互联网服务无法保证绝对安全；发生可能影响你权益的事件时，将依法采取补救并通知。

## 六、你的权利

你可以依法查阅、复制、更正、补充、删除、限制处理、撤回同意，并要求解释本政策。App 内可查看和撤回 AI 授权、删除 OAuth 服务端连接、删除模型凭据、管理浏览器权限，并可在账号页永久删除BoltPocket账号。使用 App 的一般本机功能、浏览和下载 Skill 市场内容以及直接读取 Skill 地址不强制登录；发布 Skill、OAuth 中转、安全服务等与账号绑定的BoltPocket后端能力需要登录。后端验证短期账号令牌，仅短暂缓存令牌摘要到账号主体的校验结果，并以不可逆的账号主体哈希绑定发布记录、OAuth 授权和设备会话。删除账号不会删除仅存在本机的加密内容，也不能删除其他用户已经下载的发布副本；本机项目和对话可在 App 中删除，受保护的市场下载内容需通过清除 App 数据或卸载处理。无法在 App 内完成的请求，请联系 ${contact(config)}。我们会核验必要身份后在法定期限内答复。

## 七、未成年人

${config.distributionRegion === "china-mainland" ? "中国大陆发行版仅向确认已满 18 周岁的用户提供，不为确认年龄收集出生日期或身份证件。未成年人不得使用本发行版；运营者发现已处理儿童个人信息时，将停止处理并依法删除。" : "本产品不面向不满 14 周岁的儿童。未满 14 周岁的用户应在监护人同意和指导下使用；运营者在知情后会依法删除未经监护人同意处理的儿童个人信息。开放网页、AI 输出和 SSH 等专业能力可能不适合未成年人。"}

## 八、政策更新与联系我们

重大变更会以 App 内显著提示等方式重新取得必要同意。运营地址：${config.operatorAddress ?? "【待填写：运营主体联系地址】"}。个人信息、内容安全、投诉举报与账号数据问题均可发送至 ${contact(config)}。`,
  };
}

function terms(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "terms",
    title: "用户协议",
    markdown: `# BoltPocket用户协议

生效日期：2026 年 8 月 21 日

服务提供者：${operator(config)}

${config.distributionRegion === "china-mainland" ? "> 中国大陆正式发布前须由运营主体和具备资质的法律顾问确认本协议；“待填写”内容未完成时不得发布。\n" : ""}

## 1. 服务说明

BoltPocket提供对话式 Agent、项目文件、记忆、Skills、可搜索的第一方 Skill 市场、浏览器、H5 预览、外部文档连接和 SSH 等工具。市场详情展示发布者的 README，但不展示可执行的 SKILL.md；下载内容在本机加密，并只在已启用的 Agent 运行期间解密。模型和部分连接器由你选择的第三方提供。所有外部修改（包括 Skill 发布）都会生成确定性文本 Diff、绑定内部哈希、复核目标版本并建立恢复点，然后自动应用；Diff、回执和恢复操作可供审查。

## 2. 使用条件

你应具备相应民事行为能力并合法取得所连接账号、设备、文件和服务的授权。${config.distributionRegion === "china-mainland" ? "使用中国大陆发行版时，你还须已满 18 周岁。" : ""}你需自行保管模型 API Key、SSH 凭据和设备解锁能力，并核对第三方服务的费用、数据政策与使用限制。

## 3. 禁止行为

不得利用本产品从事违法犯罪、侵害他人权益、绕过访问控制、传播违法有害信息、制作恶意软件、未经授权控制设备、批量采集个人信息或侵犯知识产权的活动。不得发布凭据、私钥、无权披露的个人信息、要求隐藏外部修改的指令，或意图绕过安全控制的内容。自动审核只能降低常见风险，不代表运营者背书或保证安全。不得把 AI 输出当作医疗、法律、财务或安全关键操作的唯一依据。

## 4. AI 输出

AI 内容可能不准确、不完整或具有时效性，界面会显示“AI 生成”标识。你应在使用、发布或执行前核验事实、权利归属和风险。涉及外部写入时，请检查 Diff、回执及恢复点。模型服务规则和备案信息见“生成式 AI 服务规则”。

## 5. 第三方服务

你使用 Google、Notion、模型接口、外部网站、系统分享或 SSH 时，同时受相应第三方条款约束。运营者不控制第三方服务可用性、价格或独立数据处理，但会在发送数据前按 App 所述取得必要授权。

## 6. 知识产权

App 软件、内置界面和自有资源的权利归其权利人所有。你保留对合法输入和项目资料的权利，并授权服务在完成本次指令所必需的范围内处理。发布 Skill 时，你确认自己具备必要权利和授权，并指示BoltPocket托管和公开展示其 README 与基础信息，以及按照你选择的许可证分发经过审核的 SKILL.md。恢复操作可以撤回或还原某个上架状态，但不会撤销该许可证已经授予的权利，也不能清除已经下载的副本。第三方或开源资源依其许可证使用；你应自行确认 AI 输出是否包含第三方权利。

## 7. 服务变更与责任

为安全、合规或维护需要，服务可能调整或暂停。法律允许范围内，运营者不对第三方中断、用户错误配置或未经核验的 AI 输出承担超出法定范围的责任；本条不排除依法不得限制的消费者权利和人身损害责任。

## 8. 联系与争议

投诉、举报或数据请求请联系 ${contact(config)}。争议应先友好协商；适用规则规定的强制性消费者保护、法律与有管辖权的法院不受本协议排除。`,
  };
}

function aiRules(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "ai-rules",
    title: "生成式 AI 服务规则",
    markdown: `# BoltPocket生成式 AI 服务规则

更新日期：2026 年 8 月 21 日

## 服务与模型公示

BoltPocket是工作助理和知识问答型 Agent，不以拟人化情感陪伴为主要目的。中国大陆发行版仅连接已完成相应备案或登记、且写入发行配置的模型：

${aiServiceTable(config)}

## 数据授权

首次向第三方模型发送内容前，会明确列出接收方、模型、数据类别、处理地点和备案/登记信息。只有点击“单独同意并发送”后才会传输；拒绝不会发送。更换接收方、模型或扩大数据类别会重新征求同意，授权可在“隐私与数据”撤回。

## 内容标识

聊天流、完整回答页面、Agent 修改审阅页和复制出的回答均附带“AI 生成”显式标识。用户不得恶意删除、篡改或隐匿依法要求的生成合成内容标识，不得利用 AI 内容误导公众。为保持代码、配置和第三方文档可运行，Agent 按用户主动指令写入的文件正文可能不嵌入标识；用户将这些内容向公众发布或传播前，应按适用规则补充显式标识。正式发行前，运营者还须确认该路径的用户协议、主动请求和必要日志留存是否符合现行规则；不能确认时，应在中国大陆版本停用相应未标识文件输出。${generatedMediaDisclosure(config)}

## 安全与使用规范

不得生成或传播法律法规禁止的信息，不得侵害国家安全、公共利益、个人信息、肖像、名誉、商业秘密和知识产权。请勿输入无权提供的个人敏感信息、国家秘密或第三方秘密。医疗、法律、财务、新闻、未成年人和其他高风险场景必须由具备资质的人复核。

## 投诉与处置

发现违法有害内容、标识问题、个人权益侵害或模型异常，请保存对话时间、模型名称和必要截图，发送至 ${contact(config)}。运营者将登记、分级、保全最少必要证据，依法采取停止生成、阻断模型、删除内容、通知服务商、报告主管部门等措施，并反馈处理结果。紧急人身安全风险请直接联系当地紧急服务。`,
  };
}

function thirdParties(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "third-parties",
    title: "第三方服务与权限",
    markdown: `# 第三方服务与权限清单

更新日期：2026 年 8 月 21 日

## 第三方服务

${aiServiceTable(config)}

- OpenAI ChatGPT/Codex（仅在发行配置允许且由你选择时）：处理设备授权、账号范围 OAuth 令牌和模型请求内容；令牌保存在设备安全存储中，请求直接发送到 OpenAI 官方地址。
- BoltPocket Skill 市场（第一方）：浏览或下载时接收发行地区和所选条目标识，搜索词保留在设备本地；你登录并发布时，接收准确的项目 SKILL.md、公开 README.md、发布者名称、分类、标签、许可证及按账号绑定的版本和审核记录。公开详情只展示 README 和基础信息，经过审核的 Skill 文档仅通过单独下载响应提供。

${
  cloudDocumentConnectorsEnabled(config)
    ? `- Google Workspace：用于你主动授权的 Docs、Sheets、Slides 和 Drive 资源；处理账号标识、授权令牌和所选文档内容。
- Notion：用于你主动授权的工作区页面；处理工作区标识、授权令牌和所选页面内容。
- BoltPocket OAuth Broker：保存加密的 Google/Notion 令牌、外部账号标识、必要元数据和设备会话；不转发文档正文。服务地址由发行配置确定。`
    : "- Google Workspace、Notion 与BoltPocket OAuth Broker：在中国大陆发行版中不提供新的授权或访问；仅保留历史有效连接的删除能力。"
}
${
  thirdPartyMcpEnabled(config)
    ? "- 客户自行配置的 Remote MCP：使用你提供的账号、API Token 或 OAuth 授权，由 App 直接发送工具参数给相应服务商。"
    : "- Remote MCP：在中国大陆发行版中不可用；历史连接不会发起网络请求。"
}
- Skill 地址服务方：当你输入直接 HTTPS 地址或局域网 HTTP 地址时，App 从设备向该服务方发起不带凭据的请求并读取 SKILL.md 文本；局域网 HTTP 流量不加密。
- Skills.sh：当你输入规范的条目地址时，经BoltPocket第一方中转读取公开仓库中固定 commit 的完整 Skill 目录，不接收搜索词，也不执行仓库脚本。
${thirdPartyMcpEnabled(config) ? "- 直接 MCP 地址：对应服务可收到你授权的工具请求。" : ""}
- 公开 GitHub 仓库：输入对应 Skills.sh 地址时由受限中转读取并逐文件校验完整 Skill 包；输入 GitHub 仓库根地址时由设备读取公开仓库元数据及大小受限的归档，并将保留的每个文件绑定到实际下载哈希。
- 你访问的网站、系统分享目标及 SSH 主机：直接接收你主动提交的数据，按各自规则处理。
- 项目 H5 接收方：schema 3 小程序可声明精确 HTTPS/WSS 接收方及用途。宿主先展示动态清单且在你同意前不载入；存在接收方时，每项设备能力必须明确列出其接收方，或声明仅在小程序本地处理。宿主强制执行精确 origin 联网边界；国际版接受通过校验的声明，中国大陆版还要求接收方位于签名发行登记表，当前登记表为空。

## 系统权限

- 相机：拍摄对话图片，或供你明确授权的网站/H5使用。
- 麦克风：供你明确授权的网站/H5使用。
- 照片与文件：选择并附加内容；App 不会后台遍历照片库。
- 使用期间的位置：供你明确授权的 Agent 任务或网站/H5读取当前大致或精确位置。
- 日历与提醒事项：只读取或修改你授权的 Agent 动作所需日历、日程和提醒项目；提醒事项使用 iOS 公共接口，Android 不支持。
- 动作、方向、气压、光照与步数：供你授权的 Agent 在前台限时采样，或供你明确授权的游戏与交互页面使用。
- 附近 Wi-Fi 设备（Android）：供获准的 Agent 任务读取当前网络或执行限时附近网络扫描；结果不包含 BSSID/MAC 地址和密码。
- 附近蓝牙设备（Android）：供获准的 Agent 任务限时扫描 BLE，或连接本次任务选中的临时设备句柄；本次任务可提供 UUID 和有界载荷，你也可以用自己创建的 Device Profile 白名单限制它们。扫描结果不返回硬件地址。
- 局域网：连接你明确配置、打开或授权的局域网模型、MCP、Skill 地址、网站、获准任务明确提供的 HTTP/TCP/UDP 端点、你可选的 Device Profile 白名单允许的端点或项目 SSH 主机；公网模型、MCP 和 Skill 地址仍必须使用 HTTPS，设备直连工具拒绝公网目标，局域网 HTTP 流量不加密。
- 剪贴板、系统分享、下载、外部 App、全屏媒体等：由各自对应的功能开关和每个任务的独立授权共同控制。
- 通知与前台服务（Android）：用于显示仍在运行的 Agent 任务，以及音频播放所需的媒体通知/通道；不用于广告追踪。

App 不申请广告标识，不进行跨 App 跟踪，不接入广告 SDK。实际 App Store 隐私标签必须与正式发行包、模型服务和运营部署逐项复核。`,
  };
}

function personalInformation(config: ComplianceConfig): ComplianceDocument {
  return {
    id: "personal-information",
    title: "个人信息收集清单",
    markdown: `# 个人信息收集清单

更新日期：2026 年 8 月 21 日

本清单区分仅保存在设备上的信息，以及会由运营者或其他接收方收到的信息。内容保存在BoltPocket本机加密数据库中，不等于已向运营者发送。

## 一、仅在本机处理的信息

- 项目、对话、记忆、Skills、浏览器书签、Diff、回执、恢复点和已下载附件：在你使用对应功能时产生；保存在本机加密数据库，直至你删除对应内容、清除 App 数据或卸载。市场下载的 SKILL.md 存放在独立的本机加密仓库，界面中不可查看或编辑，仅在已启用的 Agent 运行使用它时解密到内存。
- 模型 API Key、个人 Codex 凭据、SSH 密码和私钥：由你填写或授权；保存在系统安全存储，直至你删除或退出；不会写入普通项目文件或日志。
- 隐私选择和模型接收方授权记录：记录规则或模型范围、接收方、数据类别及选择时间；保存在本机，直至被新版本替代或你撤回。系统安全存储可能在重新安装 App 后继续保留当前记录；无法读取当前有效记录时，BoltPocket会在进入主界面前重新询问。
- 中国大陆版成年资格确认：仅随当前隐私选择在本机保存“是否确认已满 18 周岁”，不收集出生日期或身份证件。

## 二、仅在你触发功能时发送的信息

- BoltPocket账号：账号主体标识、用户名、显示名、邮箱和可选头像地址。仅在登录或恢复已有登录时发送至 ${config.authenticationUrl ?? "【账号服务待部署】"}。一般本机功能不强制注册账号。托管身份及在线账号记录保留至注销；隔离灾备副本最长 14 天后过期。
- 模型请求：消息、你选择的附件、完成任务所需的对话历史、项目指令、记忆、启用的 Skills 和已授权文档片段。只有在你对授权页列明的接收方、模型和数据范围作出单独同意后，才会直接发送给该模型接收方；BoltPocket第一方后端不转发模型请求正文。接收方公示的独立保存规则同时适用。
- 安全举报：账号主体哈希、随机安装标识哈希、网络地址哈希、举报类别、目标标识哈希、App 版本、平台、语言，以及仅在你主动勾选时包含的加密摘要或备注。Skill 市场举报还会保留被举报条目的公开标识，供审核人员定位，但不会保留发布者账号标识。发送至 ${config.firstPartyApiUrl ?? "【第一方服务待部署】"}，最长 30 天后过期。
- Skill 市场执行状态：每次解密已启用的市场 Skill 前，App 会向 ${config.firstPartyApiUrl ?? "【第一方服务待部署】"} 发送公开条目标识、版本、SHA-256 与发行地区；准确版本不再获准时拒绝执行。发布者屏蔽列表仅加密保存在本机，不上传。
- Skill 市场浏览或下载：发行地区和所选条目标识发送至 ${config.firstPartyApiUrl ?? "【第一方服务待部署】"}，服务还会收到网络地址等普通连接信息。搜索词和分类筛选保留在设备本地，不包含项目文件、对话或凭据。
- Skill 市场发布：你明确要求上传并登录后，准确的项目 SKILL.md、公开 README.md、发布者名称、分类、标签、许可证、审核哈希和版本预检信息会发送至 ${config.firstPartyApiUrl ?? "【第一方服务待部署】"}。通过的内容、历史版本、确定性 Patch 和回执以假名化账号主体哈希绑定保存至账号删除；README 和公开基础信息对所有人可见，经过审核的 Skill 文档可由下载者取得，但不在详情页展示。
- 直接 Skill 地址、访问的网站或 SSH 主机：目标服务会收到网络地址，以及你主动请求或提交的数据。直接 Skill 请求不携带BoltPocket凭据；网页和 SSH 内容不经BoltPocket第一方 API 中转。
- 项目 H5 接收方：在载入前接收方告知及相应设备能力单独同意完成后，清单声明的精确 HTTPS/WSS origin 可收到网络地址，以及小程序按展示用途发送的数据；不共享普通浏览器 Cookie 或登录状态。中国大陆版会阻止未写入签名登记表的 origin。
${
  cloudDocumentConnectorsEnabled(config)
    ? "- 云文档授权：服务商账号标识、显示名、加密授权、设备会话和任务需要的所选文档内容。授权元数据在连接有效期间保存，设备会话最长 90 天；文档正文由设备直接与服务商交互。"
    : "- 中国大陆发行版不收集或传输 Google Workspace、Notion 云文档信息。"
}
${
  thirdPartyMcpEnabled(config)
    ? "- 客户配置的 MCP：端点元数据、授权状态和你批准的工具参数。手动 Token 留在系统安全存储，工具请求直接发送到配置的服务。"
    : "- 中国大陆发行版不收集或传输第三方 MCP 数据。"
}

## 三、系统权限产生的信息

相机图片、麦克风媒体、所选照片或文件、当前位置、附近 Wi-Fi 名称、BLE 广播、动作数据、剪贴板内容和 Profile 声明的局域网响应，仅在对应功能及系统授权被触发后处理。Agent 设备访问还遵循每项能力的“开启、使用时询问、关闭”设置。项目 H5 每项能力使用绑定内容哈希的独立授权；拒绝后本次预览不重复询问，用户可在“权限与数据”主动重置。具体目的及拒绝影响见“系统权限清单”。

## 四、权利与联系

你可以在“隐私与数据”和账号页撤回授权、删除连接或注销账号；本机内容可在对应页面删除。如需查阅、复制、更正、补充、删除、限制处理或要求解释，请联系 ${contact(config)}。`,
  };
}

function permissions(_config: ComplianceConfig): ComplianceDocument {
  return {
    id: "permissions",
    title: "系统权限清单",
    markdown: `# 系统权限清单

更新日期：2026 年 8 月 21 日

BoltPocket不会在启动时批量申请权限。只有你主动进入对应功能后才显示系统授权提示；拒绝某项权限不会停用无关功能。

项目 H5 会先展示准确能力名称、作者填写的具体用途、单次操作或当前预览会话范围，以及外部数据接收方。拒绝只在本次预览内保留以避免反复询问，用户可在“权限与数据”查看或重置；切换、关闭、退到后台或内容变化会使选择失效并释放正在使用的资源。

- 相机：拍摄对话图片、扫描条码，或供你明确授权的网站/项目 H5 拍摄媒体。仅用于当前任务，不在后台采集。
- 麦克风：供你明确授权的网站/项目 H5 采集音频。仅用于当前任务，页面关闭或授权结束后停止媒体轨道。
- 照片与文件：选择对话附件或网页上传文件。App 只接收你选择的项目，不会在后台遍历照片库。
- 使用期间的位置：向你明确授权的 Agent 任务或网站/项目 H5 提供当前大致或精确位置；不申请后台定位。
- 日历与提醒事项：只列出或修改你授权的 Agent 动作所需日程和提醒项目。提醒事项仅支持 iOS；每次写入都会重检版本、生成回执并可恢复。
- 动作、方向、气压、光照与步数：只为你授权的 Agent 动作提供有界的前台传感器样本，或在获准的游戏与交互页面打开期间提供。
- 附近 Wi-Fi 设备（Android）：为 Agent 任务读取当前 Wi-Fi 或执行限时附近网络扫描；不返回 BSSID/MAC 地址或密码，不静默加入网络，不在后台扫描。
- 附近蓝牙设备（Android）：为 Agent 任务执行限时 BLE 扫描，以及直接 GATT 服务发现、读取、订阅或可恢复写入；使用 App 会话临时设备标识，不在后台扫描，只有你明确创建 Device Profile 白名单时才按其限制。
- 局域网：连接你明确配置、打开或授权的局域网模型、MCP、Skill 地址、网站、获准任务明确提供的 HTTP/TCP/UDP 端点、你可选的 Device Profile 白名单允许的端点或项目 SSH 主机；公网模型、MCP 和 Skill 地址仍必须使用 HTTPS，设备直连工具拒绝公网目标，局域网 HTTP 流量不加密，不用于广告。
- Agent 设备权限：设置中每项基础能力均提供“开启、使用时询问、关闭”。“使用时询问”仅放行授权页展示的本次操作及用途；App 离开前台时，未回答请求自动拒绝；系统权限始终优先。
- 剪贴板读取/写入：仅响应用户操作或已单独授权的浏览器任务，不在后台轮询。
- 通知与 Android 前台服务：提示离开前台后仍在运行的 Agent 任务，并提供音频播放必须显示的媒体通知/通道，不用于营销推送。
- 分享、打印、下载、外部 App、画中画、AirPlay、屏幕方向、常亮、振动和受保护媒体：仅通过对应用户操作及浏览器能力开关使用。

正式发行包中的隐私相关原生组件包括 React Native/Expo 设备模块、Expo Audio、Calendar、Sensors、Camera、Image Picker、Location、Clipboard、Secure Store、SQLite、Sharing、Web Browser、React Native WebView、community Geolocation，以及仓库自有设备能力、SSH 和后台任务模块。这些组件用于本机平台能力，不独立运营广告或分析后端。每次商店送审前仍须以最终签名二进制和实际版本重新核对。

BoltPocket不申请广告标识，不进行跨 App 跟踪，不接入广告或行为分析 SDK。`,
  };
}

export function complianceDocument(
  id: ComplianceDocumentId,
  config: ComplianceConfig,
  locale: "en" | "zh-CN" = "zh-CN",
) {
  if (locale === "en") {
    if (id === "privacy") return englishPrivacy(config);
    if (id === "terms") return englishTerms(config);
    if (id === "ai-rules") return englishAiRules(config);
    if (id === "personal-information")
      return englishPersonalInformation(config);
    if (id === "permissions") return englishPermissions(config);
    return englishThirdParties(config);
  }
  if (id === "privacy") return privacy(config);
  if (id === "terms") return terms(config);
  if (id === "ai-rules") return aiRules(config);
  if (id === "personal-information") return personalInformation(config);
  if (id === "permissions") return permissions(config);
  return thirdParties(config);
}

export function isComplianceDocumentId(
  value: unknown,
): value is ComplianceDocumentId {
  return [
    "privacy",
    "terms",
    "ai-rules",
    "third-parties",
    "personal-information",
    "permissions",
  ].includes(String(value));
}
