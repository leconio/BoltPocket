import type { AppAction } from "@/domain/app-state";

export function shouldPersistAppAction(action: AppAction) {
  switch (action.type) {
    case "state/restore":
    case "state/hydration-complete":
    case "storage/fail":
    case "storage/ready":
    case "chat/new":
    case "chat/new-project":
    case "chat/open-project":
    case "chat/open-conversation":
    case "project/opened":
    case "draft/change":
    case "attachment/add":
    case "attachment/remove":
    case "attachment/clear":
    case "run/status":
    case "run/capacity-rejected":
    case "run/rejected":
    case "proposal/auto-apply-start":
    case "proposal/auto-apply-failed":
    case "connection/upsert":
    case "resources/refreshed":
      return false;
    default:
      return true;
  }
}
