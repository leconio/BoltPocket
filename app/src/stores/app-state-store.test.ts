import assert from "node:assert/strict";
import test from "node:test";

import { initialAppState } from "@/domain/app-state";

import {
  createAppStateFieldsSelector,
  createAppStateSelection,
  createAppStateStore,
  replaceAppState,
} from "./app-state-store.ts";
import { createMobileStoreRegistry } from "./mobile-store-registry.ts";

test("a durable action replaces AppState atomically and publishes once", () => {
  const store = createAppStateStore(initialAppState);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  const next = { ...initialAppState, draft: "hello" };

  assert.equal(replaceAppState(store, next), true);
  assert.equal(store.getState(), next);
  assert.equal(notifications, 1);
  assert.equal(replaceAppState(store, next), false);
  assert.equal(notifications, 1);
  unsubscribe();
});

test("a field-bounded selector retains identity across unrelated actions", () => {
  const store = createAppStateStore(initialAppState);
  const selectProjects = createAppStateFieldsSelector("projects");
  const selection = createAppStateSelection(store, selectProjects, Object.is);
  const initialSelection = selection.getSnapshot();

  replaceAppState(store, { ...store.getState(), draft: "unrelated" });
  assert.equal(selection.getSnapshot(), initialSelection);

  const projects = {
    ...store.getState().projects,
    project: {
      id: "project",
      name: "Project",
      symbol: "P",
      description: "",
      instructions: "",
      memoryCount: 0,
      skillCount: 0,
      connectionCount: 0,
      resourceCount: 0,
    },
  };
  replaceAppState(store, { ...store.getState(), projects });
  assert.notEqual(selection.getSnapshot(), initialSelection);
  assert.equal(selection.getSnapshot().projects, projects);
});

test("session metadata does not publish through the durable app store", () => {
  const registry = createMobileStoreRegistry();
  let appNotifications = 0;
  let sessionNotifications = 0;
  const unsubscribeApp = registry.app.subscribe(() => {
    appNotifications += 1;
  });
  const unsubscribeSession = registry.session.subscribe(() => {
    sessionNotifications += 1;
  });

  registry.session.setState({ downloadedSkillsLoading: false });

  assert.equal(appNotifications, 0);
  assert.equal(sessionNotifications, 1);
  unsubscribeApp();
  unsubscribeSession();
});
