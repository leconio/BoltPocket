import { Type } from "typebox";

import {
  MAX_GLOBAL_MEMORY_CHARACTERS,
  MAX_GLOBAL_SKILL_CHARACTERS,
} from "@/domain/library-content";

const idSchema = Type.String({ minLength: 1, maxLength: 240 });
const dateSchema = Type.String({ minLength: 20, maxLength: 64 });
const nullableIdSchema = Type.Union([idSchema, Type.Null()]);
const contextSchema = Type.Object(
  {
    id: idSchema,
    kind: Type.Union([
      Type.Literal("memory"),
      Type.Literal("skill"),
      Type.Literal("connection"),
    ]),
    label: Type.String({ maxLength: 240 }),
    detail: Type.String({ maxLength: 20_000 }),
  },
  { additionalProperties: false },
);
const collaborationTaskSchema = Type.Object(
  {
    id: idSchema,
    role: Type.Union([
      Type.Literal("scout"),
      Type.Literal("planner"),
      Type.Literal("reviewer"),
    ]),
    description: Type.String({ minLength: 1, maxLength: 80 }),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("failed"),
    ]),
    startedAt: Type.Integer({ minimum: 0 }),
    durationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 3_600_000 })),
    summary: Type.Optional(Type.String({ maxLength: 12_000 })),
    toolActivity: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
        maxItems: 32,
      }),
    ),
  },
  { additionalProperties: false },
);
const agentActivityItemSchema = Type.Union([
  Type.Object(
    {
      id: idSchema,
      kind: Type.Union([Type.Literal("thinking"), Type.Literal("text")]),
      content: Type.String({ minLength: 1, maxLength: 180_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: idSchema,
      kind: Type.Literal("tool"),
      label: Type.String({ minLength: 1, maxLength: 120 }),
      status: Type.Union([
        Type.Literal("running"),
        Type.Literal("completed"),
        Type.Literal("failed"),
        Type.Literal("staged"),
        Type.Literal("cancelled"),
      ]),
      durationMs: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 86_400_000 }),
      ),
      failureReason: Type.Optional(
        Type.String({ minLength: 1, maxLength: 360 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: idSchema,
      kind: Type.Literal("context"),
      operation: Type.Union([
        Type.Literal("automatic_compaction"),
        Type.Literal("overflow_recovery"),
      ]),
      status: Type.Union([
        Type.Literal("running"),
        Type.Literal("completed"),
        Type.Literal("failed"),
        Type.Literal("cancelled"),
      ]),
      tokensBefore: Type.Optional(Type.Integer({ minimum: 0 })),
      tokensAfter: Type.Optional(Type.Integer({ minimum: 0 })),
      durationMs: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 86_400_000 }),
      ),
    },
    { additionalProperties: false },
  ),
]);
const agentExecutionSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
      Type.Literal("interrupted"),
    ]),
    durationMs: Type.Integer({ minimum: 0, maximum: 86_400_000 }),
    activity: Type.Array(agentActivityItemSchema, { maxItems: 256 }),
  },
  { additionalProperties: false },
);
const generatedImageAttachmentSchema = Type.Object(
  {
    id: idSchema,
    kind: Type.Literal("generated-image"),
    uri: Type.String({ minLength: 8, maxLength: 8_192, pattern: "^file://" }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Union([
      Type.Literal("image/jpeg"),
      Type.Literal("image/png"),
      Type.Literal("image/webp"),
    ]),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 10 * 1024 * 1024 }),
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384 })),
    height: Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384 })),
    providerName: Type.String({ minLength: 1, maxLength: 80 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    createdAt: dateSchema,
  },
  { additionalProperties: false },
);
const generatedVideoAttachmentSchema = Type.Object(
  {
    id: idSchema,
    kind: Type.Literal("generated-video"),
    uri: Type.String({ minLength: 8, maxLength: 8_192, pattern: "^file://" }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Literal("video/mp4"),
    sizeBytes: Type.Integer({
      minimum: 1,
      maximum: 256 * 1024 * 1024,
    }),
    durationSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
    providerName: Type.String({ minLength: 1, maxLength: 80 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    createdAt: dateSchema,
  },
  { additionalProperties: false },
);
const chatMessageSchema = Type.Object(
  {
    id: idSchema,
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    content: Type.String({ maxLength: 200_000 }),
    thinking: Type.Optional(Type.String({ maxLength: 200_000 })),
    toolActivity: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
        maxItems: 64,
      }),
    ),
    execution: Type.Optional(agentExecutionSchema),
    collaboration: Type.Optional(
      Type.Array(collaborationTaskSchema, { maxItems: 3 }),
    ),
    context: Type.Optional(Type.Array(contextSchema, { maxItems: 32 })),
    attachments: Type.Optional(
      Type.Array(
        Type.Union([
          generatedImageAttachmentSchema,
          generatedVideoAttachmentSchema,
        ]),
        { maxItems: 4 },
      ),
    ),
    proposalId: Type.Optional(idSchema),
  },
  { additionalProperties: false },
);
const diffLineSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("meta"),
      Type.Literal("context"),
      Type.Literal("addition"),
      Type.Literal("deletion"),
    ]),
    text: Type.String({ maxLength: 100_000 }),
  },
  { additionalProperties: false },
);
const builtInResourcePackIdSchema = Type.Union([
  Type.Literal("bootstrap-icons"),
  Type.Literal("kenney-ui"),
  Type.Literal("kenney-1bit"),
]);
const binaryProjectFileSchema = Type.Object(
  {
    encoding: Type.Literal("base64"),
    mimeType: Type.String({ minLength: 1, maxLength: 120 }),
    byteLength: Type.Integer({ minimum: 1, maximum: 1024 * 1024 }),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    source: Type.Union([
      Type.Object(
        {
          kind: Type.Literal("builtin-h5-resource"),
          packId: builtInResourcePackIdSchema,
          path: Type.String({ minLength: 1, maxLength: 512 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          bundleSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          executable: Type.Boolean(),
          kind: Type.Literal("third-party-skill"),
          path: Type.String({ minLength: 1, maxLength: 512 }),
          skillId: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,79}$" }),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
const messageReferenceSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 240 }),
    values: Type.Optional(
      Type.Record(
        Type.String({ pattern: "^[A-Za-z][A-Za-z0-9]*$" }),
        Type.Union([Type.String({ maxLength: 4_000 }), Type.Number()]),
        { maxProperties: 16 },
      ),
    ),
  },
  { additionalProperties: false },
);
const proposalSchema = Type.Object(
  {
    id: idSchema,
    projectId: idSchema,
    conversationId: Type.Optional(idSchema),
    title: Type.String({ maxLength: 240 }),
    titleMessage: Type.Optional(messageReferenceSchema),
    kind: Type.Union([
      Type.Literal("agent"),
      Type.Literal("capability"),
      Type.Literal("manual"),
      Type.Literal("restore"),
    ]),
    status: Type.Union([Type.Literal("pending"), Type.Literal("applied")]),
    connectorId: idSchema,
    connector: Type.String({ maxLength: 240 }),
    createdAt: dateSchema,
    capabilityInstall: Type.Optional(
      Type.Object(
        {
          bundleSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          fileCount: Type.Integer({ minimum: 1, maximum: 256 }),
          kind: Type.Literal("skill"),
          skillId: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,79}$" }),
          totalBytes: Type.Integer({ minimum: 0, maximum: 2 * 1024 * 1024 }),
        },
        { additionalProperties: false },
      ),
    ),
    hunks: Type.Array(
      Type.Object(
        {
          id: idSchema,
          resourceId: idSchema,
          target: Type.String({ minLength: 1, maxLength: 2_000 }),
          operation: Type.Optional(
            Type.Union([Type.Literal("create"), Type.Literal("delete")]),
          ),
          createTarget: Type.Optional(
            Type.Object(
              {
                provider: Type.Union([
                  Type.Literal("google-docs"),
                  Type.Literal("google-sheets"),
                  Type.Literal("google-slides"),
                  Type.Literal("notion"),
                ]),
                connectorId: idSchema,
                accountId: idSchema,
                accountLabel: Type.String({ minLength: 1, maxLength: 1_024 }),
              },
              { additionalProperties: false },
            ),
          ),
          binaryFile: Type.Optional(binaryProjectFileSchema),
          baseVersion: Type.String({ minLength: 1, maxLength: 512 }),
          before: Type.String({ maxLength: 3_000_000 }),
          after: Type.String({ maxLength: 3_000_000 }),
          summary: Type.String({ maxLength: 1_000 }),
          summaryMessage: Type.Optional(messageReferenceSchema),
          lines: Type.Array(diffLineSchema, { maxItems: 200_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 256 },
    ),
    appliedReceiptId: Type.Optional(idSchema),
  },
  { additionalProperties: false },
);
const storageSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("memory") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("project-workspace"),
      binary: Type.Optional(binaryProjectFileSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("native-file"),
      locator: Type.String({ minLength: 1, maxLength: 4_000 }),
      access: Type.Union([Type.Literal("persistent"), Type.Literal("session")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("google-doc"),
      locator: Type.String({ minLength: 1, maxLength: 4_000 }),
      documentId: Type.String({ minLength: 20, maxLength: 200 }),
      accountId: idSchema,
      accountLabel: Type.String({ minLength: 1, maxLength: 320 }),
      writable: Type.Boolean(),
      trashable: Type.Boolean(),
      restorable: Type.Boolean(),
      trashed: Type.Boolean(),
      access: Type.Literal("persistent"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("google-sheet"),
      locator: Type.String({ minLength: 1, maxLength: 4_000 }),
      spreadsheetId: Type.String({ minLength: 20, maxLength: 200 }),
      sheetId: Type.Integer({ minimum: 0, maximum: 9_999_999_999 }),
      accountId: idSchema,
      accountLabel: Type.String({ minLength: 1, maxLength: 320 }),
      writable: Type.Boolean(),
      trashable: Type.Boolean(),
      restorable: Type.Boolean(),
      trashed: Type.Boolean(),
      access: Type.Literal("persistent"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("google-slide"),
      locator: Type.String({ minLength: 1, maxLength: 4_000 }),
      presentationId: Type.String({ minLength: 20, maxLength: 200 }),
      accountId: idSchema,
      accountLabel: Type.String({ minLength: 1, maxLength: 320 }),
      writable: Type.Boolean(),
      trashable: Type.Boolean(),
      restorable: Type.Boolean(),
      trashed: Type.Boolean(),
      access: Type.Literal("persistent"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("notion-page"),
      locator: Type.String({ minLength: 1, maxLength: 4_000 }),
      pageId: Type.String({ minLength: 32, maxLength: 36 }),
      accountId: idSchema,
      accountLabel: Type.String({ minLength: 1, maxLength: 320 }),
      writable: Type.Boolean(),
      trashable: Type.Boolean(),
      restorable: Type.Boolean(),
      trashed: Type.Boolean(),
      access: Type.Literal("persistent"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("source-file"),
      locator: Type.String({ minLength: 1, maxLength: 4_000 }),
      snapshotId: idSchema,
      sourceKind: Type.Union([
        Type.Literal("github-public"),
        Type.Literal("local-file"),
        Type.Literal("local-archive"),
        Type.Literal("pasted-text"),
        Type.Literal("public-archive"),
      ]),
      sourceLabel: Type.String({ minLength: 1, maxLength: 240 }),
      mountPath: Type.String({ minLength: 1, maxLength: 4_000 }),
      revision: Type.String({ minLength: 1, maxLength: 512 }),
      versionLabel: Type.String({ minLength: 1, maxLength: 512 }),
      manifestPath: Type.String({ minLength: 1, maxLength: 4_000 }),
      access: Type.Literal("persistent"),
    },
    { additionalProperties: false },
  ),
]);
const resourceSchema = Type.Object(
  {
    id: idSchema,
    projectId: idSchema,
    connectionId: idSchema,
    path: Type.String({ minLength: 1, maxLength: 4_000 }),
    content: Type.String({ maxLength: 3_000_000 }),
    version: Type.String({ minLength: 1, maxLength: 512 }),
    storage: storageSchema,
  },
  { additionalProperties: false },
);
const projectSchema = Type.Object(
  {
    id: idSchema,
    name: Type.String({ minLength: 1, maxLength: 80 }),
    symbol: Type.String({ minLength: 1, maxLength: 8 }),
    description: Type.String({ maxLength: 20_000 }),
    instructions: Type.String({ maxLength: 64 * 1024 }),
    memoryCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
    skillCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
    connectionCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
    resourceCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
  },
  { additionalProperties: false },
);
// Read-only compatibility shape. decodePersistedAppState strips this obsolete
// field before semantic validation or restoration and new snapshots omit it.
const legacyProjectArtifactSchema = Type.Object(
  {
    id: idSchema,
    projectId: idSchema,
    directory: Type.String({ minLength: 1, maxLength: 4_000 }),
    entryPath: Type.String({ minLength: 1, maxLength: 4_000 }),
    filePaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_000 }), {
      minItems: 1,
      maxItems: 512,
    }),
    kind: Type.Union([
      Type.Literal("web"),
      Type.Literal("document"),
      Type.Literal("data"),
      Type.Literal("code"),
      Type.Literal("file"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 80 }),
    addedAt: dateSchema,
    updatedAt: dateSchema,
    revision: Type.Integer({ minimum: 1 }),
    sourceConversationId: idSchema,
    sourceProposalId: idSchema,
  },
  { additionalProperties: false },
);
const receiptSchema = Type.Object(
  {
    id: idSchema,
    proposalId: idSchema,
    proposalTitle: Type.String({ maxLength: 240 }),
    projectId: idSchema,
    conversationId: idSchema,
    connectorId: idSchema,
    connector: Type.String({ maxLength: 240 }),
    appliedAt: dateSchema,
    changes: Type.Array(
      Type.Object(
        {
          hunkId: idSchema,
          resourceId: idSchema,
          target: Type.String({ minLength: 1, maxLength: 4_000 }),
          operation: Type.Optional(
            Type.Union([Type.Literal("create"), Type.Literal("delete")]),
          ),
          before: Type.String({ maxLength: 3_000_000 }),
          after: Type.String({ maxLength: 3_000_000 }),
          beforeVersion: Type.String({ minLength: 1, maxLength: 512 }),
          afterVersion: Type.String({ minLength: 1, maxLength: 512 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 256 },
    ),
    additions: Type.Integer({ minimum: 0 }),
    deletions: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
const checkpointSchema = Type.Object(
  {
    id: idSchema,
    conversationId: idSchema,
    projectId: idSchema,
    createdAt: dateSchema,
    baselineResources: Type.Array(resourceSchema, { maxItems: 1_000 }),
    latestResources: Type.Array(resourceSchema, { maxItems: 1_000 }),
    createdResourceIds: Type.Optional(
      Type.Array(idSchema, { maxItems: 1_000 }),
    ),
    deletedResourceIds: Type.Optional(
      Type.Array(idSchema, { maxItems: 1_000 }),
    ),
  },
  { additionalProperties: false },
);
const persistedRunSchema = Type.Object(
  {
    conversationId: idSchema,
    content: Type.String({ minLength: 1, maxLength: 4_000 }),
    hadAttachments: Type.Boolean(),
    runId: Type.Optional(idSchema),
  },
  { additionalProperties: false },
);
const customGlobalMemorySchema = Type.Object(
  {
    id: idSchema,
    text: Type.String({
      minLength: 1,
      maxLength: MAX_GLOBAL_MEMORY_CHARACTERS,
    }),
    scope: Type.Literal("global"),
    source: Type.String({ minLength: 1, maxLength: 240 }),
    sourceMessage: Type.Optional(messageReferenceSchema),
    projectIds: Type.Optional(Type.Array(idSchema, { maxItems: 0 })),
    pinned: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const customGlobalSkillSchema = Type.Object(
  {
    id: idSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 240 }),
    content: Type.String({
      minLength: 1,
      maxLength: MAX_GLOBAL_SKILL_CHARACTERS,
    }),
    risk: Type.Union([Type.Literal("read"), Type.Literal("propose")]),
    enabled: Type.Boolean(),
    scope: Type.Literal("global"),
    projectIds: Type.Array(idSchema, { maxItems: 0 }),
  },
  { additionalProperties: false },
);
export const persistedAppStateSchema = Type.Object(
  {
    version: Type.Literal(5),
    updatedAt: dateSchema,
    pinnedProjectIds: Type.Optional(Type.Array(idSchema, { maxItems: 500 })),
    recentProjectIds: Type.Optional(Type.Array(idSchema, { maxItems: 500 })),
    recentConversationIds: Type.Optional(
      Type.Array(idSchema, { maxItems: 500 }),
    ),
    selectedProjectId: nullableIdSchema,
    activeConversationId: idSchema,
    projects: Type.Array(projectSchema, { maxItems: 500 }),
    workspaceResources: Type.Array(resourceSchema, { maxItems: 4_000 }),
    projectArtifacts: Type.Optional(
      Type.Array(legacyProjectArtifactSchema, { maxItems: 2_000 }),
    ),
    conversations: Type.Array(
      Type.Object(
        {
          id: idSchema,
          projectId: nullableIdSchema,
          modelProfileId: Type.Optional(idSchema),
          messages: Type.Array(chatMessageSchema, { maxItems: 2_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 500 },
    ),
    projectConversations: Type.Array(
      Type.Object(
        { projectId: idSchema, conversationId: idSchema },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    skillSettings: Type.Array(
      Type.Object(
        { skillId: idSchema, enabled: Type.Boolean() },
        { additionalProperties: false },
      ),
      { maxItems: 1_000 },
    ),
    globalMemoryEdits: Type.Optional(
      Type.Array(
        Type.Object(
          {
            memoryId: idSchema,
            text: Type.String({
              minLength: 1,
              maxLength: MAX_GLOBAL_MEMORY_CHARACTERS,
            }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 1_000 },
      ),
    ),
    globalSkillEdits: Type.Optional(
      Type.Array(
        Type.Object(
          {
            skillId: idSchema,
            content: Type.String({
              minLength: 1,
              maxLength: MAX_GLOBAL_SKILL_CHARACTERS,
            }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 1_000 },
      ),
    ),
    customGlobalMemories: Type.Optional(
      Type.Array(customGlobalMemorySchema, { maxItems: 1_000 }),
    ),
    customGlobalSkills: Type.Optional(
      Type.Array(customGlobalSkillSchema, { maxItems: 1_000 }),
    ),
    projectSkillSettings: Type.Optional(
      Type.Array(
        Type.Object(
          { projectId: idSchema, skillId: idSchema, enabled: Type.Boolean() },
          { additionalProperties: false },
        ),
        { maxItems: 4_000 },
      ),
    ),
    projectResourcePackSettings: Type.Optional(
      Type.Array(
        Type.Object(
          {
            projectId: idSchema,
            packId: Type.Union([
              Type.Literal("bootstrap-icons"),
              Type.Literal("kenney-ui"),
              Type.Literal("kenney-1bit"),
            ]),
            enabled: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
        { maxItems: 2_000 },
      ),
    ),
    proposals: Type.Array(proposalSchema, { maxItems: 1_000 }),
    receipts: Type.Array(receiptSchema, { maxItems: 1_000 }),
    checkpoints: Type.Array(checkpointSchema, { maxItems: 500 }),
    lastReceiptId: nullableIdSchema,
    pendingRuns: Type.Array(persistedRunSchema, { maxItems: 3 }),
    retryableRuns: Type.Array(persistedRunSchema, { maxItems: 500 }),
  },
  { additionalProperties: false },
);
