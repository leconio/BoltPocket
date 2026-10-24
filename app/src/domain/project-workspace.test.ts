import assert from "node:assert/strict";
import test from "node:test";

import { appReducer, initialAppState } from "./app-state.ts";
import {
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
  isProjectWorkspaceResource,
  isSafeProjectWorkspacePath,
  projectWorkspaceConnectionId,
} from "./project-workspace.ts";

test("a new project gets a complete private workspace template", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-new",
    name: "  新产品   调研  ",
  });

  assert.equal(bundle.project.name, "新产品 调研");
  assert.equal(bundle.project.symbol, "新产");
  assert.equal(
    bundle.connection.id,
    projectWorkspaceConnectionId(bundle.project.id),
  );
  assert.deepEqual(bundle.resources.map((resource) => resource.path).sort(), [
    "AGENTS.md",
    "MEMORY.md",
    "NOTES.md",
    "memory/EVIDENCE.md",
    "memory/RECENT.md",
    "memory/SUMMARIES.md",
    "skills/project-work/SKILL.md",
  ]);
  assert.equal(bundle.resources.every(isProjectWorkspaceResource), true);
  assert.equal(
    bundle.resources.some((resource) => resource.path === "index.html"),
    false,
  );
  const h5Entry = createProjectWorkspaceFileResource({
    projectId: bundle.project.id,
    path: "index.html",
    content: "<!doctype html>\n",
  });
  assert.equal(h5Entry.path, "index.html");
  assert.equal(h5Entry.connectionId, bundle.connection.id);
  assert.equal(isProjectWorkspaceResource(h5Entry), true);
  assert.equal(
    bundle.resources.some((resource) =>
      /password|private key|api[_ -]?key/iu.test(resource.content),
    ),
    false,
  );
});

test("an English project gets English-owned workspace copy", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-english",
    locale: "en",
    name: "Research",
  });
  assert.match(bundle.project.instructions, /Work only within/u);
  assert.equal(bundle.connection.name, "Project workspace");
  assert.match(
    bundle.resources.find((resource) => resource.path === "AGENTS.md")!.content,
    /# Project instructions/u,
  );
  assert.match(
    bundle.resources.find(
      (resource) => resource.path === "skills/project-work/SKILL.md",
    )!.content,
    /# Project work/u,
  );
});

test("project creation is atomic and rejects malformed workspace bundles", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-atomic",
    name: "Atomic project",
  });
  const created = appReducer(initialAppState, {
    type: "project/created",
    ...bundle,
  });

  assert.equal(created.projects[bundle.project.id], bundle.project);
  assert.equal(
    created.connections[bundle.connection.id]?.resourceCount,
    bundle.resources.length,
  );
  assert.equal(
    bundle.resources.every(
      (resource) => created.resources[resource.id] === resource,
    ),
    true,
  );

  const incomplete = appReducer(initialAppState, {
    type: "project/created",
    project: bundle.project,
    connection: {
      ...bundle.connection,
      resourceCount: bundle.resources.length - 1,
    },
    resources: bundle.resources.slice(1),
  });
  assert.equal(incomplete, initialAppState);
});

test("project template validation rejects unsafe identifiers and names", () => {
  assert.throws(
    () => createProjectWithWorkspace({ id: "../escape", name: "Project" }),
    /项目 ID/u,
  );
  assert.throws(
    () => createProjectWithWorkspace({ id: "project-empty", name: "   " }),
    /项目名称/u,
  );
  assert.equal(isSafeProjectWorkspacePath("memory/RECENT.md"), true);
  assert.equal(isSafeProjectWorkspacePath("../MEMORY.md"), false);
  assert.equal(isSafeProjectWorkspacePath("/MEMORY.md"), false);
  assert.equal(isSafeProjectWorkspacePath("outputs/report/index.html"), true);
  assert.equal(isSafeProjectWorkspacePath("apps/snake/index.html"), true);
});

test("project creation rejects a workspace template with an unsafe path", () => {
  const bundle = createProjectWithWorkspace({
    id: "project-unsafe-path",
    name: "Unsafe path",
  });
  const resources = bundle.resources.map((resource, index) =>
    index === 0 ? { ...resource, path: "../AGENTS.md" } : resource,
  );

  assert.equal(
    appReducer(initialAppState, {
      type: "project/created",
      project: bundle.project,
      connection: bundle.connection,
      resources,
    }),
    initialAppState,
  );
});
