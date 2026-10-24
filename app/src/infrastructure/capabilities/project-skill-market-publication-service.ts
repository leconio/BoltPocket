import type {
  AgentSkillMarketPublicationPort,
  PublishProjectSkillToMarketInput,
  ReviewProjectSkillForMarketInput,
  SkillMarketPublicationPort,
  SkillMarketPublicationReview,
} from "@/application/ports/skill-market-publication";
import { isExplicitSkillPublicationRequest } from "@/application/skill-publication-intent";
import type { WorkspaceResource } from "@/domain/models";

const REVIEW_TTL_MS = 30 * 60 * 1_000;
const EXPIRED_REVIEW_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_PENDING_REVIEWS = 8;
const PROJECT_SKILL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

type PendingReview = Readonly<{
  conversationId: string;
  documentSha256: string;
  projectId: string;
  readmeSha256: string;
  reviewedAt: number;
  skillId: string;
}>;

type Dependencies = Readonly<{
  client: SkillMarketPublicationPort;
  now?: () => Date;
  resources: (projectId: string) => readonly WorkspaceResource[];
}>;

export class ProjectSkillMarketPublicationService implements AgentSkillMarketPublicationPort {
  readonly #client: SkillMarketPublicationPort;
  readonly #now: () => Date;
  readonly #resources: Dependencies["resources"];
  readonly #pending = new Map<string, PendingReview>();
  readonly #expired = new Map<string, PendingReview>();

  constructor(dependencies: Dependencies) {
    this.#client = dependencies.client;
    this.#now = dependencies.now ?? (() => new Date());
    this.#resources = dependencies.resources;
  }

  hasReviewAwaitingPublication(
    input: Readonly<{
      conversationId: string;
      projectId: string;
    }>,
  ) {
    this.#evictExpired();
    return [...this.#pending.values(), ...this.#expired.values()].some(
      (review) =>
        review.conversationId === input.conversationId &&
        review.projectId === input.projectId,
    );
  }

  async review(input: ReviewProjectSkillForMarketInput, signal?: AbortSignal) {
    const documents = this.#documents(input.projectId, input.skillId);
    const review = await this.#client.review(documents, signal);
    this.#remember(input, review);
    return review;
  }

  async publish(input: PublishProjectSkillToMarketInput, signal?: AbortSignal) {
    if (!isExplicitSkillPublicationRequest(input.latestUserPrompt)) {
      throw new Error(
        "The latest user message does not authorize publication.",
      );
    }
    this.#evictExpired();
    const pending =
      this.#pending.get(input.reviewHash) ??
      this.#expired.get(input.reviewHash);
    if (
      !pending ||
      pending.conversationId !== input.conversationId ||
      pending.projectId !== input.projectId ||
      pending.skillId !== input.skillId
    ) {
      throw new Error("Review this exact project Skill before publishing it.");
    }
    const documents = this.#documents(input.projectId, input.skillId);
    this.#assertTwoFilePackage(input.projectId, input.skillId);
    const currentReview = await this.#client.review(documents, signal);
    if (
      currentReview.status !== "pass" ||
      currentReview.reviewHash !== input.reviewHash ||
      currentReview.documentSha256 !== pending.documentSha256 ||
      currentReview.readmeSha256 !== pending.readmeSha256
    ) {
      this.#pending.delete(input.reviewHash);
      this.#expired.delete(input.reviewHash);
      throw new Error(
        "The Skill changed or no longer passes review. Review it again.",
      );
    }
    const current = await this.#client.publicationStatus(input.skillId, signal);
    const result = await this.#client.publish(
      {
        category: input.category,
        expectedRevision: current.revision,
        license: input.license,
        publisherName: input.publisherName,
        readmeDocument: documents.readmeDocument,
        reviewHash: currentReview.reviewHash,
        skillDocument: documents.skillDocument,
        tags: input.tags,
      },
      signal,
    );
    this.#pending.delete(input.reviewHash);
    this.#expired.delete(input.reviewHash);
    return result;
  }

  #documents(projectId: string, skillId: string) {
    if (!projectId || !PROJECT_SKILL_ID.test(skillId)) {
      throw new Error("Project Skill publication target is invalid.");
    }
    const resources = this.#resources(projectId);
    const root = `skills/${skillId}/`;
    const skillDocument = resources.find(
      (resource) => resource.path === `${root}SKILL.md`,
    );
    if (!skillDocument) {
      throw new Error(`Project Skill ${skillId} does not have SKILL.md.`);
    }
    const readmeDocument = resources.find(
      (resource) => resource.path === `${root}README.md`,
    );
    return {
      readmeDocument: readmeDocument?.content ?? "",
      skillDocument: skillDocument.content,
    };
  }

  #assertTwoFilePackage(projectId: string, skillId: string) {
    const root = `skills/${skillId}/`;
    const supportingFiles = this.#resources(projectId).filter(
      (resource) =>
        resource.path.startsWith(root) &&
        resource.path !== `${root}SKILL.md` &&
        resource.path !== `${root}README.md`,
    );
    if (supportingFiles.length > 0) {
      throw new Error(
        "This market version publishes only SKILL.md and README.md. Remove dependencies on supporting files before publishing.",
      );
    }
  }

  #remember(
    input: ReviewProjectSkillForMarketInput,
    review: SkillMarketPublicationReview,
  ) {
    this.#evictExpired();
    if (review.status !== "pass") return;
    this.#expired.delete(review.reviewHash);
    this.#pending.set(review.reviewHash, {
      conversationId: input.conversationId,
      documentSha256: review.documentSha256,
      projectId: input.projectId,
      readmeSha256: review.readmeSha256,
      reviewedAt: this.#now().getTime(),
      skillId: input.skillId,
    });
    while (this.#pending.size > MAX_PENDING_REVIEWS) {
      const oldest = this.#pending.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#pending.delete(oldest);
    }
  }

  #evictExpired() {
    const now = this.#now().getTime();
    const cutoff = now - REVIEW_TTL_MS;
    for (const [reviewHash, pending] of this.#pending) {
      if (pending.reviewedAt > cutoff) continue;
      this.#expired.set(reviewHash, pending);
      this.#pending.delete(reviewHash);
    }
    const retentionCutoff = now - EXPIRED_REVIEW_RETENTION_MS;
    for (const [reviewHash, expired] of this.#expired) {
      if (expired.reviewedAt <= retentionCutoff) {
        this.#expired.delete(reviewHash);
      }
    }
    while (this.#expired.size > MAX_PENDING_REVIEWS) {
      const oldest = this.#expired.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#expired.delete(oldest);
    }
  }
}
