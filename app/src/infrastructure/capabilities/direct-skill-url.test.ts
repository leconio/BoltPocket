import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import type { SkillCapability } from "@/application/ports/capability-catalog";
import { skillBundleFingerprintInput } from "@/application/skill-bundle";
import {
  DIRECT_SKILL_SOURCE_ID,
  DirectSkillUrlError,
  DirectSkillUrlResolver,
} from "./direct-skill-url.ts";

const skillDocument = [
  "---",
  "name: release-check",
  'title: "Release check"',
  'description: "Verify a release before publishing."',
  "risk: read",
  "---",
  "",
  "# Steps",
  "",
  "Verify the project.",
  "",
].join("\n");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function capability(entryId = "owner/repo/release-check"): SkillCapability {
  const skillFile = {
    byteLength: new TextEncoder().encode(skillDocument).byteLength,
    content: skillDocument,
    encoding: "utf8" as const,
    executable: false,
    mimeType: "text/markdown",
    path: "SKILL.md",
    sha256: sha256(skillDocument),
  };
  return {
    bundle: {
      complete: true,
      files: [skillFile],
      sha256: sha256(skillBundleFingerprintInput([skillFile])),
      totalBytes: skillFile.byteLength,
    },
    description: { en: "Verify a release.", zhCN: "Verify a release." },
    documentationUrl: `https://skills.sh/${entryId}`,
    id: "release-check",
    kind: "skill",
    name: { en: "Release check", zhCN: "Release check" },
    provider: { en: "owner/repo", zhCN: "owner/repo" },
    requirements: [],
    revision: "abc123",
    risk: "read",
    sha256: sha256(skillDocument),
    skillDocument,
    source: {
      entryId,
      id: "skills-sh",
      kind: "skills-sh",
      name: "Skills.sh",
    },
  };
}

function resolver(options?: {
  fetch?: typeof fetch;
  resolveSkill?: (
    sourceId: string,
    entryId: string,
    signal?: AbortSignal,
  ) => Promise<SkillCapability>;
}) {
  return new DirectSkillUrlResolver({
    catalog: {
      resolveSkill: (sourceId, entryId, _region, signal) =>
        options?.resolveSkill?.(sourceId, entryId, signal) ??
        Promise.resolve(capability(entryId)),
    },
    digest: async (value) => sha256(value),
    digestBytes: async (value) =>
      createHash("sha256").update(value).digest("hex"),
    fetch:
      options?.fetch ??
      ((async () => new Response(skillDocument)) as typeof fetch),
    region: "global",
  });
}

function directError(code: DirectSkillUrlError["code"]) {
  return (error: unknown) =>
    error instanceof DirectSkillUrlError && error.code === code;
}

test("Skill URL keeps Skills.sh as a supported URL without making it mandatory", async () => {
  const calls: string[] = [];
  const entryId = "owner/repo/release-check";
  const resolved = capability(entryId);
  const subject = resolver({
    resolveSkill: async (sourceId, requestedEntryId) => {
      calls.push(`${sourceId}:${requestedEntryId}`);
      return resolved;
    },
  });

  assert.equal(await subject.resolve(`https://skills.sh/${entryId}`), resolved);
  assert.deepEqual(calls, [`skills-sh:${entryId}`]);
});

test("Skill URL accepts an arbitrary HTTPS host, port, path, and query", async () => {
  let requested = "";
  let requestedInit: RequestInit | undefined;
  const input = "https://192.168.51.72:8443/files/current?id=release-check";
  const resolved = await resolver({
    fetch: (async (url, init) => {
      requested = String(url);
      requestedInit = init;
      return new Response(skillDocument, {
        headers: { "Content-Type": "text/markdown" },
      });
    }) as typeof fetch,
  }).resolve(input);

  assert.equal(requested, input);
  assert.equal(requestedInit?.credentials, "omit");
  assert.equal(resolved.id, "release-check");
  assert.equal(resolved.documentationUrl, input);
  assert.equal(resolved.source.id, DIRECT_SKILL_SOURCE_ID);
  assert.equal(resolved.source.entryId, "release-check");
  assert.equal(resolved.sha256, sha256(skillDocument));
  assert.equal(resolved.bundle.files.length, 1);
  assert.equal(resolved.bundle.files[0]?.content, skillDocument);
});

test("Skill URL accepts HTTP from a local network address", async () => {
  const input = "http://192.168.51.72:8080/skills/release-check/SKILL.md";
  let requested = "";
  const resolved = await resolver({
    fetch: (async (url) => {
      requested = String(url);
      return new Response(skillDocument);
    }) as typeof fetch,
  }).resolve(input);

  assert.equal(requested, input);
  assert.equal(resolved.documentationUrl, input);
});

test("GitHub repository URLs resolve a pinned portable Agent Skill and normalize metadata", async () => {
  const calls: string[] = [];
  const portable = [
    "---",
    "name: humanizer",
    "description: >",
    "  Remove signs of AI-generated writing and make prose sound natural.",
    "license: MIT",
    "metadata:",
    '  version: "2.9.1"',
    "---",
    "",
    "# Humanizer",
    "",
    "Revise the supplied text without changing its meaning.",
    "",
  ].join("\n");
  const archive = zipSync({
    "blader-humanizer-a/SKILL.md": strToU8(portable),
    "blader-humanizer-a/README.md": strToU8("# Humanizer docs\n"),
  });
  const resolved = await resolver({
    fetch: (async (url) => {
      const requested = String(url);
      calls.push(requested);
      if (requested === "https://api.github.com/repos/blader/humanizer") {
        return new Response(
          JSON.stringify({
            default_branch: "main",
            full_name: "blader/humanizer",
            private: false,
          }),
        );
      }
      if (requested.endsWith("/commits/main")) {
        return new Response(JSON.stringify({ sha: "a".repeat(40) }));
      }
      return new Response(archive);
    }) as typeof fetch,
  }).resolve("https://github.com/blader/humanizer");

  assert.deepEqual(calls, [
    "https://api.github.com/repos/blader/humanizer",
    "https://api.github.com/repos/blader/humanizer/commits/main",
    `https://api.github.com/repos/blader/humanizer/zipball/${"a".repeat(40)}`,
  ]);
  assert.equal(resolved.id, "humanizer");
  assert.equal(
    resolved.documentationUrl,
    "https://github.com/blader/humanizer",
  );
  assert.equal(resolved.provider.en, "blader/humanizer");
  assert.equal(resolved.name.en, "Humanizer");
  assert.equal(resolved.risk, "propose");
  assert.match(resolved.skillDocument, /title: "Humanizer"/u);
  assert.match(resolved.skillDocument, /risk: propose/u);
  assert.doesNotMatch(resolved.skillDocument, /license:|metadata:/u);
  assert.match(resolved.skillDocument, /Revise the supplied text/u);
  assert.deepEqual(
    resolved.bundle.files.map((file) => file.path),
    ["README.md", "SKILL.md"],
  );
});

test("Skill URL rejects malformed, public HTTP, or credential-bearing URLs", async () => {
  const subject = resolver();
  await assert.rejects(
    () => subject.resolve("not a url"),
    directError("invalid-url"),
  );
  for (const url of [
    "http://example.com/SKILL.md",
    "https://user:secret@example.com/SKILL.md",
  ]) {
    await assert.rejects(() => subject.resolve(url), directError("unsafe-url"));
  }
});

test("Skill URL validates document format and response size", async () => {
  await assert.rejects(
    () =>
      resolver({
        fetch: (async () =>
          new Response("not a skill document")) as typeof fetch,
      }).resolve("https://example.com/anything"),
    directError("invalid-document"),
  );
  await assert.rejects(
    () =>
      resolver({
        fetch: (async () =>
          new Response(skillDocument, {
            headers: { "Content-Length": String(64 * 1024 + 1) },
          })) as typeof fetch,
      }).resolve("https://example.com/anything"),
    directError("invalid-document"),
  );
});

test("Skill URL verifies the hash returned for a Skills.sh URL", async () => {
  const subject = resolver({
    resolveSkill: async () => ({
      ...capability(),
      sha256: "a".repeat(64),
    }),
  });
  await assert.rejects(
    () => subject.resolve("https://skills.sh/owner/repo/release-check"),
    directError("integrity-failed"),
  );
});
