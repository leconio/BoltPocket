import type { CommonMessageKey } from "../zh-CN/common.ts";

export const enCommonMessages = {
  "common.brand.name": "BoltPocket",
  "common.markdown.imageAlt": "[Image: {alt}]",
  "common.markdown.linkOpenFailed": "Could not open link",
  "common.markdown.linkUnavailable": "This link could not be opened.",
  "common.markdown.unnamedImage": "Untitled image",
  "common.markdown.unsafeLink":
    "Markdown links must use HTTP or HTTPS and cannot contain credentials.",
  "common.navigation.back": "Back",
  "common.sheet.close": "Close",
  "common.swipeDelete.action": "Delete",
  "common.swipeDelete.accessibility": "Delete conversation {label}",
} as const satisfies Record<CommonMessageKey, string>;
