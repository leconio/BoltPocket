import assert from "node:assert/strict";
import test from "node:test";

import type {
  PublishSkillMarketDocumentsInput,
  SkillMarketPublicationPort,
  SkillMarketPublicationReview,
} from "@/application/ports/skill-market-publication";
import { isExplicitSkillPublicationRequest } from "@/application/skill-publication-intent";
import type { WorkspaceResource } from "@/domain/models";
import { ProjectSkillMarketPublicationService } from "./project-skill-market-publication-service.ts";

const projectId = "project-market";
const skillId = "careful-review";
const skillDocument = [
  "---",
  `name: ${skillId}`,
  'title: "Careful review"',
  'description: "Review exact project evidence."',
  "risk: read",
  "---",
  "",
  "# Workflow",
  "",
  "Review exact evidence.",
].join("\n");
const readmeDocument = "# Careful review\n\nReviews exact project evidence.\n";
const passingReview: SkillMarketPublicationReview = {
  documentSha256: "a".repeat(64),
  findings: [],
  readmeSha256: "b".repeat(64),
  reviewHash: "c".repeat(64),
  status: "pass",
};

function resource(path: string, content: string): WorkspaceResource {
  return {
    connectionId: "workspace-project-market",
    content,
    id: path,
    path,
    projectId,
    storage: { kind: "memory" },
    version: "1",
  };
}

function fixture(overrides?: {
  now?: () => Date;
  resources?: WorkspaceResource[];
  reviews?: SkillMarketPublicationReview[];
}) {
  const published: PublishSkillMarketDocumentsInput[] = [];
  const reviewed: Readonly<{
    readmeDocument: string;
    skillDocument: string;
  }>[] = [];
  const reviews = [...(overrides?.reviews ?? [passingReview, passingReview])];
  const client: SkillMarketPublicationPort = {
    listOwned: async () => ({ skills: [] }),
    publicationStatus: async () => ({
      entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
      revision: "2-aabbccddeeff",
      status: "published",
    }),
    publish: async (input) => {
      published.push(input);
      return {
        entryId: "7b50ba33-e340-4acd-856c-c921e3608001",
        patch: { sha256: "d".repeat(64), text: "publication patch" },
        receipt: {
          id: "7b50ba33-e340-4acd-856c-c921e3608002",
          recoveryAvailable: true,
        },
        review: passingReview,
        revision: "3-aabbccddeeff",
      };
    },
    review: async (input) => {
      reviewed.push(input);
      const review = reviews.shift();
      if (!review) throw new Error("unexpected review");
      return review;
    },
    withdraw: async () => {
      throw new Error("unexpected withdrawal");
    },
  };
  const resources = overrides?.resources ?? [
    resource(`skills/${skillId}/SKILL.md`, skillDocument),
    resource(`skills/${skillId}/README.md`, readmeDocument),
  ];
  return {
    published,
    reviewed,
    service: new ProjectSkillMarketPublicationService({
      client,
      ...(overrides?.now ? { now: overrides.now } : {}),
      resources: (requestedProjectId) =>
        requestedProjectId === projectId ? resources : [],
    }),
  };
}

test("project publication re-reviews exact files and preflights the current revision", async () => {
  const subject = fixture();
  const review = await subject.service.review({
    conversationId: "conversation-1",
    projectId,
    runId: "run-review",
    skillId,
  });
  const result = await subject.service.publish({
    category: "engineering",
    conversationId: "conversation-1",
    latestUserPrompt: "请把这个 Skill 上传到市场",
    license: "MIT",
    projectId,
    publisherName: "BoltPocket Creator",
    reviewHash: review.reviewHash,
    runId: "run-publish",
    skillId,
    tags: ["review", "quality"],
  });

  assert.equal(result.revision, "3-aabbccddeeff");
  assert.equal(subject.reviewed.length, 2);
  assert.deepEqual(subject.published, [
    {
      category: "engineering",
      expectedRevision: "2-aabbccddeeff",
      license: "MIT",
      publisherName: "BoltPocket Creator",
      readmeDocument,
      reviewHash: passingReview.reviewHash,
      skillDocument,
      tags: ["review", "quality"],
    },
  ]);
});

test("project publication refuses stale reviews and implicit publication", async () => {
  const changedReview = {
    ...passingReview,
    documentSha256: "e".repeat(64),
    reviewHash: "f".repeat(64),
  };
  const subject = fixture({ reviews: [passingReview, changedReview] });
  await subject.service.review({
    conversationId: "conversation-1",
    projectId,
    runId: "run-review",
    skillId,
  });
  const input = {
    category: "engineering" as const,
    conversationId: "conversation-1",
    license: "MIT" as const,
    projectId,
    publisherName: "BoltPocket Creator",
    reviewHash: passingReview.reviewHash,
    runId: "run-publish",
    skillId,
    tags: ["review"],
  };

  await assert.rejects(
    subject.service.publish(
      { ...input, latestUserPrompt: "请总结审核结果" },
      undefined,
    ),
    /does not authorize/u,
  );
  await assert.rejects(
    subject.service.publish(
      { ...input, latestUserPrompt: "请发布这个 Skill" },
      undefined,
    ),
    /changed or no longer passes/u,
  );
  assert.deepEqual(subject.published, []);
  assert.equal(
    subject.service.hasReviewAwaitingPublication({
      conversationId: "conversation-1",
      projectId,
    }),
    false,
  );
});

test("an expired passing review publishes directly when both document digests still match", async () => {
  let now = new Date("2026-08-17T12:00:00.000Z");
  const subject = fixture({ now: () => now });
  assert.equal(
    subject.service.hasReviewAwaitingPublication({
      conversationId: "conversation-1",
      projectId,
    }),
    false,
  );
  const review = await subject.service.review({
    conversationId: "conversation-1",
    projectId,
    runId: "run-review",
    skillId,
  });
  now = new Date("2026-08-17T12:31:00.000Z");
  assert.equal(
    subject.service.hasReviewAwaitingPublication({
      conversationId: "conversation-1",
      projectId,
    }),
    true,
  );

  const result = await subject.service.publish({
    category: "engineering",
    conversationId: "conversation-1",
    latestUserPrompt: "发布吧",
    license: "MIT",
    projectId,
    publisherName: "BoltPocket Creator",
    reviewHash: review.reviewHash,
    runId: "run-publish",
    skillId,
    tags: ["review"],
  });
  assert.equal(result.revision, "3-aabbccddeeff");
  assert.equal(subject.reviewed.length, 2);
  assert.equal(subject.published.length, 1);
});

test("an expired review cannot carry publication authority across changed content", async () => {
  let now = new Date("2026-08-17T12:00:00.000Z");
  const changedReview = {
    ...passingReview,
    documentSha256: "e".repeat(64),
    reviewHash: "f".repeat(64),
  };
  const subject = fixture({
    now: () => now,
    reviews: [passingReview, changedReview],
  });
  const review = await subject.service.review({
    conversationId: "conversation-1",
    projectId,
    runId: "run-review",
    skillId,
  });
  now = new Date("2026-08-17T12:31:00.000Z");

  await assert.rejects(
    subject.service.publish({
      category: "engineering",
      conversationId: "conversation-1",
      latestUserPrompt: "发布吧",
      license: "MIT",
      projectId,
      publisherName: "BoltPocket Creator",
      reviewHash: review.reviewHash,
      runId: "run-publish",
      skillId,
      tags: ["review"],
    }),
    /changed or no longer passes/u,
  );
  assert.deepEqual(subject.published, []);
  assert.equal(
    subject.service.hasReviewAwaitingPublication({
      conversationId: "conversation-1",
      projectId,
    }),
    false,
  );
});

test("project publication reviews a missing README as empty and rejects supporting files", async () => {
  const missingReadme = fixture({
    resources: [resource(`skills/${skillId}/SKILL.md`, skillDocument)],
    reviews: [
      {
        ...passingReview,
        findings: [
          {
            code: "readme-required",
            line: null,
            message: "README.md content is required.",
            severity: "blocker",
            suggestion: "Add README.md.",
            target: "README.md",
          },
        ],
        status: "needs_changes",
      },
    ],
  });
  await missingReadme.service.review({
    conversationId: "conversation-1",
    projectId,
    runId: "run-review",
    skillId,
  });
  assert.equal(missingReadme.reviewed[0]?.readmeDocument, "");

  const withSupport = fixture({
    resources: [
      resource(`skills/${skillId}/SKILL.md`, skillDocument),
      resource(`skills/${skillId}/README.md`, readmeDocument),
      resource(`skills/${skillId}/scripts/check.js`, "export default true;"),
    ],
  });
  await withSupport.service.review({
    conversationId: "conversation-1",
    projectId,
    runId: "run-review",
    skillId,
  });
  await assert.rejects(
    withSupport.service.publish({
      category: "engineering",
      conversationId: "conversation-1",
      latestUserPrompt: "上传 Skill 到市场",
      license: "MIT",
      projectId,
      publisherName: "BoltPocket Creator",
      reviewHash: passingReview.reviewHash,
      runId: "run-publish",
      skillId,
      tags: ["review"],
    }),
    /only SKILL.md and README.md/u,
  );
});

test("publication intent rejects cancellation language", () => {
  assert.equal(isExplicitSkillPublicationRequest("请发布这个 Skill"), true);
  assert.equal(isExplicitSkillPublicationRequest("发布吧"), true);
  assert.equal(isExplicitSkillPublicationRequest("上传"), true);
  assert.equal(isExplicitSkillPublicationRequest("继续发布"), true);
  assert.equal(isExplicitSkillPublicationRequest("把这个技能上架"), true);
  assert.equal(isExplicitSkillPublicationRequest("Publish this Skill"), true);
  assert.equal(isExplicitSkillPublicationRequest("请上传这个文件"), false);
  assert.equal(isExplicitSkillPublicationRequest("请发布这份报告"), false);
  assert.equal(isExplicitSkillPublicationRequest("先不要发布 Skill"), false);
  assert.equal(
    isExplicitSkillPublicationRequest("Do not publish this Skill"),
    false,
  );
});
