export const zhCNConnectionMessages = {
  "connections.catalog.add": "添加连接",
  "connections.catalog.connecting": "连接中",
  "connections.catalog.device.detail": "选择一个文本文件夹",
  "connections.catalog.device.failed": "设备文件连接失败，请重试。",
  "connections.catalog.device.title": "设备文件",
  "connections.catalog.failed": "无法连接",
  "connections.mcp.add": "添加 MCP 连接",
  "connections.mcp.addApiKeyHeader": "添加 Header",
  "connections.mcp.advanced": "高级设置",
  "connections.mcp.authNewToken": "输入新 Token",
  "connections.mcp.authNone": "无需认证",
  "connections.mcp.apiKeyHeaderNumber": "API Key Header {number}",
  "connections.mcp.allowList": "允许的工具（可选）",
  "connections.mcp.allowListDetail":
    "每行一个精确工具名。留空允许目录中的全部工具；不匹配的工具会在本机直接阻止。",
  "connections.mcp.approvePatterns": "额外审批规则（approveTools）",
  "connections.mcp.approvePatternsDetail":
    "每行一个 glob，例如 search_* 或 server-id/tool。写工具无需列出，也一定会审批。",
  "connections.mcp.cancel": "取消",
  "connections.mcp.connected": "MCP 连接成功",
  "connections.mcp.connectedDetail":
    "已发现 {count} 个工具；目录会在需要时懒加载。",
  "connections.mcp.connectAndTest": "连接并测试",
  "connections.mcp.disableService": "停用 {name}",
  "connections.mcp.disabledValue": "已停用",
  "connections.mcp.done": "完成",
  "connections.mcp.edit": "编辑 MCP 连接",
  "connections.mcp.enableService": "启用 {name}",
  "connections.mcp.enabled": "启用此 MCP 服务",
  "connections.mcp.enabledDetail": "关闭后 Agent 不会看到或连接此 MCP 服务。",
  "connections.mcp.enabledValue": "已启用",
  "connections.mcp.headerName": "Header 名称",
  "connections.mcp.headerNameDetail":
    "除非服务商明确提供了其他 Header 名称，否则保持默认值即可。",
  "connections.mcp.headerNameDuplicate": "Header 名称不能重复。",
  "connections.mcp.headerNameInvalid": "请填写有效的 Header 名称。",
  "connections.mcp.invalidResult": "MCP 服务返回了无效结果。",
  "connections.mcp.loading": "正在读取 MCP 连接",
  "connections.mcp.nameOptional": "显示名称（可选，默认自动生成）",
  "connections.mcp.nameOptionalDetail": "留空即可根据 MCP 地址自动生成名称。",
  "connections.mcp.newTokenDetail": "仅保存在本机密码本。",
  "connections.mcp.noneChoiceDetail": "仅用于公开 MCP 服务",
  "connections.mcp.policyAskAll": "每次询问",
  "connections.mcp.policyAskAllDetail": "所有工具调用都会先显示审批页。",
  "connections.mcp.policyCustom": "自定义",
  "connections.mcp.policyCustomDetail":
    "按工具名限制目录，或为指定工具增加审批规则。",
  "connections.mcp.policyStandard": "标准防护",
  "connections.mcp.policyStandardDetail":
    "采用服务的只读标记；读取直接执行，写入、删除和影响未知的操作仍会审批。",
  "connections.mcp.remove": "移除 MCP 连接",
  "connections.mcp.removeApiKeyHeader": "删除这个 Header",
  "connections.mcp.removeDetail":
    "将移除连接元数据并关闭会话。引用的密码本 Token 不会删除，仍可在密码本中管理。",
  "connections.mcp.removeFailed": "无法移除 MCP 连接",
  "connections.mcp.removeFailedDetail": "请稍后重试。",
  "connections.mcp.saveFailed": "无法保存 MCP 连接",
  "connections.mcp.saveFailedDetail":
    "请确认粘贴的是服务商提供的 MCP 地址；如果服务不支持 OAuth，可选择 Token 或无需认证。",
  "connections.mcp.savedNeedsAttention": "连接已保存，但需要处理",
  "connections.mcp.savedNeedsAttentionDetail": "测试失败：{error}",
  "connections.mcp.savedDisabled": "连接已保存",
  "connections.mcp.savedDisabledDetail":
    "该 MCP 连接当前处于停用状态，未发起网络测试。",
  "connections.mcp.savedToken": "使用已保存 Token",
  "connections.mcp.savedTokenUnavailable":
    "已保存的 Token 不完整，请重新选择或输入。",
  "connections.mcp.queryTokenDetail":
    "此服务按官方要求把密钥作为 {parameter} 参数发送；保存的 MCP 地址不包含密钥。",
  "connections.mcp.signIn": "身份验证",
  "connections.mcp.standardSafetyDetail": "读取直接执行；写入和删除会先询问。",
  "connections.mcp.testing": "正在保存并发现工具…",
  "connections.mcp.token": "Token",
  "connections.mcp.tokenChoice": "Token / API Key",
  "connections.mcp.tokenChoiceDetail": "使用密码本或输入一次",
  "connections.mcp.tokenOriginMismatch":
    "所选 Token 的密码本服务地址必须与 MCP 地址同源。",
  "connections.mcp.tokenRequired": "请输入 Token。",
  "connections.mcp.tokenPlaceholder": "粘贴 Token",
  "connections.mcp.toolPolicy": "工具权限",
  "connections.mcp.trustAnnotations": "信任工具 annotation",
  "connections.mcp.trustAnnotationsDetail":
    "仅对你信任的服务开启。开启后，明确标为只读的工具可直接调用；服务端 annotation 仍不能绕过 allow-list 或 approveTools。",
  "connections.mcp.unavailable": "MCP 连接不可用",
  "connections.mcp.unavailableDetail": "这个 MCP 连接不存在，请返回后重试。",
  "connections.mcp.regionUnavailableDetail":
    "当前发行版本不提供第三方 MCP。已有连接仍保存在本机，可继续删除，但不会连接或调用。",
  "connections.mcp.regionStoredDetail":
    "仅保存在本机，当前版本已停用 · 点击删除",
  "connections.mcp.url": "MCP 地址",
  "connections.mcp.urlDetail":
    "填写服务商提供的 Streamable HTTP 地址，不是官网；公网必须使用 HTTPS，局域网可使用 HTTP；不支持 stdio、旧版 SSE 或 WebSocket。",
  "connections.mcp.hub.add": "添加 MCP 服务",
  "connections.mcp.hub.addCompact": "添加",
  "connections.mcp.hub.auth.none": "无需登录",
  "connections.mcp.hub.auth.oauth": "旧版授权",
  "connections.mcp.hub.auth.token": "密码本 Token",
  "connections.mcp.hub.emptyDetail":
    "还没有全局 MCP 服务。添加后可在所有项目和快速对话中使用。",
  "connections.mcp.hub.globalServices": "全局服务",
  "connections.mcp.hub.projectServices": "当前项目",
  "connections.mcp.hub.needsAssignment": "待分配项目",
  "connections.mcp.hub.unassignedBadge": "未分配",
  "connections.mcp.hub.unassignedDetail":
    "{host} · 打开后可将这个旧连接分配给当前项目",
} as const;

export type ConnectionMessageKey = keyof typeof zhCNConnectionMessages;
