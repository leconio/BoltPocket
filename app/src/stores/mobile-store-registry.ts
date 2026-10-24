import { createApprovalStore, type ApprovalStore } from "./approval-store";
import { createAppStateStore, type AppStateStore } from "./app-state-store";
import { createSessionStore, type SessionStore } from "./session-store";

export type MobileStoreRegistry = Readonly<{
  app: AppStateStore;
  approval: ApprovalStore;
  session: SessionStore;
}>;

export function createMobileStoreRegistry(): MobileStoreRegistry {
  return Object.freeze({
    app: createAppStateStore(),
    approval: createApprovalStore(),
    session: createSessionStore(),
  });
}
