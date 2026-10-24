import assert from "node:assert/strict";
import test from "node:test";

import { SkillMarketPublicationClient } from "./skill-market-publication-client.ts";

const review = {
  documentSha256: "a".repeat(64),
  findings: [],
  readmeSha256: "b".repeat(64),
  reviewHash: "c".repeat(64),
  status: "pass",
} as const;

test("publication client keeps review and publication requests out of caches", async () => {
  const requests: { body: unknown; init?: RequestInit; url: string }[] = [];
  const client = new SkillMarketPublicationClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async (url, init) => {
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : null,
          init,
          url: String(url),
        });
        const path = new URL(String(url)).pathname;
        const value = path.endsWith("/reviews")
          ? review
          : path.endsWith("/publications/skills/careful-review")
            ? { entryId: null, revision: null, status: null }
            : {
                entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
                patch: {
                  sha256: "d".repeat(64),
                  text: "publication patch",
                },
                receipt: {
                  id: "7b50ba33-e340-4acd-856c-c921e3608002",
                  recoveryAvailable: true,
                },
                review,
                revision: "1-aabbccddeeff",
              };
        return new Response(JSON.stringify(value));
      }) as typeof fetch,
    },
  );

  assert.equal(
    (
      await client.review({
        readmeDocument: "# Careful review\n",
        skillDocument: "---\nname: careful-review\n---\n",
      })
    ).reviewHash,
    review.reviewHash,
  );
  assert.deepEqual(await client.publicationStatus("careful-review"), {
    entryId: null,
    revision: null,
    status: null,
  });
  const result = await client.publish({
    category: "engineering",
    expectedRevision: null,
    license: "MIT",
    publisherName: "BoltPocket Creator",
    readmeDocument: "# Careful review\n",
    reviewHash: review.reviewHash,
    skillDocument: "---\nname: careful-review\n---\n",
    tags: ["review"],
  });
  assert.equal(result.receipt.recoveryAvailable, true);
  assert.equal(
    requests.every(({ init }) => init?.cache === "no-store"),
    true,
  );
  assert.equal(
    requests.every(
      ({ init }) =>
        (init?.headers as Record<string, string>)["Cache-Control"] ===
        "no-store",
    ),
    true,
  );
});

test("publication client rejects inconsistent review status", async () => {
  const client = new SkillMarketPublicationClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async () =>
        new Response(
          JSON.stringify({
            ...review,
            findings: [
              {
                code: "private-key",
                line: 4,
                message: "A private key was detected.",
                severity: "blocker",
                suggestion: "Remove it.",
                target: "SKILL.md",
              },
            ],
          }),
        )) as typeof fetch,
    },
  );
  await assert.rejects(
    client.review({ readmeDocument: "# Readme\n", skillDocument: "Skill" }),
    /review status is invalid/u,
  );
});

test("publication client parses owned Skills and sends a revision-bound withdrawal", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const client = new SkillMarketPublicationClient(
    { baseUrl: "https://api.example.com" },
    {
      fetch: (async (url, init) => {
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : null,
          method: init?.method ?? "GET",
          url: String(url),
        });
        const path = new URL(String(url)).pathname;
        const value = path.endsWith("/publications")
          ? {
              skills: [
                {
                  canWithdraw: true,
                  entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
                  published: false,
                  reviewing: true,
                  revision: "2-aabbccddeeff",
                  skillId: "careful-review",
                  status: "reviewing",
                  title: "Careful review",
                  updatedAt: 1_776_288_000,
                },
              ],
            }
          : {
              entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
              patch: { sha256: "d".repeat(64), text: "withdrawal patch" },
              receipt: {
                id: "7b50ba33-e340-4acd-856c-c921e3608002",
                recoveryAvailable: true,
              },
            };
        return new Response(JSON.stringify(value));
      }) as typeof fetch,
    },
  );

  const owned = await client.listOwned();
  assert.deepEqual(owned.skills[0], {
    canWithdraw: true,
    entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
    published: false,
    reviewing: true,
    revision: "2-aabbccddeeff",
    skillId: "careful-review",
    status: "reviewing",
    title: "Careful review",
    updatedAt: 1_776_288_000,
  });
  const withdrawn = await client.withdraw(
    "7b50ba33-e340-4acd-856c-c921e3608001",
    "2-aabbccddeeff",
  );
  assert.equal(withdrawn.entryId, "7b50ba33-e340-4acd-856c-c921e3608001");
  assert.equal(requests[1]?.method, "POST");
  assert.deepEqual(requests[1]?.body, { expectedRevision: "2-aabbccddeeff" });
});
