export const zhCNCommonMessages = {
  "common.brand.name": "BoltPocket",
  "common.markdown.imageAlt": "[图片：{alt}]",
  "common.markdown.linkOpenFailed": "无法打开链接",
  "common.markdown.linkUnavailable": "这个链接无法打开。",
  "common.markdown.unnamedImage": "未命名图片",
  "common.markdown.unsafeLink":
    "Markdown 只允许打开不含凭据的 HTTP 或 HTTPS 链接。",
  "common.navigation.back": "返回",
  "common.sheet.close": "关闭",
  "common.swipeDelete.action": "删除",
  "common.swipeDelete.accessibility": "删除对话 {label}",
} as const;

export type CommonMessageKey = keyof typeof zhCNCommonMessages;
