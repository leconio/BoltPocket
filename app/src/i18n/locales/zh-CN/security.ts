export const zhCNSecurityMessages = {
  "security.aiConsent.approve": "单独同意并发送",
  "security.aiConsent.category.attachments": "你主动附加的图片或文件",
  "security.aiConsent.category.connectedDocuments":
    "本次任务需要读取的已授权文档内容",
  "security.aiConsent.category.message": "你发送的消息",
  "security.aiConsent.category.projectContext":
    "当前项目的指令、记忆和必要上下文",
  "security.aiConsent.crossBorder.domestic":
    "接收方配置为中国大陆境内处理。你可随时在“关于BoltPocket”中撤回授权。",
  "security.aiConsent.crossBorder.overseas":
    "接收方位于{location}，同意即表示你单独同意本次所列个人信息跨境提供。你可随时撤回。",
  "security.aiConsent.crossBorder.overseasFallback": "中国大陆境外",
  "security.aiConsent.crossBorder.unknown":
    "接收方的数据处理地点尚无法确认，可能发生跨境传输。同意即表示你单独同意按上述目的提供；建议先核对服务商政策。",
  "security.aiConsent.deny": "不同意",
  "security.aiConsent.denyAccessibility": "不同意向第三方 AI 发送数据",
  "security.aiConsent.description":
    "本次 Agent 将使用 {model}。只有你同意后，以下数据才会发送给该服务商处理：",
  "security.aiConsent.failed": "无法保存授权",
  "security.aiConsent.meta.endpoint": "接口",
  "security.aiConsent.meta.filing": "备案/登记",
  "security.aiConsent.meta.model": "模型",
  "security.aiConsent.meta.recipient": "接收方",
  "security.aiConsent.policy":
    "该授权适用于本次及后续使用同一接收方、模型和上述数据类别；接收方、模型、数据类别或政策版本变化时会再次询问。",
  "security.aiConsent.retry": "请稍后重试。",
  "security.aiConsent.title": "发送给第三方 AI 前确认",
  "security.credential.approve": "允许本次",
  "security.credential.deny": "拒绝",
  "security.credential.denyAccessibility": "拒绝本次密码本读取",
  "security.credential.description":
    "允许后，模型将读取这条秘密一次；内容不会显示在对话中。",
  "security.credential.kind.apiHeader": "API 请求头凭据",
  "security.credential.kind.apiToken": "访问令牌",
  "security.credential.kind.bearer": "Bearer 令牌",
  "security.credential.kind.password": "密码",
  "security.credential.kind.secretText": "秘密文本",
  "security.credential.kind.ssh": "SSH 凭据",
  "security.credential.kind.sshPassword": "SSH 密码",
  "security.credential.kind.sshPrivateKey": "SSH 私钥",
  "security.credential.meta.entry": "条目",
  "security.credential.meta.project": "项目",
  "security.credential.meta.purpose": "用途",
  "security.credential.title": "Agent 申请读取密码本",
  "security.credential.warning": "每次读取都需要重新确认。",
  "security.mcpTool.allowOnce": "仅允许本次",
  "security.mcpTool.allowSession": "本会话允许",
  "security.mcpTool.arguments": "参数",
  "security.mcpTool.deny": "拒绝",
  "security.mcpTool.denyAccessibility": "拒绝本次 MCP 工具调用",
  "security.mcpTool.description":
    "Agent 请求调用外部 MCP 工具。批准前请核对服务、工具和精确参数。",
  "security.mcpTool.hash": "补丁 SHA-256",
  "security.mcpTool.project": "项目",
  "security.mcpTool.risk.destructive": "破坏性写入",
  "security.mcpTool.risk.read": "读取",
  "security.mcpTool.risk.unknown": "未知影响",
  "security.mcpTool.risk.write": "写入",
  "security.mcpTool.server": "服务",
  "security.mcpTool.title": "批准 MCP 工具调用",
  "security.mcpTool.tool": "工具",
  "security.mcpTool.warning":
    "MCP 标准不保证第三方写工具可回滚。BoltPocket已绑定精确参数哈希，并会在执行前复查工具定义；只有服务明确提供恢复能力时才可自动恢复。",
} as const;

export type SecurityMessageKey = keyof typeof zhCNSecurityMessages;
