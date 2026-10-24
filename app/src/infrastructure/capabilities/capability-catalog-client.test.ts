import assert from "node:assert/strict";
import test from "node:test";

import { CapabilityCatalogClient } from "./capability-catalog-client.ts";

const entryId = "owner/repository/project-review";
const skillDocument = [
  "---",
  "name: project-review",
  'title: "Project review"',
  'description: "Review the project."',
  "risk: propose",
  "---",
  "",
  "# Review",
  "",
].join("\n");

const skill = {
  bundle: {
    complete: true,
    files: [
      {
        byteLength: new TextEncoder().encode(skillDocument).byteLength,
        content: skillDocument,
        encoding: "utf8",
        executable: false,
        mimeType: "text/markdown",
        path: "SKILL.md",
        sha256: "a".repeat(64),
      },
      {
        byteLength: 4,
        content: "AAEC/w==",
        encoding: "base64",
        executable: false,
        mimeType: "application/octet-stream",
        path: "assets/icon.bin",
        sha256: "b".repeat(64),
      },
      {
        byteLength: 12,
        content: "print('ok')\n",
        encoding: "utf8",
        executable: true,
        mimeType: "text/x-python",
        path: "scripts/run.py",
        sha256: "c".repeat(64),
      },
    ],
    sha256: "d".repeat(64),
    totalBytes: new TextEncoder().encode(skillDocument).byteLength + 16,
  },
  id: "project-review",
  kind: "skill",
  name: { en: "Project review", zhCN: "项目审查" },
  provider: { en: "owner/repository", zhCN: "owner/repository" },
  description: { en: "Review projects", zhCN: "审查项目" },
  documentationUrl: `https://skills.sh/${entryId}`,
  revision: "2026.08.15.1",
  risk: "propose",
  sha256: "a".repeat(64),
  skillDocument,
  requirements: [
    {
      id: "project_context_read",
      kind: "host-tool",
      label: { en: "Project context", zhCN: "项目上下文" },
      required: true,
    },
  ],
  provenance: {
    archived: false,
    audit: "pass",
    commitSha: "b".repeat(40),
    compatibility: null,
    installs: 0,
    kind: "skills-sh",
    license: "MIT",
    repositoryUrl: "https://github.com/owner/repository",
    sourceId: entryId,
    supportingFileCount: 2,
  },
};

const source = {
  id: "skills-sh",
  kind: "skills-sh" as const,
  name: "Skills.sh",
};

function response(entry: unknown = skill, headers?: HeadersInit) {
  return Response.json(
    {
      catalogVersion: "2026-08-15.1",
      entries: [entry],
      region: "global",
    },
    { headers },
  );
}

test("Skill URL client resolves one exact entry without credentials", async () => {
  let requested = "";
  let requestedInit: RequestInit | undefined;
  const client = new CapabilityCatalogClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async (input, init) => {
        requested = String(input);
        requestedInit = init;
        return response();
      }) as typeof fetch,
    },
  );
  const resolved = await client.resolveSkill(entryId, "global", source);

  assert.equal(
    requested,
    "https://api.example.com/v1/capabilities/catalog/skills/resolve?region=global&id=owner%2Frepository%2Fproject-review",
  );
  assert.equal(requestedInit?.credentials, "omit");
  assert.equal(resolved.source.id, "skills-sh");
  assert.equal(resolved.source.entryId, entryId);
  assert.equal(resolved.bundle.files.length, 3);
  assert.deepEqual(resolved.bundle.files[1], skill.bundle.files[1]);
});

test("Skill URL client rejects mismatched provenance and non-Skill entries", async () => {
  const resolve = (entry: unknown) =>
    new CapabilityCatalogClient(
      { baseUrl: "https://api.example.com" },
      { fetch: (async () => response(entry)) as typeof fetch },
    ).resolveSkill(entryId, "global", source);

  await assert.rejects(
    resolve({
      ...skill,
      provenance: { ...skill.provenance, sourceId: "other/repo/skill" },
    }),
    /invalid/u,
  );
  await assert.rejects(resolve({ ...skill, kind: "mcp" }), /invalid/u);
});

test("Skill URL client bounds declared response size and requirement endpoints", async () => {
  const oversized = new CapabilityCatalogClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async () =>
        response(skill, {
          "Content-Length": String(8 * 1024 * 1024 + 1),
        })) as typeof fetch,
    },
  );
  await assert.rejects(
    oversized.resolveSkill(entryId, "global", source),
    /large/u,
  );

  const privateRequirement = new CapabilityCatalogClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async () =>
        response({
          ...skill,
          requirements: [
            {
              id: "private-mcp",
              kind: "mcp-server",
              label: { en: "Private", zhCN: "内网" },
              required: true,
              serverUrl: "https://192.168.1.5/mcp",
            },
          ],
        })) as typeof fetch,
    },
  );
  await assert.rejects(
    privateRequirement.resolveSkill(entryId, "global", source),
    /permitted/u,
  );
});
