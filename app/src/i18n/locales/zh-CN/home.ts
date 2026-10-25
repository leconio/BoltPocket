export const zhCNHomeMessages = {
  "home.drawer.browser": "浏览器",
  "home.drawer.collapse": "收起侧边栏",
  "home.drawer.memory": "记忆",
  "home.drawer.mcp": "MCP",
  "home.drawer.newConversation": "新建对话",
  "home.drawer.settings": "设置",
  "home.drawer.skills": "Skills",
  "home.conversations.all": "所有会话",
  "home.conversations.delete.cancel": "取消",
  "home.conversations.delete.confirmIdle":
    "“{title}”及其审查记录会从本机删除，项目文件不会回滚。",
  "home.conversations.delete.confirmRunning":
    "“{title}”仍在运行。删除会停止任务，并移除这段对话的审查记录。",
  "home.conversations.delete.couldNot": "无法删除",
  "home.conversations.delete.delete": "删除",
  "home.conversations.delete.retry": "请稍后重试。",
  "home.conversations.delete.title": "删除对话？",
  "home.conversations.empty": "还没有会话",
  "home.conversations.new": "新对话",
  "home.conversations.open": "打开会话 {title}",
  "home.conversations.openRunning": "打开会话 {title}，正在运行",
  "home.conversations.project": "{project} · 对话",
  "home.conversations.quick": "快速对话",
  "home.screen.allProjects": "查看全部项目",
  "home.screen.newProject": "新建项目",
  "home.screen.openDrawer": "打开侧边栏",
  "home.screen.openProject": "打开项目 {name}",
  "home.screen.pinnedProjects": "置顶项目",
  "home.screen.recentProjects": "项目",
} as const;

export type HomeMessageKey = keyof typeof zhCNHomeMessages;
