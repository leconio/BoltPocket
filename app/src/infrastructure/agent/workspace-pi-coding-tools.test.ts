import assert from "node:assert/strict";
import test from "node:test";

import { ResourceReadBudget } from "../../application/resource-read-budget.ts";
import type { WorkspaceResource } from "../../domain/models.ts";
import { builtInProjectResourceFile } from "../../domain/builtin-project-resources.ts";
import {
  createProjectWithWorkspace,
  createProjectWorkspaceFileResource,
} from "../../domain/project-workspace.ts";
import { WorkspacePiCodingTools } from "./workspace-pi-coding-tools.ts";

function resource(
  id: string,
  path: string,
  content: string,
): WorkspaceResource {
  return {
    id,
    projectId: "project-a",
    connectionId: "workspace",
    path,
    content,
    version: "v1",
    storage: { kind: "memory" },
  };
}

function environment(resources: WorkspaceResource[]) {
  const refreshed: string[] = [];
  const tools = new WorkspacePiCodingTools({
    projectId: "project-a",
    resources,
    readBudget: new ResourceReadBudget({
      maxResources: 100,
      maxCharacters: 1_000_000,
    }),
    refreshResource: async (candidate) => {
      refreshed.push(candidate.id);
      return { ...candidate, version: "v2" };
    },
  });
  return { tools, refreshed };
}

test("upstream operations share one staged overlay without writing source resources", async () => {
  const source = resource("notes", "docs/notes.md", "before\n");
  const { tools, refreshed } = environment([source]);
  const path = "/project/workspace/docs/notes.md";

  assert.equal((await tools.readFileBuffer(path)).toString("utf8"), "before\n");
  await tools.writeFile(path, "after\n");
  assert.equal(await tools.readFile(path), "after\n");
  assert.deepEqual(refreshed, ["notes"]);
  assert.equal(source.content, "before\n");
  assert.deepEqual(tools.stagedChanges(), [
    {
      operation: "modify",
      path,
      resource: { ...source, version: "v2" },
      before: "before\n",
      after: "after\n",
    },
  ]);

  await assert.rejects(
    tools.writeFile("/project/workspace/docs/new.md", "new\n"),
    /no writable project workspace/iu,
  );
});

test("upstream write creates project-owned files visible to later tools and preview", async () => {
  const bundle = createProjectWithWorkspace({
    id: "project-a",
    name: "Writable project",
  });
  const { tools } = environment(bundle.resources);
  const html =
    '<!doctype html><meta name="viewport" content="width=device-width"><canvas id="game"></canvas>\n';

  await tools.mkdirExisting("/project/game");
  await tools.writeFile("/project/game/index.html", html);
  await tools.writeFile(
    "/project/game/index.html",
    html.replace("</canvas>", "</canvas><button>重开</button>"),
  );

  assert.match(await tools.readFile("/project/game/index.html"), /重开/u);
  assert.equal(await tools.exists("/project/game/index.html"), true);
  assert.deepEqual(
    (await tools.previewFiles("/project/game/index.html")).map(
      (file) => file.path,
    ),
    ["/project/game/index.html"],
  );
  const created = tools
    .stagedChanges()
    .find((change) => change.path === "/project/game/index.html");
  assert.equal(created?.operation, "create");
  assert.equal(created?.before, "");
  assert.match(created?.after ?? "", /重开/u);
  assert.equal(created?.resource.storage.kind, "project-workspace");
});

test("copies a bundled binary into the real project tree and exposes it to tools and preview", async () => {
  const bundle = createProjectWithWorkspace({
    id: "project-a",
    name: "Portable H5 project",
  });
  const { tools } = environment(bundle.resources);
  const descriptor = builtInProjectResourceFile(
    "kenney-ui",
    "png/blue/arrow_basic_e_small.png",
  );
  assert.ok(descriptor);
  const path =
    "/project/apps/game/assets/vendor/kenney-ui/png/blue/arrow_basic_e_small.png";

  await tools.mkdirExisting("/project/apps/game");
  await tools.writeFile(
    "/project/apps/game/index.html",
    '<!doctype html><img src="./assets/vendor/kenney-ui/png/blue/arrow_basic_e_small.png">\n',
  );
  const [status] = await tools.stageBuiltInResourceCopies([
    {
      path,
      packId: "kenney-ui",
      sourcePath: descriptor.path,
      mimeType: descriptor.mimeType,
      byteLength: descriptor.byteLength,
      sha256: descriptor.sha256,
      contentBase64: Buffer.alloc(descriptor.byteLength).toString("base64"),
    },
  ]);

  assert.equal(status, "copied");
  assert.equal(await tools.exists(path), true);
  assert.equal((await tools.stat(path))?.size, descriptor.byteLength);
  assert.match(await tools.readFile(path), /binary project file/u);
  const previewFile = (
    await tools.previewFiles("/project/apps/game/index.html")
  ).find((file) => file.path === path);
  assert.equal(previewFile?.encoding, "base64");
  assert.equal(previewFile?.byteLength, descriptor.byteLength);
  const staged = tools.stagedChanges().find((change) => change.path === path);
  assert.equal(staged?.operation, "copy");
  assert.equal(staged?.resource.storage.kind, "project-workspace");
  assert.equal(
    staged?.resource.storage.kind === "project-workspace"
      ? staged.resource.storage.binary?.source.kind === "builtin-h5-resource"
        ? staged.resource.storage.binary.source.packId
        : undefined
      : undefined,
    "kenney-ui",
  );
});

test("ordinary output directories participate in the staged workspace overlay", async () => {
  const bundle = createProjectWithWorkspace({
    id: "project-a",
    name: "Project outputs",
  });
  const existingFile = createProjectWorkspaceFileResource({
    projectId: "project-a",
    path: "outputs/report/index.html",
    content: "<title>Before</title>\n",
  });
  const { tools } = environment([...bundle.resources, existingFile]);

  assert.equal(
    await tools.readFile("/project/outputs/report/index.html"),
    "<title>Before</title>\n",
  );
  await tools.writeFile(
    "/project/outputs/report/index.html",
    "<title>Changed</title>\n",
  );
  await tools.writeFile("/project/outputs/summary.md", "# Summary\n");
  assert.equal(tools.stagedChanges().length, 2);
  assert.equal(
    await tools.readFile("/project/outputs/report/index.html"),
    "<title>Changed</title>\n",
  );
});

test("find and grep adapters honor upstream glob limits and project gitignore", async () => {
  const { tools } = environment([
    resource("ignore", ".gitignore", "ignored.md\n"),
    resource("keep", "keep.md", "needle keep\n"),
    resource("ignored", "ignored.md", "needle ignored\n"),
    resource("code", "src/example.ts", "const needle = true;\n"),
  ]);
  const root = "/project/workspace";

  assert.deepEqual(
    await tools.glob("*.md", root, {
      ignore: ["**/node_modules/**", "**/.git/**"],
      limit: 100,
    }),
    ["/project/workspace/keep.md"],
  );

  const grep = await tools.grep({
    pattern: "needle",
    path: root,
    ignoreCase: false,
    literal: true,
    limit: 100,
  });
  assert.deepEqual(
    grep.matches.map((match) => [match.filePath, match.lineNumber]),
    [
      ["/project/workspace/keep.md", 1],
      ["/project/workspace/src/example.ts", 1],
    ],
  );

  const limited = await tools.grep({
    pattern: "needle",
    path: root,
    ignoreCase: false,
    literal: true,
    limit: 1,
  });
  assert.equal(limited.matches.length, 1);
  assert.equal(limited.limitReached, true);
});

test("rejected shell batches restore earlier overlay writes", async () => {
  const source = resource("notes", "docs/notes.md", "before\n");
  const { tools } = environment([source]);
  const path = "/project/workspace/docs/notes.md";

  await tools.refreshAll();
  await assert.rejects(
    tools.applyShellChanges([
      {
        kind: "modified",
        path,
        before: "before\n",
        after: "after\n",
      },
      {
        kind: "created",
        path: "/project/workspace/docs/new.md",
        before: null,
        after: "new\n",
      },
    ]),
    /no writable project workspace/iu,
  );
  assert.equal(await tools.readFile(path), "before\n");
  assert.deepEqual(tools.stagedChanges(), []);
});

test("H5 preview reads the current staged Snake project overlay", async () => {
  const { tools, refreshed } = environment([
    resource("snake-index", "game/index.html", "<canvas></canvas>\n"),
    resource("snake-code", "game/game.js", "const speed = 180;\n"),
    resource("snake-style", "game/style.css", "canvas { width: 100%; }\n"),
    resource("snake-secret", "game/.env", "TOKEN=private\n"),
    resource("snake-memory", "game/MEMORY.md", "private memory\n"),
    resource("other", "notes.txt", "outside\n"),
  ]);
  const entryPath = "/project/workspace/game/index.html";
  const scriptPath = "/project/workspace/game/game.js";

  await tools.writeFile(scriptPath, "const speed = 120;\n");
  const files = await tools.previewFiles(entryPath);

  assert.deepEqual(
    files.map((file) => file.path),
    [
      "/project/workspace/game/game.js",
      "/project/workspace/game/index.html",
      "/project/workspace/game/style.css",
    ],
  );
  assert.equal(
    files.find((file) => file.path === scriptPath)?.content,
    "const speed = 120;\n",
  );
  assert.equal(refreshed.includes("snake-secret"), false);
  assert.equal(refreshed.includes("snake-memory"), false);
});

test("imported public source loads lazily and remains read-only", async () => {
  const source: WorkspaceResource = {
    ...resource("source-index", "Example/Fixture/src/index.ts", ""),
    connectionId: "github-source-fixture",
    version: "source-v1",
    storage: {
      kind: "source-file",
      locator: "memory://source-index",
      snapshotId: "snapshot-fixture",
      sourceKind: "github-public",
      sourceLabel: "Example/Fixture",
      mountPath: "Example/Fixture",
      revision: "a".repeat(40),
      versionLabel: "main@aaaaaaaaaaaa",
      manifestPath: ".boltpocket-source-aaaaaaaaaaaa.md",
      access: "persistent",
    },
  };
  const tools = new WorkspacePiCodingTools({
    projectId: "project-a",
    resources: [source],
    readBudget: new ResourceReadBudget({
      maxResources: 10,
      maxCharacters: 100_000,
    }),
    refreshResource: async (candidate) => ({
      ...candidate,
      content: "export const source = true;\n",
    }),
  });
  const path = "/project/github-source-fixture/Example/Fixture/src/index.ts";

  assert.equal(await tools.readFile(path), "export const source = true;\n");
  await assert.rejects(
    tools.writeFile(path, "export const source = false;\n"),
    /read-only/iu,
  );
  await assert.rejects(
    tools.applyShellChanges([
      {
        kind: "modified",
        path,
        before: "export const source = true;\n",
        after: "export const source = false;\n",
      },
    ]),
    /read-only/iu,
  );
  assert.deepEqual(tools.stagedChanges(), []);
});
