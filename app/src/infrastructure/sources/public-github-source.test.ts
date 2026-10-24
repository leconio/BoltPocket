import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ProjectResourceBundle } from "../../application/ports/project-source-snapshots.ts";
import type { Project } from "../../domain/models.ts";
import type { AppLocale } from "../../i18n/translate.ts";
import {
  PublicGitHubSourceAdapter,
  findPublicGitHubRepositoryUrl,
  parsePublicGitHubRepositoryUrl,
  type PublicGitHubSourceHttp,
} from "./public-github-source.ts";
import type {
  ProjectSourceSnapshotDraft,
  ProjectSourceSnapshotStore,
} from "./project-source-snapshot-store.ts";

const project: Project = {
  id: "project-source-test",
  name: "Source test",
  symbol: "S",
  description: "Test imported source snapshots.",
  instructions: "Imported source is read-only.",
  memoryCount: 0,
  skillCount: 0,
  connectionCount: 0,
  resourceCount: 0,
};

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

const digest = {
  text: async (value: string) => {
    assert.doesNotMatch(value, /\0/u);
    return sha256(value);
  },
  bytes: async (value: Uint8Array) => sha256(value),
};

class MemoryStore implements ProjectSourceSnapshotStore {
  draft: ProjectSourceSnapshotDraft | null = null;
  cached: ProjectResourceBundle[] | null = null;
  findKey: string | null = null;
  storedLocale: AppLocale | undefined;

  async load() {
    return this.cached ?? [];
  }

  async find(
    _projectId: string,
    _sourceKind: "github-public",
    sourceKey: string,
    _revision: string,
  ) {
    this.findKey = sourceKey;
    return this.cached;
  }

  async store(draft: ProjectSourceSnapshotDraft, locale?: AppLocale) {
    this.draft = draft;
    this.storedLocale = locale;
    return [];
  }
}

function fixtureHttp(options?: { private?: boolean; status?: number }) {
  const calls: string[] = [];
  let downloads = 0;
  const http: PublicGitHubSourceHttp = {
    async getJson(url) {
      calls.push(url);
      if (options?.status) return { status: options.status, body: {} };
      if (url.endsWith("/commits/main")) {
        return { status: 200, body: { sha: "a".repeat(40) } };
      }
      return {
        status: 200,
        body: {
          full_name: "Example/Fixture",
          private: options?.private ?? false,
          default_branch: "main",
        },
      };
    },
    async download(url) {
      calls.push(url);
      downloads += 1;
      return new Uint8Array([1, 2, 3, 4]);
    },
  };
  return {
    calls,
    get downloads() {
      return downloads;
    },
    http,
  };
}

test("GitHub URL parsing accepts only a public repository homepage shape", () => {
  assert.deepEqual(
    parsePublicGitHubRepositoryUrl("https://github.com/Example/Fixture.git"),
    {
      owner: "Example",
      name: "Fixture",
      repository: "Example/Fixture",
      url: "https://github.com/Example/Fixture",
    },
  );
  assert.equal(
    findPublicGitHubRepositoryUrl(
      "请分析 https://github.com/Example/Fixture。不要修改源码。",
    )?.repository,
    "Example/Fixture",
  );
  assert.throws(
    () =>
      parsePublicGitHubRepositoryUrl(
        "https://github.com/Example/Fixture/blob/main/README.md",
      ),
    /仓库首页/u,
  );
  assert.throws(
    () => parsePublicGitHubRepositoryUrl("http://github.com/a/b"),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      findPublicGitHubRepositoryUrl(
        "https://github.com/Example/One https://github.com/Example/Two",
      ),
    /一个 GitHub/u,
  );
});

test("public GitHub import pins a commit and prepares bounded text resources", async () => {
  const network = fixtureHttp();
  const store = new MemoryStore();
  const progress: string[] = [];
  const adapter = new PublicGitHubSourceAdapter({
    http: network.http,
    digest,
    store,
    now: () => new Date("2026-08-04T08:00:00.000Z"),
    extractArchive: () => [
      {
        name: "Example-Fixture-a/README.md",
        data: new TextEncoder().encode("# Fixture\n"),
      },
      {
        name: "Example-Fixture-a/src/index.ts",
        data: new TextEncoder().encode("export const value = 1;\n"),
      },
      {
        name: "Example-Fixture-a/image.bin",
        data: new Uint8Array([0xff, 0xfe, 0xfd]),
      },
    ],
  });

  const result = await adapter.import({
    project,
    url: "https://github.com/Example/Fixture",
    locale: "en",
    onProgress: (value) => progress.push(value),
  });

  assert.equal(result.sourceKind, "github-public");
  assert.equal(result.sourceLabel, "Example/Fixture");
  assert.equal(result.revision, "a".repeat(40));
  assert.equal(result.versionLabel, "main@aaaaaaaaaaaa");
  assert.equal(result.cached, false);
  assert.deepEqual(progress, ["inspect", "acquire", "extract", "store"]);
  assert.deepEqual(network.calls, [
    "https://api.github.com/repos/Example/Fixture",
    "https://api.github.com/repos/Example/Fixture/commits/main",
    `https://api.github.com/repos/Example/Fixture/zipball/${"a".repeat(40)}`,
  ]);
  assert.ok(store.draft);
  assert.equal(store.draft.sourceKind, "github-public");
  assert.equal(store.draft.sourceKey, "https://github.com/example/fixture");
  assert.equal(store.draft.sourceLabel, "Example/Fixture");
  assert.equal(store.draft.mountPath, "Example/Fixture");
  assert.equal(store.draft.contentSha256, sha256(new Uint8Array([1, 2, 3, 4])));
  assert.equal(store.draft.reportPath, "reports/Example-Fixture-analysis.md");
  assert.equal(store.storedLocale, "en");
  assert.equal(
    new Set(store.draft.files.map((file) => file.id)).size,
    store.draft.files.length,
  );
  assert.deepEqual(
    store.draft.files.map((file) => file.path),
    ["README.md", "src/index.ts", `.boltpocket-source-${"a".repeat(12)}.md`],
  );
  assert.match(
    store.draft.files.at(-1)?.content ?? "",
    /read-only project source snapshot/u,
  );
  assert.match(
    store.draft.files.at(-1)?.content ?? "",
    /Skipped binary files: 1/u,
  );
  assert.doesNotMatch(
    store.draft.files.at(-1)?.content ?? "",
    /[\u3400-\u9fff]/u,
  );
});

test("matching commit uses the project cache without downloading an archive", async () => {
  const network = fixtureHttp();
  const store = new MemoryStore();
  store.cached = [
    {
      connection: {
        id: "cached",
        projectId: project.id,
        name: "cached",
        account: "Example/Fixture",
        scope: "main",
        status: "connected",
        resourceCount: 0,
        access: "persistent",
        writeMode: "read-only",
      },
      resources: [],
    },
  ];
  const adapter = new PublicGitHubSourceAdapter({
    http: network.http,
    digest,
    store,
  });
  const result = await adapter.import({
    project,
    url: "https://github.com/Example/Fixture",
  });
  assert.equal(result.cached, true);
  assert.equal(network.downloads, 0);
  assert.equal(store.draft, null);
});

test("private or missing repositories fail before archive download", async () => {
  for (const options of [{ private: true }, { status: 404 }]) {
    const network = fixtureHttp(options);
    const adapter = new PublicGitHubSourceAdapter({
      http: network.http,
      digest,
      store: new MemoryStore(),
    });
    await assert.rejects(
      adapter.import({
        project,
        url: "https://github.com/Example/Fixture",
      }),
      /公共|不存在/u,
    );
    assert.equal(network.downloads, 0);
  }
});
