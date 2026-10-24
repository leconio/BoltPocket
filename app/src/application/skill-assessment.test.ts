import assert from "node:assert/strict";
import test from "node:test";

import type {
  OpenSkillProvenance,
  SkillCapability,
} from "@/application/ports/capability-catalog";
import { assessSkillCapability } from "./skill-assessment.ts";

function capability(
  requirements: SkillCapability["requirements"],
  skillDocument = [
    "---",
    "name: review",
    'title: "Review"',
    'description: "Review a project."',
    "risk: propose",
    "---",
    "",
    "# Review",
    "",
  ].join("\n"),
  supportingFiles: readonly Readonly<{ content: string; path: string }>[] = [],
): SkillCapability {
  const files = [
    {
      byteLength: new TextEncoder().encode(skillDocument).byteLength,
      content: skillDocument,
      encoding: "utf8" as const,
      executable: false,
      mimeType: "text/markdown",
      path: "SKILL.md",
      sha256: "a".repeat(64),
    },
    ...supportingFiles.map((file) => ({
      byteLength: new TextEncoder().encode(file.content).byteLength,
      content: file.content,
      encoding: "utf8" as const,
      executable: false,
      mimeType: "text/plain",
      path: file.path,
      sha256: "c".repeat(64),
    })),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    bundle: {
      complete: true,
      files,
      sha256: "b".repeat(64),
      totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
    },
    id: "review",
    kind: "skill",
    name: { en: "Review", zhCN: "审查" },
    provider: { en: "BoltPocket", zhCN: "BoltPocket" },
    description: { en: "Review", zhCN: "审查" },
    documentationUrl: "https://example.com/review",
    revision: "1",
    risk: "propose",
    sha256: "a".repeat(64),
    skillDocument,
    requirements,
    source: {
      entryId: "review",
      id: "boltpocket",
      kind: "boltpocket",
      name: "BoltPocket",
    },
  };
}

test("Skill assessment distinguishes full, partial, and unsupported", () => {
  assert.equal(
    assessSkillCapability({
      capability: capability([
        {
          id: "project_context_read",
          kind: "host-tool",
          label: { en: "Context", zhCN: "上下文" },
          required: true,
        },
      ]),
      connectedMcpServerUrls: [],
      locale: "en",
    }).status,
    "full",
  );
  assert.equal(
    assessSkillCapability({
      capability: capability([
        {
          id: "github",
          kind: "mcp-server",
          label: { en: "GitHub", zhCN: "GitHub" },
          required: true,
          serverUrl: "https://api.githubcopilot.com/mcp/",
        },
      ]),
      connectedMcpServerUrls: [],
      locale: "en",
    }).status,
    "partial",
  );
  assert.equal(
    assessSkillCapability({
      capability: capability([
        {
          id: "github",
          kind: "mcp-server",
          label: { en: "GitHub", zhCN: "GitHub" },
          required: true,
          serverUrl: "https://api.githubcopilot.com/mcp/",
        },
      ]),
      connectedMcpServerUrls: ["https://api.githubcopilot.com/mcp/"],
      locale: "en",
    }).status,
    "full",
  );
  assert.equal(
    assessSkillCapability({
      capability: capability([], "# Missing frontmatter"),
      connectedMcpServerUrls: [],
      locale: "en",
    }).status,
    "unsupported",
  );
  assert.equal(
    assessSkillCapability({
      capability: { ...capability([]), risk: "read" },
      connectedMcpServerUrls: [],
      locale: "en",
    }).status,
    "unsupported",
  );
});

test("open Skill provenance blocks unsafe sources and rejects an incomplete package", () => {
  const provenance: OpenSkillProvenance = {
    archived: false,
    audit: "pass",
    commitSha: "a".repeat(40),
    compatibility: null,
    installs: 12,
    kind: "skills-sh",
    license: "MIT",
    repositoryUrl: "https://github.com/example/review",
    sourceId: "example/review/review",
    supportingFileCount: 0,
  };
  const assess = (overrides: Partial<typeof provenance>) =>
    assessSkillCapability({
      capability: {
        ...capability([]),
        provenance: { ...provenance, ...overrides },
      },
      connectedMcpServerUrls: [],
      locale: "en",
    }).status;

  assert.equal(assess({}), "full");
  assert.equal(assess({ supportingFileCount: 2 }), "unsupported");
  assert.equal(assess({ audit: "warn" }), "partial");
  assert.equal(assess({ audit: "fail" }), "unsupported");
  assert.equal(assess({ archived: true }), "unsupported");
  assert.equal(assess({ license: null }), "unsupported");
});

test("a directly configured catalog Skill remains partial until user review", () => {
  assert.equal(
    assessSkillCapability({
      capability: {
        ...capability([]),
        source: {
          entryId: "review",
          id: "source-team",
          kind: "catalog-json",
          name: "Team Catalog",
        },
      },
      connectedMcpServerUrls: [],
      locale: "en",
    }).status,
    "partial",
  );
});

test("Skill assessment exposes bounded js_exec and limits Node.js or Python packages", () => {
  const simple = assessSkillCapability({
    capability: capability([]),
    connectedMcpServerUrls: [],
    locale: "en",
  });
  assert.equal(simple.status, "full");
  assert.match(
    simple.checks.find((check) => check.id === "boltpocket-js-exec-runtime")
      ?.label ?? "",
    /bounded read-only js_exec.*without Node\.js, Python/u,
  );

  for (const command of [
    "Run `node --version`.",
    "Run `python3 --version`.",
    "Use `npm install` before continuing.",
    "需要 Python 运行时。",
  ]) {
    const assessed = assessSkillCapability({
      capability: capability(
        [],
        [
          "---",
          "name: review",
          'title: "Review"',
          'description: "Review a project."',
          "risk: propose",
          "---",
          "",
          "# Review",
          "",
          command,
        ].join("\n"),
      ),
      connectedMcpServerUrls: [],
      locale: "en",
    });
    assert.equal(assessed.status, "partial", command);
    assert.equal(
      assessed.checks.some(
        (check) => check.id === "unavailable-runtime" && !check.available,
      ),
      true,
      command,
    );
  }
});

test("Skill assessment requires every referenced supporting file in the complete package", () => {
  const document = [
    "---",
    "name: review",
    'title: "Review"',
    'description: "Review a project."',
    "risk: propose",
    "---",
    "",
    "# Review",
    "",
    "Read [the policy](references/policy.md) before reviewing.",
  ].join("\n");
  const complete = assessSkillCapability({
    capability: capability([], document, [
      { content: "# Policy\n", path: "references/policy.md" },
    ]),
    connectedMcpServerUrls: [],
    locale: "en",
  });
  assert.equal(complete.status, "full");
  assert.equal(
    complete.checks.some(
      (check) => check.id === "referenced-supporting-files" && check.available,
    ),
    true,
  );

  const missing = assessSkillCapability({
    capability: capability([], document),
    connectedMcpServerUrls: [],
    locale: "en",
  });
  assert.equal(missing.status, "unsupported");
  assert.equal(
    missing.checks.some(
      (check) => check.id === "referenced-supporting-files" && !check.available,
    ),
    true,
  );
});
