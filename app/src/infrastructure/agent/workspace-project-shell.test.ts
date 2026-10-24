import assert from "node:assert/strict";
import test from "node:test";

import { ProjectShell } from "@boltpocket/project-shell";
import { createProjectShellExtraCommands } from "@boltpocket/project-shell-extras";

import { ResourceReadBudget } from "../../application/resource-read-budget.ts";
import type { WorkspaceResource } from "../../domain/models.ts";
import { createProjectWithWorkspace } from "../../domain/project-workspace.ts";
import {
  projectShellPathForResource,
  WorkspaceProjectShellFileSystem,
} from "./workspace-project-shell.ts";

function resource(
  overrides: Partial<WorkspaceResource> = {},
): WorkspaceResource {
  return {
    id: "notes",
    projectId: "project-a",
    connectionId: "workspace",
    path: "docs/notes.txt",
    content: "第一行\nsecond\n",
    version: "1",
    storage: { kind: "memory" },
    ...overrides,
  };
}

test("maps only current-project WorkspaceResources beneath /project", async () => {
  const included = resource();
  const excluded = resource({
    id: "other-project",
    projectId: "project-b",
    path: "secret.txt",
  });
  const readBudget = new ResourceReadBudget();
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [included, excluded],
    readBudget,
  });

  const shellPath = projectShellPathForResource(included);
  assert.equal(shellPath, "/project/workspace/docs/notes.txt");
  assert.equal(await fileSystem.readFile(shellPath), included.content);
  assert.equal(readBudget.has(included.id), true);
  assert.equal(await fileSystem.stat("/project/workspace/secret.txt"), null);
  assert.deepEqual(await fileSystem.readDirectory("/project/workspace/docs"), [
    { name: "notes.txt", type: "file", size: 17 },
  ]);
});

test("mounts project-owned workspace files directly at the project root", async () => {
  const bundle = createProjectWithWorkspace({
    id: "project-root",
    name: "Root project",
  });
  const agents = bundle.resources.find(
    (resource) => resource.path === "AGENTS.md",
  )!;
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: bundle.project.id,
    resources: bundle.resources,
    readBudget: new ResourceReadBudget(),
  });

  assert.equal(projectShellPathForResource(agents), "/project/AGENTS.md");
  assert.deepEqual(
    (await fileSystem.readDirectory("/project")).map((entry) => entry.name),
    ["AGENTS.md", "MEMORY.md", "NOTES.md", "memory", "skills"],
  );
  assert.equal(await fileSystem.readFile("/project/AGENTS.md"), agents.content);
});

test("rejects traversal and unmapped paths", async () => {
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [resource()],
    readBudget: new ResourceReadBudget(),
  });

  await assert.rejects(fileSystem.stat("/project/../outside"), /禁止路径越界/u);
  await assert.rejects(
    fileSystem.readFile("/project/workspace/docs/missing.txt"),
    /不能读取未授权资源/u,
  );
  await assert.rejects(fileSystem.stat("/outside"), /不在当前项目范围/u);
});

test("base filesystem never writes a WorkspaceResource", async () => {
  const included = resource();
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [included],
    readBudget: new ResourceReadBudget(),
  });

  await assert.rejects(
    fileSystem.writeFile(
      projectShellPathForResource(included),
      "changed outside Diff",
    ),
    /只读快照/u,
  );
  assert.equal(included.content, "第一行\nsecond\n");
});

test("filesystem operations honor cancellation", async () => {
  const included = resource();
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [included],
    readBudget: new ResourceReadBudget(),
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    fileSystem.readFile(
      projectShellPathForResource(included),
      controller.signal,
    ),
    (error: Error) => error.name === "AbortError",
  );
});

test("rejects unsafe source paths before mounting", () => {
  assert.throws(
    () =>
      new WorkspaceProjectShellFileSystem({
        projectId: "project-a",
        resources: [resource({ path: "../secret.txt" })],
        readBudget: new ResourceReadBudget(),
      }),
    /资源路径不安全/u,
  );
});

test("ProjectShell supports substitution but fails closed for unknown commands and traversal", async () => {
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [resource()],
    readBudget: new ResourceReadBudget(),
  });
  const shell = new ProjectShell({ fileSystem, root: "/project" });

  const unknown = await shell.execute({
    command: "not-a-command",
    cwd: "/project",
  });
  assert.notEqual(unknown.exitCode, 0);
  assert.match(unknown.stderr, /not-a-command/u);

  const substitution = await shell.execute({
    command: "echo $(pwd)",
    cwd: "/project",
  });
  assert.equal(substitution.exitCode, 0);
  assert.equal(substitution.stdout, "/project\n");

  const traversal = await shell.execute({
    command: "cat /project/../outside.txt",
    cwd: "/project",
  });
  assert.notEqual(traversal.exitCode, 0);
  assert.equal(traversal.changes.length, 0);
});

test("mobile project shell grants curl no network capability", async () => {
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [resource()],
    readBudget: new ResourceReadBudget(),
  });
  const shell = new ProjectShell({ fileSystem, root: "/project" });

  for (const { command, error } of [
    {
      command: "curl https://example.test/read",
      error: /network|fetch|configured|unavailable/iu,
    },
    {
      command: "curl -X POST https://example.test/mutate",
      error: /fetch|unavailable|requires_fetch/iu,
    },
  ]) {
    const result = await shell.execute({ command, cwd: "/project" });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, error);
    assert.equal(result.changes.length, 0);
  }
});

test("mobile runtime commands interoperate with just-bash inside the project overlay", async () => {
  const yaml = resource({
    id: "config",
    path: "docs/config.yaml",
    content: "value: 1\n",
  });
  const csv = resource({
    id: "people",
    path: "docs/people.csv",
    content: "name,city\nAlice,上海\nBob,北京\n",
  });
  const fileSystem = new WorkspaceProjectShellFileSystem({
    projectId: "project-a",
    resources: [yaml, csv],
    readBudget: new ResourceReadBudget(),
  });
  const shell = new ProjectShell({
    fileSystem,
    root: "/project",
    runtimeCommands: createProjectShellExtraCommands(),
  });

  const yq = await shell.execute({
    command: "yq -i '.value = 2' /project/workspace/docs/config.yaml",
  });
  assert.equal(yq.exitCode, 0, yq.stderr);
  assert.equal(yq.changes[0]?.after, "value: 2\n");

  const xan = await shell.execute({
    command: "xan count /project/workspace/docs/people.csv",
  });
  assert.equal(xan.exitCode, 0, xan.stderr);
  assert.equal(xan.stdout, "2\n");

  const tar = await shell.execute({
    command: [
      "tar -cf /project/archive.tar -C /project/workspace/docs config.yaml",
      "tar -tf /project/archive.tar",
      "rm /project/archive.tar",
    ].join("; "),
  });
  assert.equal(tar.exitCode, 0, tar.stderr);
  assert.equal(tar.stdout, "config.yaml\n");
  assert.deepEqual(tar.changes, []);

  const sqlite = await shell.execute({
    command: "sqlite3 /project/data.db 'SELECT 1'",
  });
  assert.equal(sqlite.exitCode, 127);
  assert.match(sqlite.stderr, /unavailable/u);
});
