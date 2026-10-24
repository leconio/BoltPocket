import type { SecurityMessageKey } from "../zh-CN/security.ts";

export const enSecurityMessages = {
  "security.aiConsent.approve": "Agree separately and send",
  "security.aiConsent.category.attachments": "Images or files you attach",
  "security.aiConsent.category.connectedDocuments":
    "Authorized document content required for this task",
  "security.aiConsent.category.message": "Messages you send",
  "security.aiConsent.category.projectContext":
    "Instructions, memory, and required context for the current project",
  "security.aiConsent.crossBorder.domestic":
    "The recipient is configured to process data in Mainland China. You can revoke approval at any time in About BoltPocket.",
  "security.aiConsent.crossBorder.overseas":
    "The recipient is located in {location}. By agreeing, you separately consent to this cross-border transfer of the listed personal information. You may withdraw at any time.",
  "security.aiConsent.crossBorder.overseasFallback": "outside Mainland China",
  "security.aiConsent.crossBorder.unknown":
    "The recipient’s processing location cannot be confirmed and a cross-border transfer may occur. By agreeing, you separately consent to sharing the listed data for the purpose above. Review the provider’s policy first.",
  "security.aiConsent.deny": "Don’t agree",
  "security.aiConsent.denyAccessibility": "Do not send data to third-party AI",
  "security.aiConsent.description":
    "This Agent run will use {model}. The following data is sent to the provider only after you agree:",
  "security.aiConsent.failed": "Could not save approval",
  "security.aiConsent.meta.endpoint": "Endpoint",
  "security.aiConsent.meta.filing": "Filing / registration",
  "security.aiConsent.meta.model": "Model",
  "security.aiConsent.meta.recipient": "Recipient",
  "security.aiConsent.policy":
    "This approval applies now and to later use of the same recipient, model, and data categories. You will be asked again if the recipient, model, categories, or policy version changes.",
  "security.aiConsent.retry": "Try again later.",
  "security.aiConsent.title": "Confirm before sending to third-party AI",
  "security.credential.approve": "Allow once",
  "security.credential.deny": "Deny",
  "security.credential.denyAccessibility":
    "Deny this password book access request",
  "security.credential.description":
    "If allowed, the model can read this secret once. Its content will not appear in the conversation.",
  "security.credential.kind.apiHeader": "API header credential",
  "security.credential.kind.apiToken": "Access token",
  "security.credential.kind.bearer": "Bearer token",
  "security.credential.kind.password": "Password",
  "security.credential.kind.secretText": "Secret text",
  "security.credential.kind.ssh": "SSH credential",
  "security.credential.kind.sshPassword": "SSH password",
  "security.credential.kind.sshPrivateKey": "SSH private key",
  "security.credential.meta.entry": "Entry",
  "security.credential.meta.project": "Project",
  "security.credential.meta.purpose": "Purpose",
  "security.credential.title": "Agent requests password book access",
  "security.credential.warning": "Every read requires confirmation.",
  "security.mcpTool.allowOnce": "Allow once",
  "security.mcpTool.allowSession": "Allow for session",
  "security.mcpTool.arguments": "Arguments",
  "security.mcpTool.deny": "Deny",
  "security.mcpTool.denyAccessibility": "Deny this MCP tool call",
  "security.mcpTool.description":
    "The Agent wants to call an external MCP tool. Check the server, tool, and exact arguments before allowing it.",
  "security.mcpTool.hash": "Patch SHA-256",
  "security.mcpTool.project": "Project",
  "security.mcpTool.risk.destructive": "Destructive write",
  "security.mcpTool.risk.read": "Read",
  "security.mcpTool.risk.unknown": "Unknown effect",
  "security.mcpTool.risk.write": "Write",
  "security.mcpTool.server": "Server",
  "security.mcpTool.title": "Approve MCP tool call",
  "security.mcpTool.tool": "Tool",
  "security.mcpTool.warning":
    "MCP does not guarantee that third-party write tools are reversible. BoltPocket binds the exact arguments to this hash and rechecks the tool definition before execution; automatic recovery is available only when the server exposes it.",
} as const satisfies Record<SecurityMessageKey, string>;
