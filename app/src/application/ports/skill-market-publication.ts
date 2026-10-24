import type {
  SkillMarketCategory,
  SkillMarketLicense,
} from "@/application/ports/skill-market";

export type SkillMarketPublicationFinding = Readonly<{
  code: string;
  line: number | null;
  message: string;
  severity: "blocker" | "warning";
  suggestion: string;
  target: "README.md" | "SKILL.md";
}>;

export type SkillMarketPublicationReview = Readonly<{
  documentSha256: string;
  findings: readonly SkillMarketPublicationFinding[];
  readmeSha256: string;
  reviewHash: string;
  status: "needs_changes" | "pass";
}>;

export type SkillMarketPublicationStatus = Readonly<{
  entryId: string | null;
  revision: string | null;
  status: "published" | "reviewing" | "rejected" | "withdrawn" | null;
}>;

export type SkillMarketOwnedPublication = Readonly<{
  entryId: string;
  skillId: string;
  title: string;
  revision: string;
  status: "published" | "reviewing" | "rejected" | "withdrawn" | "suspended";
  published: boolean;
  reviewing: boolean;
  canWithdraw: boolean;
  updatedAt: number;
}>;

export type SkillMarketOwnedPublications = Readonly<{
  skills: readonly SkillMarketOwnedPublication[];
}>;

export type SkillMarketWithdrawResult = Readonly<{
  entryId: string;
  patch: Readonly<{ sha256: string; text: string }>;
  receipt: Readonly<{ id: string; recoveryAvailable: true }>;
}>;

export type SkillMarketPublicationResult = Readonly<{
  entryId: string;
  patch: Readonly<{ sha256: string; text: string }>;
  receipt: Readonly<{ id: string; recoveryAvailable: true }>;
  review: SkillMarketPublicationReview;
  revision: string;
}>;

export type PublishSkillMarketDocumentsInput = Readonly<{
  category: SkillMarketCategory;
  expectedRevision: string | null;
  license: SkillMarketLicense;
  publisherName: string;
  readmeDocument: string;
  reviewHash: string;
  skillDocument: string;
  tags: readonly string[];
}>;

export interface SkillMarketPublicationPort {
  listOwned(signal?: AbortSignal): Promise<SkillMarketOwnedPublications>;
  publicationStatus(
    skillId: string,
    signal?: AbortSignal,
  ): Promise<SkillMarketPublicationStatus>;
  publish(
    input: PublishSkillMarketDocumentsInput,
    signal?: AbortSignal,
  ): Promise<SkillMarketPublicationResult>;
  withdraw(
    entryId: string,
    expectedRevision: string,
    signal?: AbortSignal,
  ): Promise<SkillMarketWithdrawResult>;
  review(
    input: Readonly<{ readmeDocument: string; skillDocument: string }>,
    signal?: AbortSignal,
  ): Promise<SkillMarketPublicationReview>;
}

export type ReviewProjectSkillForMarketInput = Readonly<{
  conversationId: string;
  projectId: string;
  runId: string;
  skillId: string;
}>;

export type PublishProjectSkillToMarketInput = Readonly<{
  category: SkillMarketCategory;
  conversationId: string;
  latestUserPrompt: string;
  license: SkillMarketLicense;
  projectId: string;
  publisherName: string;
  reviewHash: string;
  runId: string;
  skillId: string;
  tags: readonly string[];
}>;

export interface AgentSkillMarketPublicationPort {
  hasReviewAwaitingPublication(
    input: Readonly<{
      conversationId: string;
      projectId: string;
    }>,
  ): boolean;
  review(
    input: ReviewProjectSkillForMarketInput,
    signal?: AbortSignal,
  ): Promise<SkillMarketPublicationReview>;
  publish(
    input: PublishProjectSkillToMarketInput,
    signal?: AbortSignal,
  ): Promise<SkillMarketPublicationResult>;
}
