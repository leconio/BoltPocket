import type { BrowserTask } from "./browser-provider";
import { browserDisplayHost } from "@/infrastructure/browser/browser-url";
import type { MessageKey } from "@/i18n/messages";

type TranslateMessage = (key: MessageKey) => string;

function cleanLabel(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 80);
}

function previewName(task: BrowserTask) {
  if (task.source.kind !== "project-preview") return "";
  return cleanLabel(task.source.snapshot.app.title);
}

export function browserTaskTitle(task: BrowserTask, t: TranslateMessage) {
  if (task.source.kind === "project-preview") {
    return previewName(task) || t("browser.task.projectPreview");
  }
  return (
    cleanLabel(task.navigation.title) ||
    (task.navigation.url
      ? browserDisplayHost(task.navigation.url)
      : t("browser.task.blank"))
  );
}

export function browserTaskDetail(task: BrowserTask, t: TranslateMessage) {
  if (task.source.kind === "project-preview") {
    return t("browser.task.localPreview");
  }
  return task.navigation.url
    ? browserDisplayHost(task.navigation.url)
    : t("browser.task.newTab");
}
