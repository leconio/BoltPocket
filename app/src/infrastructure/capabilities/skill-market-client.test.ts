import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { skillBundleFingerprintInput } from "@/application/skill-bundle";
import { SkillMarketClient } from "./skill-market-client.ts";

const entryId = "project-review";
const skillDocument = [
  "---",
  `name: ${entryId}`,
  'title: "Project review"',
  'description: "Review a project."',
  "risk: read",
  "---",
  "",
  "# Workflow",
  "",
  "Review the project.",
].join("\n");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const summary = {
  ageRating: "16+",
  category: "engineering",
  contentDescriptors: ["user-generated-content", "agent-automation"],
  description: { en: "Review a project.", zhCN: "审查项目。" },
  featured: true,
  id: entryId,
  license: "MIT",
  name: { en: "Project review", zhCN: "项目审查" },
  provider: { en: "BoltPocket", zhCN: "BoltPocket" },
  publisherId: "publisher-boltpocket-official",
  publishedAt: 1_787_000_000,
  revision: "1-aabbccddeeff",
  risk: "read",
  sha256: sha256(skillDocument),
  tags: ["review"],
  universalLink: `https://api.example.com/mini-apps/${entryId}`,
  verified: true,
} as const;
const file = {
  byteLength: new TextEncoder().encode(skillDocument).byteLength,
  content: skillDocument,
  encoding: "utf8" as const,
  executable: false,
  mimeType: "text/markdown",
  path: "SKILL.md",
  sha256: summary.sha256,
};
const capability = {
  bundle: {
    complete: true,
    files: [file],
    sha256: sha256(skillBundleFingerprintInput([file])),
    totalBytes: file.byteLength,
  },
  description: summary.description,
  documentationUrl: `https://api.example.com/v1/skill-market/skills/${entryId}`,
  id: entryId,
  kind: "skill",
  name: summary.name,
  provider: summary.provider,
  requirements: [],
  revision: summary.revision,
  risk: summary.risk,
  sha256: summary.sha256,
  skillDocument,
};

test("market detail exposes README only while download disables HTTP caching", async () => {
  const requests: { init?: RequestInit; url: string }[] = [];
  const client = new SkillMarketClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async (url, init) => {
        requests.push({ init, url: String(url) });
        const body = String(url).endsWith("/download?region=global")
          ? {
              catalogVersion: "2026-08-16.1",
              entries: [capability],
              region: "global",
            }
          : {
              catalogVersion: "2026-08-16.1",
              entry: {
                readmeDocument: "# Project review\n\nPublic overview.\n",
                summary,
              },
              region: "global",
            };
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    },
  );

  const detail = await client.loadDetail(entryId, "global");
  assert.equal(detail.readmeDocument, "# Project review\n\nPublic overview.\n");
  assert.equal("skillDocument" in detail, false);
  const downloaded = await client.downloadSkill(entryId, "global");
  assert.equal(downloaded.skillDocument, skillDocument);
  assert.equal(requests[0]?.init?.cache, "default");
  assert.equal(requests[1]?.init?.cache, "no-store");
  assert.equal(
    (requests[1]?.init?.headers as Record<string, string>)["Cache-Control"],
    "no-store",
  );
});

test("market detail rejects a response that tries to include SKILL.md", async () => {
  const client = new SkillMarketClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async () =>
        new Response(
          JSON.stringify({
            catalogVersion: "2026-08-16.1",
            entry: {
              readmeDocument: "# Project review\n",
              skillDocument,
              summary,
            },
            region: "global",
          }),
        )) as typeof fetch,
    },
  );
  await assert.rejects(
    client.loadDetail(entryId, "global"),
    /detail is invalid/u,
  );
});

test("execution status is exact and always requested without caching", async () => {
  let requestInit: RequestInit | undefined;
  const client = new SkillMarketClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async (_url, init) => {
        requestInit = init;
        return new Response(
          JSON.stringify({ allowed: true, reason: "active", region: "global" }),
        );
      }) as typeof fetch,
    },
  );
  await assert.doesNotReject(
    client.checkExecution(entryId, summary.revision, summary.sha256, "global"),
  );
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(
    (requestInit?.headers as Record<string, string>)["Cache-Control"],
    "no-store",
  );
});
