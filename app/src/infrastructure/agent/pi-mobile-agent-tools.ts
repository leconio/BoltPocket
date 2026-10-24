import {
  adaptPiCodingToolDefinition,
  createAllToolDefinitions,
  type BashOperations,
  type EditOperations,
  type FindOperations,
  type GrepOperations,
  type LsOperations,
  type ReadOperations,
  type RuntimeTool,
  type WriteOperations,
} from "@boltpocket/agent-runtime";
import { canonicalizeGoogleSheetCsv } from "@boltpocket/connector-google-sheets";
import { canonicalizeGoogleSlidesText } from "@boltpocket/connector-google-slides";
import { canonicalizeNotionMarkdown } from "@boltpocket/connector-notion";
import type { McpProxyInput, McpProxyPort } from "@boltpocket/mcp-client";
import { GLOBAL_MCP_SCOPE_ID } from "@/application/ports/mcp-connections";
import { Type } from "typebox";

import type {
  AgentBrowserControlInput,
  AgentBrowserControlPort,
} from "@/application/ports/browser-control";
import type {
  AgentCredentialAccessPort,
  CredentialSecret,
} from "@/application/ports/credential-vault";
import type { AgentMediaAnalysisPort } from "@/application/ports/media-analysis";
import type { AgentImageGenerationPort } from "@/application/ports/image-generation";
import type { AgentVideoGenerationPort } from "@/application/ports/video-generation";
import type { AgentTextDelegationPort } from "@/application/ports/text-delegation";
import type { ProjectPreviewSnapshotPort } from "@/application/ports/project-preview";
import type { ProjectResourceFilePort } from "@/application/ports/project-resource-files";
import type { AgentSshCredentialConnectionPort } from "@/application/ports/ssh-command-sessions";
import type { AgentThirdPartyCapabilityPort } from "@/application/ports/third-party-capabilities";
import type { AgentDeviceCapabilityPort } from "@/application/ports/device-capabilities";
import { DEVICE_PROFILES_PROJECT_PATH } from "@/infrastructure/device/device-profiles";
import type { AgentSkillMarketPublicationPort } from "@/application/ports/skill-market-publication";
import {
  isProjectWorkspaceConnectionId,
  isProjectWorkspaceResource,
} from "@/domain/project-workspace";
import { createTextDiffLines } from "@/domain/text-diff";
import {
  builtInProjectResourcePack,
  builtInProjectResourceFile,
  isBuiltInProjectResourcePackId,
  projectResourceCopyPaths,
  projectResourceH5Path,
  projectResourceSkillId,
  searchBuiltInProjectResources,
} from "@/domain/builtin-project-resources";
import {
  projectResourceRefsById,
  type ActiveRunContext,
} from "@/infrastructure/agent/pi-mobile-agent-context";
import {
  createAgentJavaScriptTool,
  type AgentJavaScriptExecutor,
} from "@/infrastructure/agent/pi-mobile-agent-javascript";
import { captureConversationSecrets } from "@/infrastructure/security/conversation-secret-capture";
import { createSessionResources } from "@/infrastructure/agent/pi-mobile-agent-session";
import {
  PROJECT_SHELL_ROOT,
  projectShellPathForResource,
  projectShellRootForConnection,
} from "@/infrastructure/agent/workspace-project-shell";
import type { WorkspacePiCodingTools } from "@/infrastructure/agent/workspace-pi-coding-tools";
import type { MessageKey, MessageValues } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/translate";

const readContextParameters = Type.Object({}, { additionalProperties: false });
const skillReadParameters = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
const deviceParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("status"),
      Type.Literal("power"),
      Type.Literal("storage"),
      Type.Literal("network"),
      Type.Literal("location_current"),
      Type.Literal("wifi_current"),
      Type.Literal("wifi_scan"),
      Type.Literal("bluetooth_scan"),
      Type.Literal("bluetooth_services"),
      Type.Literal("bluetooth_read"),
      Type.Literal("bluetooth_subscribe"),
      Type.Literal("bluetooth_write"),
      Type.Literal("bluetooth_recover"),
      Type.Literal("http_request"),
      Type.Literal("tcp_exchange"),
      Type.Literal("udp_exchange"),
      Type.Literal("profiles"),
      Type.Literal("profile_execute"),
      Type.Literal("profile_recover"),
      Type.Literal("external_app_open"),
      Type.Literal("calendar_list"),
      Type.Literal("calendar_events"),
      Type.Literal("calendar_create"),
      Type.Literal("calendar_update"),
      Type.Literal("calendar_delete"),
      Type.Literal("calendar_recover"),
      Type.Literal("reminder_list"),
      Type.Literal("reminder_create"),
      Type.Literal("reminder_update"),
      Type.Literal("reminder_delete"),
      Type.Literal("reminder_recover"),
      Type.Literal("sensors_list"),
      Type.Literal("sensor_read"),
      Type.Literal("audio_play"),
      Type.Literal("audio_pause"),
      Type.Literal("audio_resume"),
      Type.Literal("audio_seek"),
      Type.Literal("audio_status"),
      Type.Literal("audio_stop"),
    ]),
    purpose: Type.String({
      minLength: 1,
      maxLength: 240,
      description:
        "Concrete user-facing reason this exact device operation is needed.",
    }),
    profileId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    profileActionId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 64 }),
    ),
    deviceId: Type.Optional(
      Type.String({
        minLength: 28,
        maxLength: 28,
        pattern: "^ble-[a-f0-9]{24}$",
        description: "Temporary deviceId returned by a recent BLE scan.",
      }),
    ),
    recoveryId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    serviceUuid: Type.Optional(
      Type.String({
        minLength: 4,
        maxLength: 36,
        description:
          "BLE service UUID from service discovery; 16-bit, 32-bit, and canonical UUID forms are accepted.",
      }),
    ),
    characteristicUuid: Type.Optional(
      Type.String({
        minLength: 4,
        maxLength: 36,
        description:
          "BLE characteristic UUID from service discovery; 16-bit, 32-bit, and canonical UUID forms are accepted.",
      }),
    ),
    valueBase64: Type.Optional(
      Type.String({
        maxLength: 684,
        description:
          "Binary BLE value as base64. Supply exactly one of valueBase64 or valueText.",
      }),
    ),
    valueText: Type.Optional(
      Type.String({
        maxLength: 512,
        description:
          "UTF-8 BLE value. Supply exactly one of valueText or valueBase64.",
      }),
    ),
    url: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 2_048,
        description:
          "Exact URL for local HTTP, external app handoff, or audio playback. Action-specific validation is enforced by the host.",
      }),
    ),
    method: Type.Optional(
      Type.Union([Type.Literal("GET"), Type.Literal("HEAD")]),
    ),
    host: Type.Optional(Type.String({ minLength: 1, maxLength: 253 })),
    port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
    requestBase64: Type.Optional(
      Type.String({
        maxLength: 87_384,
        description:
          "Binary TCP/UDP query as base64. Supply exactly one of requestBase64 or requestText.",
      }),
    ),
    requestText: Type.Optional(
      Type.String({
        maxLength: 65_536,
        description:
          "UTF-8 TCP/UDP query. Supply exactly one of requestText or requestBase64.",
      }),
    ),
    maxResponseBytes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 262_144 }),
    ),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 250, maximum: 30_000 })),
    durationMs: Type.Optional(Type.Integer({ minimum: 250, maximum: 30_000 })),
    calendarId: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    eventId: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    reminderId: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    startAt: Type.Optional(Type.String({ minLength: 10, maxLength: 64 })),
    endAt: Type.Optional(Type.String({ minLength: 10, maxLength: 64 })),
    dueAt: Type.Optional(Type.String({ minLength: 10, maxLength: 64 })),
    title: Type.Optional(Type.String({ maxLength: 240 })),
    notes: Type.Optional(Type.String({ maxLength: 8_000 })),
    location: Type.Optional(Type.String({ maxLength: 500 })),
    timeZone: Type.Optional(Type.String({ maxLength: 120 })),
    allDay: Type.Optional(Type.Boolean()),
    completed: Type.Optional(Type.Boolean()),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    sensorType: Type.Optional(
      Type.Union([
        Type.Literal("accelerometer"),
        Type.Literal("gyroscope"),
        Type.Literal("magnetometer"),
        Type.Literal("magnetometer-uncalibrated"),
        Type.Literal("device-motion"),
        Type.Literal("barometer"),
        Type.Literal("light"),
        Type.Literal("pedometer"),
      ]),
    ),
    intervalMs: Type.Optional(Type.Integer({ minimum: 20, maximum: 1_000 })),
    positionSeconds: Type.Optional(
      Type.Number({ minimum: 0, maximum: 86_400 }),
    ),
    volume: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    loop: Type.Optional(Type.Boolean()),
    artist: Type.Optional(Type.String({ maxLength: 160 })),
    album: Type.Optional(Type.String({ maxLength: 160 })),
    artworkUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    playbackId: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  },
  { additionalProperties: false },
);
const credentialListParameters = Type.Object(
  {},
  { additionalProperties: false },
);
const credentialAccessParameters = Type.Object(
  {
    credentialId: Type.String({ minLength: 1, maxLength: 120 }),
    purpose: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);
const mcpProxyParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("status"),
      Type.Literal("list"),
      Type.Literal("search"),
      Type.Literal("schema"),
      Type.Literal("call"),
      Type.Literal("ping"),
      Type.Literal("prompts"),
      Type.Literal("get-prompt"),
      Type.Literal("resources"),
      Type.Literal("resource-templates"),
      Type.Literal("read-resource"),
      Type.Literal("complete"),
    ]),
    serverId: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    toolName: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    promptName: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    uri: Type.Optional(Type.String({ minLength: 1, maxLength: 8_192 })),
    completionRefType: Type.Optional(
      Type.Union([Type.Literal("prompt"), Type.Literal("resource")]),
    ),
    completionArgumentName: Type.Optional(
      Type.String({ minLength: 1, maxLength: 240 }),
    ),
    completionArgumentValue: Type.Optional(Type.String({ maxLength: 8_000 })),
    arguments: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1, maxLength: 240 }),
        Type.Unknown(),
        {
          maxProperties: 100,
        },
      ),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    refresh: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const thirdPartyCapabilityAssessParameters = Type.Object(
  {
    kind: Type.Union([Type.Literal("skill"), Type.Literal("mcp")]),
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    authentication: Type.Optional(
      Type.Union([Type.Literal("none"), Type.Literal("oauth")]),
    ),
  },
  { additionalProperties: false },
);
const thirdPartyCapabilityInstallParameters = Type.Object(
  {
    assessmentId: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);
const skillMarketReviewParameters = Type.Object(
  {
    skillId: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z0-9][a-z0-9._-]{0,79}$",
    }),
  },
  { additionalProperties: false },
);
const skillMarketPublishParameters = Type.Object(
  {
    skillId: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z0-9][a-z0-9._-]{0,79}$",
    }),
    reviewHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    publisherName: Type.String({ minLength: 2, maxLength: 48 }),
    category: Type.Union([
      Type.Literal("engineering"),
      Type.Literal("operations"),
      Type.Literal("privacy"),
      Type.Literal("productivity"),
      Type.Literal("research"),
      Type.Literal("writing"),
    ]),
    license: Type.Union([
      Type.Literal("Apache-2.0"),
      Type.Literal("CC0-1.0"),
      Type.Literal("MIT"),
    ]),
    tags: Type.Array(
      Type.String({
        minLength: 1,
        maxLength: 24,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      }),
      { minItems: 1, maxItems: 5, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
);
const mediaAnalysisParameters = Type.Object(
  {
    question: Type.String({ minLength: 1, maxLength: 4_000 }),
    attachmentIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
      }),
    ),
  },
  { additionalProperties: false },
);
const imageGenerationParameters = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      maxLength: 4_000,
      description:
        "Self-contained visual description for one image. Include subject, composition, style, lighting, text requirements, and exclusions that matter.",
    }),
  },
  { additionalProperties: false },
);
const videoGenerationParameters = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      maxLength: 8_000,
      description:
        "Self-contained video direction including subject, action, scene, camera movement, visual style, lighting, pacing, and audio intent when relevant.",
    }),
    ratio: Type.Optional(
      Type.Union([
        Type.Literal("16:9"),
        Type.Literal("9:16"),
        Type.Literal("1:1"),
        Type.Literal("4:3"),
        Type.Literal("3:4"),
        Type.Literal("21:9"),
      ]),
    ),
    durationSeconds: Type.Optional(Type.Integer({ minimum: 2, maximum: 15 })),
    generateAudio: Type.Optional(Type.Boolean()),
    attachmentIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
        minItems: 1,
        maxItems: 9,
        uniqueItems: true,
      }),
    ),
    referenceUrls: Type.Optional(
      Type.Array(
        Type.Object(
          {
            type: Type.Union([
              Type.Literal("image_url"),
              Type.Literal("video_url"),
              Type.Literal("audio_url"),
            ]),
            url: Type.String({ minLength: 9, maxLength: 4_096 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 9 },
      ),
    ),
  },
  { additionalProperties: false },
);
const textDelegationParameters = Type.Object(
  {
    agent: Type.Union([
      Type.Literal("scout"),
      Type.Literal("planner"),
      Type.Literal("reviewer"),
    ]),
    task: Type.String({
      minLength: 1,
      maxLength: 12_000,
      description:
        "Self-contained task. The child does not inherit the parent conversation, so include the relevant goal, constraints, and known facts without credentials.",
    }),
    description: Type.String({
      minLength: 1,
      maxLength: 80,
      description: "Short 3-8 word task label shown in the activity UI.",
    }),
  },
  { additionalProperties: false },
);
const sshpassParameters = Type.Object(
  {
    credentialId: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);
const browserParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("open"),
      Type.Literal("close"),
      Type.Literal("status"),
      Type.Literal("snapshot"),
      Type.Literal("read_text"),
      Type.Literal("find_text"),
      Type.Literal("wait_for_text"),
      Type.Literal("navigate"),
      Type.Literal("click"),
      Type.Literal("type"),
      Type.Literal("follow_link"),
      Type.Literal("highlight"),
      Type.Literal("scroll"),
      Type.Literal("back"),
      Type.Literal("forward"),
      Type.Literal("reload"),
    ]),
    taskId: Type.Optional(
      Type.String({ pattern: "^browser-[A-Za-z0-9-]{1,180}$" }),
    ),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    revision: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 256_000 })),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    text: Type.Optional(Type.String({ maxLength: 4_000 })),
    condition: Type.Optional(
      Type.Union([Type.Literal("present"), Type.Literal("absent")]),
    ),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5_000 })),
    targetId: Type.Optional(
      Type.String({ pattern: "^control-[1-9]\\d{0,2}$" }),
    ),
    direction: Type.Optional(
      Type.Union([Type.Literal("up"), Type.Literal("down")]),
    ),
  },
  { additionalProperties: false },
);
const projectPreviewParameters = Type.Object(
  {
    entryPath: Type.String({
      minLength: 1,
      maxLength: 2_000,
      pattern:
        "^/project(?:/[^/\\u0000-\\u001f\\u007f]+)+\\.[hH][tT][mM][lL]?$",
    }),
    present: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const projectResourceCatalogParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("list_packs"),
      Type.Literal("list_files"),
      Type.Literal("search"),
    ]),
    packId: Type.Optional(
      Type.Union([
        Type.Literal("bootstrap-icons"),
        Type.Literal("kenney-ui"),
        Type.Literal("kenney-1bit"),
      ]),
    ),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 5_000 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
const projectResourceCopyParameters = Type.Object(
  {
    appRoot: Type.String({
      minLength: 15,
      maxLength: 240,
      pattern: "^/project/apps/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$",
    }),
    packId: Type.Union([
      Type.Literal("bootstrap-icons"),
      Type.Literal("kenney-ui"),
      Type.Literal("kenney-1bit"),
    ]),
    paths: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
const documentCreateParameters = Type.Object(
  {
    connectorId: Type.String({ minLength: 1, maxLength: 240 }),
    title: Type.String({ minLength: 1, maxLength: 1_000 }),
    content: Type.String({ maxLength: 100_000 }),
  },
  { additionalProperties: false },
);

function stableDocumentResourceId(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

type PiMobileAgentToolDependencies = {
  requiredContext: () => ActiveRunContext;
  projectTools: () => Promise<WorkspacePiCodingTools>;
  executeProjectBash: BashOperations["exec"];
  activateSkillTools?: (skillName: string) => Promise<readonly string[]>;
  protectSkillContent?: (skillName: string, content: string) => string;
  executeJavaScript?: AgentJavaScriptExecutor;
  mcpProxy?: McpProxyPort;
  thirdPartyCapabilities?: AgentThirdPartyCapabilityPort;
  skillMarketPublication?: AgentSkillMarketPublicationPort;
  locale: AppLocale;
  credentialAccess?: AgentCredentialAccessPort;
  sshCredentialConnection?: AgentSshCredentialConnectionPort;
  browserControl?: AgentBrowserControlPort;
  projectPreview?: ProjectPreviewSnapshotPort;
  projectResourceFiles?: ProjectResourceFilePort;
  mediaAnalysis?: AgentMediaAnalysisPort;
  imageGeneration?: AgentImageGenerationPort;
  videoGeneration?: AgentVideoGenerationPort;
  textDelegation?: AgentTextDelegationPort;
  deviceCapabilities?: AgentDeviceCapabilityPort;
  translate: (key: MessageKey, values?: MessageValues) => string;
  registerSensitiveValue: (value: string) => string;
};

const PI_MOBILE_SKILL_TOOL_GROUPS = Object.freeze({
  "build-h5": ["preview_project"],
  "install-capabilities": [
    "third_party_capability_assess",
    "third_party_capability_install",
  ],
  "publish-skill": ["skill_market_review", "skill_market_publish"],
  "operate-browser": ["browser", "preview_project"],
  "operate-device": ["device"],
  "manage-calendar-reminders": ["device"],
  "read-device-sensors": ["device"],
  "play-device-audio": ["device"],
  "operate-ssh": ["sshpass"],
  "use-bootstrap-icons": ["project_resource_catalog", "project_resource_copy"],
  "use-h5-resources": ["project_resource_catalog", "project_resource_copy"],
  "use-kenney-1bit": ["project_resource_catalog", "project_resource_copy"],
  "use-kenney-ui": ["project_resource_catalog", "project_resource_copy"],
} satisfies Readonly<Record<string, readonly string[]>>);

const PI_MOBILE_SKILL_GATED_TOOL_NAMES = new Set(
  Object.values(PI_MOBILE_SKILL_TOOL_GROUPS).flat(),
);

// Device access is already bounded by the user's three-state app policy and
// the platform permission dialog. Keeping its host tool visible avoids an
// unrelated hidden activation gate before those explicit controls can run.
const PI_MOBILE_PERMISSION_BROKERED_BASE_TOOL_NAMES = new Set(["device"]);

/** Tools visible before the Agent loads a task-matching Skill. */
export function basePiMobileAgentToolNames(
  tools: readonly Pick<RuntimeTool, "name">[],
) {
  return tools
    .map((tool) => tool.name)
    .filter(
      (name) =>
        !PI_MOBILE_SKILL_GATED_TOOL_NAMES.has(name) ||
        PI_MOBILE_PERMISSION_BROKERED_BASE_TOOL_NAMES.has(name),
    );
}

/** Registered tools unlocked by one exact in-memory Skill name. */
export function piMobileAgentToolNamesForSkill(
  skillName: string,
  tools: readonly Pick<RuntimeTool, "name">[],
) {
  const requested = new Set(
    PI_MOBILE_SKILL_TOOL_GROUPS[
      skillName as keyof typeof PI_MOBILE_SKILL_TOOL_GROUPS
    ] ?? [],
  );
  return tools.map((tool) => tool.name).filter((name) => requested.has(name));
}

/** Durable tool names that remain valid for the currently enabled Skills. */
export function restorablePiMobileAgentToolNames(
  skillNames: Iterable<string>,
  tools: readonly Pick<RuntimeTool, "name">[],
) {
  const allowed = new Set(basePiMobileAgentToolNames(tools));
  for (const skillName of skillNames) {
    for (const toolName of piMobileAgentToolNamesForSkill(skillName, tools)) {
      allowed.add(toolName);
    }
  }
  return tools.map((tool) => tool.name).filter((name) => allowed.has(name));
}

function markedCredentialSecret(
  secret: CredentialSecret,
  registerSensitiveValue: (value: string) => string,
) {
  if (secret.kind === "password") {
    return { password: registerSensitiveValue(secret.password) };
  }
  if (secret.kind === "ssh") {
    if (secret.authentication === "password") {
      return {
        authentication: secret.authentication,
        password: registerSensitiveValue(secret.password),
      };
    }
    return {
      authentication: secret.authentication,
      privateKey: registerSensitiveValue(secret.privateKey),
      ...(secret.publicKey
        ? { publicKey: registerSensitiveValue(secret.publicKey) }
        : {}),
      ...(secret.passphrase
        ? { passphrase: registerSensitiveValue(secret.passphrase) }
        : {}),
    };
  }
  if (secret.kind === "api-token") {
    return { token: registerSensitiveValue(secret.token) };
  }
  return { value: registerSensitiveValue(secret.value) };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mcpTextBlocks(value: unknown) {
  const direct = recordValue(value);
  const bounded = recordValue(direct?.value) ?? direct;
  if (!Array.isArray(bounded?.content)) return [];
  return bounded.content
    .map((block) => recordValue(block))
    .filter(
      (block): block is Record<string, unknown> =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) =>
      String(block.text)
        .replace(/[\r\n\0]+/gu, " ")
        .trim(),
    )
    .filter(Boolean);
}

function mcpProxyFailureReason(value: unknown) {
  const result = recordValue(value);
  if (!result) return undefined;
  if (result.action === "call" && result.isError === true) {
    return (
      mcpTextBlocks(result.result).join(" · ").slice(0, 1_000) ||
      "MCP server returned an error."
    );
  }
  if (result.action !== "list" && result.action !== "search") {
    return undefined;
  }
  const matches = result.action === "list" ? result.tools : result.matches;
  if (
    !Array.isArray(matches) ||
    matches.length > 0 ||
    !Array.isArray(result.errors)
  ) {
    return undefined;
  }
  const errors = result.errors
    .map((entry) => recordValue(entry))
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry?.error === "string",
    )
    .slice(0, 3)
    .map((entry) => {
      const server =
        typeof entry.serverName === "string" ? `${entry.serverName}: ` : "";
      return `${server}${String(entry.error)}`;
    });
  return errors.length ? errors.join(" · ").slice(0, 1_000) : undefined;
}

export function createPiMobileAgentTools({
  requiredContext,
  projectTools,
  executeProjectBash,
  activateSkillTools,
  protectSkillContent,
  executeJavaScript,
  mcpProxy,
  thirdPartyCapabilities,
  skillMarketPublication,
  locale,
  credentialAccess,
  sshCredentialConnection,
  browserControl,
  projectPreview,
  projectResourceFiles,
  mediaAnalysis,
  imageGeneration,
  videoGeneration,
  textDelegation,
  deviceCapabilities,
  translate,
  registerSensitiveValue,
}: PiMobileAgentToolDependencies): RuntimeTool[] {
  const mcpTools = [];
  if (mcpProxy) {
    mcpTools.push({
      name: "mcp",
      label: "MCP 工具代理",
      description:
        "Use the app-global MCP services through one lazy Streamable HTTP proxy. For a named external service or account, use search to find the capability, schema before call, and status when connection state matters. Tool calls can include writes: local allow-lists are enforced, writes/unknown effects and approveTools matches pause for host approval after exact server, tool, and arguments are known. The proxy also supports prompts, resources, templates, completion, and ping. Credentials remain host-managed.",
      risk: "propose",
      parameters: mcpProxyParameters,
      executionMode: "sequential",
      execute: async (parameters, context) => {
        const active = requiredContext();
        const project = active.input.project;
        let input: McpProxyInput;
        if (parameters.action === "status") {
          input = { action: "status" };
        } else if (parameters.action === "list") {
          input = {
            action: "list",
            ...(parameters.serverId ? { serverId: parameters.serverId } : {}),
            ...(parameters.limit === undefined
              ? {}
              : { limit: parameters.limit }),
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else if (parameters.action === "search") {
          if (!parameters.query) throw new Error("MCP search 需要 query。");
          input = {
            action: "search",
            query: parameters.query,
            ...(parameters.serverId ? { serverId: parameters.serverId } : {}),
            ...(parameters.limit === undefined
              ? {}
              : { limit: parameters.limit }),
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else if (parameters.action === "schema") {
          if (!parameters.serverId || !parameters.toolName) {
            throw new Error("MCP schema 需要 serverId 和 toolName。");
          }
          input = {
            action: "schema",
            serverId: parameters.serverId,
            toolName: parameters.toolName,
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else if (parameters.action === "call") {
          if (!parameters.serverId || !parameters.toolName) {
            throw new Error("MCP call 需要 serverId 和 toolName。");
          }
          input = {
            action: "call",
            serverId: parameters.serverId,
            toolName: parameters.toolName,
            ...(parameters.arguments === undefined
              ? {}
              : { arguments: parameters.arguments }),
          };
        } else if (parameters.action === "ping") {
          if (!parameters.serverId) throw new Error("MCP ping 需要 serverId。");
          input = { action: "ping", serverId: parameters.serverId };
        } else if (parameters.action === "prompts") {
          if (!parameters.serverId)
            throw new Error("MCP prompts 需要 serverId。");
          input = {
            action: "prompts",
            serverId: parameters.serverId,
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else if (parameters.action === "get-prompt") {
          if (!parameters.serverId || !parameters.promptName) {
            throw new Error("MCP get-prompt 需要 serverId 和 promptName。");
          }
          input = {
            action: "get-prompt",
            serverId: parameters.serverId,
            promptName: parameters.promptName,
            ...(parameters.arguments === undefined
              ? {}
              : {
                  arguments: Object.fromEntries(
                    Object.entries(parameters.arguments).map(([key, value]) => [
                      key,
                      String(value),
                    ]),
                  ),
                }),
          };
        } else if (parameters.action === "resources") {
          if (!parameters.serverId)
            throw new Error("MCP resources 需要 serverId。");
          input = {
            action: "resources",
            serverId: parameters.serverId,
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else if (parameters.action === "resource-templates") {
          if (!parameters.serverId) {
            throw new Error("MCP resource-templates 需要 serverId。");
          }
          input = {
            action: "resource-templates",
            serverId: parameters.serverId,
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else if (parameters.action === "read-resource") {
          if (!parameters.serverId || !parameters.uri) {
            throw new Error("MCP read-resource 需要 serverId 和 uri。");
          }
          input = {
            action: "read-resource",
            serverId: parameters.serverId,
            uri: parameters.uri,
            ...(parameters.refresh === undefined
              ? {}
              : { refresh: parameters.refresh }),
          };
        } else {
          if (
            !parameters.serverId ||
            !parameters.completionRefType ||
            !parameters.completionArgumentName ||
            parameters.completionArgumentValue === undefined ||
            (parameters.completionRefType === "prompt" &&
              !parameters.promptName) ||
            (parameters.completionRefType === "resource" && !parameters.uri)
          ) {
            throw new Error("MCP complete 参数不完整。");
          }
          input = {
            action: "complete",
            serverId: parameters.serverId,
            ref:
              parameters.completionRefType === "prompt"
                ? { type: "ref/prompt", name: parameters.promptName! }
                : { type: "ref/resource", uri: parameters.uri! },
            argument: {
              name: parameters.completionArgumentName,
              value: parameters.completionArgumentValue,
            },
          };
        }
        const result = await mcpProxy.execute(
          GLOBAL_MCP_SCOPE_ID,
          input,
          context.signal,
          {
            approvalSessionId: context.sessionId,
            projectName: project?.name ?? "BoltPocket",
          },
        );
        const failureReason = mcpProxyFailureReason(result);
        if (failureReason) throw new Error(failureReason);
        return {
          content: JSON.stringify(result),
          details: { action: parameters.action },
        };
      },
    } satisfies RuntimeTool<typeof mcpProxyParameters>);
  }
  const thirdPartyCapabilityTools = [];
  if (thirdPartyCapabilities) {
    thirdPartyCapabilityTools.push(
      {
        name: "third_party_capability_assess",
        label: "体检第三方 Skill 或 MCP",
        description:
          "Inspect one exact user-provided third-party Skill or MCP URL without installing or executing it. For Skills, the host verifies the complete bounded package; for MCP, it performs only Streamable HTTP handshake, ping, and tools/list. Follow the already-loaded install-capabilities Skill for workflow and report formatting.",
        risk: "read",
        parameters: thirdPartyCapabilityAssessParameters,
        executionMode: "sequential",
        execute: async (parameters, context) => {
          const active = requiredContext();
          const project = active.input.project;
          if (!project) {
            throw new Error(
              "当前对话没有绑定项目，不能体检或安装第三方 Skill/MCP。",
            );
          }
          const report = await thirdPartyCapabilities.assess(
            {
              kind: parameters.kind,
              url: parameters.url,
              ...(parameters.name ? { name: parameters.name } : {}),
              ...(parameters.authentication
                ? { authentication: parameters.authentication }
                : {}),
              conversationId: active.input.conversationId,
              projectId: project.id,
              projectName: project.name,
              runId: active.input.runId,
            },
            context.signal,
          );
          return {
            content: JSON.stringify(report),
            details: {
              assessmentId: report.assessmentId,
              installable: report.installable,
              kind: report.kind,
              status: report.status,
            },
          };
        },
      } satisfies RuntimeTool<typeof thirdPartyCapabilityAssessParameters>,
      {
        name: "third_party_capability_install",
        label: "安装已确认的第三方 Skill 或 MCP",
        description:
          "Install the exact still-valid assessmentId produced by a prior compatibility assessment. The host enforces later-turn user confirmation, project and conversation bindings, expiry, compatibility, and atomic complete-package installation. Follow the already-loaded install-capabilities Skill.",
        risk: "propose",
        parameters: thirdPartyCapabilityInstallParameters,
        executionMode: "sequential",
        execute: async ({ assessmentId }, context) => {
          const active = requiredContext();
          const project = active.input.project;
          if (!project) {
            throw new Error("当前对话没有绑定项目，不能安装第三方 Skill/MCP。");
          }
          const result = await thirdPartyCapabilities.install(
            {
              assessmentId,
              conversationId: active.input.conversationId,
              latestUserPrompt: active.input.prompt,
              projectId: project.id,
              runId: active.input.runId,
            },
            context.signal,
          );
          return {
            content: JSON.stringify(result),
            details: {
              assessmentId: result.assessmentId,
              itemId: result.itemId,
              kind: result.kind,
              list: result.list,
            },
          };
        },
      } satisfies RuntimeTool<typeof thirdPartyCapabilityInstallParameters>,
    );
  }
  const skillMarketPublicationTools = [];
  if (skillMarketPublication) {
    skillMarketPublicationTools.push(
      {
        name: "skill_market_review",
        label: "审核待发布 Skill",
        description:
          "Review the exact current project's skills/<skillId>/SKILL.md and public README.md for format, credentials, personal data, unsafe instructions, and publication boundaries. The host reads both files directly, never accepts their contents as tool arguments, and returns only hashes plus redacted findings. Follow the loaded publish-skill Skill.",
        risk: "read",
        parameters: skillMarketReviewParameters,
        executionMode: "sequential",
        execute: async ({ skillId }, context) => {
          const active = requiredContext();
          const project = active.input.project;
          if (!project) {
            throw new Error("当前对话没有绑定项目，不能审核或发布 Skill。");
          }
          const review = await skillMarketPublication.review(
            {
              conversationId: active.input.conversationId,
              projectId: project.id,
              runId: active.input.runId,
              skillId,
            },
            context.signal,
          );
          return {
            content: JSON.stringify(review),
            details: {
              blockerCount: review.findings.filter(
                ({ severity }) => severity === "blocker",
              ).length,
              findingCount: review.findings.length,
              reviewHash: review.reviewHash,
              status: review.status,
            },
          };
        },
      } satisfies RuntimeTool<typeof skillMarketReviewParameters>,
      {
        name: "skill_market_publish",
        label: "发布已审核 Skill",
        description:
          "Publish the exact project Skill bound to a passing reviewHash. The host re-reads and re-reviews SKILL.md and README.md, preflights the account-owned revision, applies a deterministic hash-bound publication patch, and returns its receipt and recovery handle. The latest user message must explicitly request publication.",
        risk: "propose",
        parameters: skillMarketPublishParameters,
        executionMode: "sequential",
        execute: async (parameters, context) => {
          const active = requiredContext();
          const project = active.input.project;
          if (!project) {
            throw new Error("当前对话没有绑定项目，不能发布 Skill。");
          }
          const result = await skillMarketPublication.publish(
            {
              ...parameters,
              conversationId: active.input.conversationId,
              latestUserPrompt: active.input.prompt,
              projectId: project.id,
              runId: active.input.runId,
            },
            context.signal,
          );
          return {
            content: JSON.stringify(result),
            details: {
              entryId: result.entryId,
              patchSha256: result.patch.sha256,
              receiptId: result.receipt.id,
              revision: result.revision,
            },
          };
        },
      } satisfies RuntimeTool<typeof skillMarketPublishParameters>,
    );
  }
  const readContextTool: RuntimeTool<typeof readContextParameters> = {
    name: "project_context_read",
    label: "Read project context",
    description:
      "Read the current conversation's owning project, shared workspace contract, instructions, authorized text resources, and imported read-only source-tree roots. Use this before answering with project facts or operating on project files.",
    risk: "read",
    parameters: readContextParameters,
    execute: async () => {
      const active = requiredContext();
      const context = {
        memories: active.input.memories.map((item) => ({
          id: item.id,
          text: item.text,
          scope: item.scope,
          source: item.source,
        })),
        skills: active.input.skills
          .filter((item) => item.enabled)
          .map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            risk: item.risk,
          })),
      };
      if (!active.input.project) {
        return {
          content: JSON.stringify({
            run: { runId: active.input.runId },
            conversation: {
              id: active.input.conversationId,
              projectId: null,
              historySharedWithOtherConversations: false,
            },
            project: null,
            workspace: {
              root: PROJECT_SHELL_ROOT,
              sharedAcrossProjectConversations: false,
            },
            ...context,
            connectors: [],
            sourceTrees: [],
            resources: [],
            resourcePacks: [],
          }),
          details: {
            memoryCount: context.memories.length,
            skillCount: context.skills.length,
            connectorCount: 0,
            resourceCount: 0,
            resourcePackCount: 0,
          },
        };
      }
      const descriptors = active.registry
        .descriptors(active.input.project.id)
        .filter((descriptor) => !isProjectWorkspaceConnectionId(descriptor.id));
      const refs = await active.registry.listResources(active.input.project.id);
      projectResourceRefsById(active.input.project.id, refs);
      const workspaceResourcesById = new Map(
        active.input.resources
          .filter((resource) => resource.projectId === active.input.project!.id)
          .map((resource) => [resource.id, resource]),
      );
      const projectWorkspaceFiles = [...workspaceResourcesById.values()]
        .filter(isProjectWorkspaceResource)
        .map((resource) => resource.path)
        .sort((left, right) => left.localeCompare(right, "en"));
      const sourceTreesByConnection = new Map<
        string,
        {
          connectorId: string;
          sourceKind: string;
          sourceLabel: string;
          mountPath: string;
          revision: string;
          versionLabel: string;
          manifestPath: string;
          fileCount: number;
        }
      >();
      for (const resource of workspaceResourcesById.values()) {
        if (resource.storage.kind !== "source-file") continue;
        const existing = sourceTreesByConnection.get(resource.connectionId);
        if (existing) {
          existing.fileCount += 1;
          continue;
        }
        sourceTreesByConnection.set(resource.connectionId, {
          connectorId: resource.connectionId,
          sourceKind: resource.storage.sourceKind,
          sourceLabel: resource.storage.sourceLabel,
          mountPath: resource.storage.mountPath,
          revision: resource.storage.revision,
          versionLabel: resource.storage.versionLabel,
          manifestPath: resource.storage.manifestPath,
          fileCount: 1,
        });
      }
      return {
        content: JSON.stringify({
          run: { runId: active.input.runId },
          conversation: {
            id: active.input.conversationId,
            projectId: active.input.project.id,
            historySharedWithOtherConversations: false,
          },
          project: {
            id: active.input.project.id,
            name: active.input.project.name,
            description: active.input.project.description,
            instructions: active.input.project.instructions,
          },
          workspace: {
            root: PROJECT_SHELL_ROOT,
            sharedAcrossProjectConversations: true,
            files: projectWorkspaceFiles,
            memory: {
              authority: "recall-only",
              durable: "/project/MEMORY.md",
              recent: "/project/memory/RECENT.md",
              summaries: "/project/memory/SUMMARIES.md",
              evidence: "/project/memory/EVIDENCE.md",
              writesUseAutomaticDiffApply: true,
            },
            learning: {
              rules: "/project/AGENTS.md",
              durableRecall: "/project/MEMORY.md",
              workingNotes: "/project/NOTES.md",
              reusableWorkflows: "/project/skills/*/SKILL.md",
              usesAutomaticDiffApplyForRulesAndWorkflows: true,
            },
          },
          ...context,
          connectors: descriptors.map((descriptor) => ({
            id: descriptor.id,
            label: descriptor.label,
            capabilities: descriptor.capabilities,
          })),
          sourceTrees: [...sourceTreesByConnection.values()].map((tree) => {
            const shellPath = `${projectShellRootForConnection(tree.connectorId)}/${tree.mountPath}`;
            return {
              ...tree,
              shellPath,
              manifestShellPath: `${shellPath}/${tree.manifestPath}`,
              readOnly: true,
            };
          }),
          resourcePacks: (active.input.resourcePacks ?? []).map((pack) => ({
            ...pack,
            readOnly: true,
            manifestValue: pack.id,
            projectPathTemplate: `apps/<app>/assets/vendor/${pack.id}/`,
            copyTool: "project_resource_copy",
          })),
          resources: refs.flatMap((ref) => {
            const resource = workspaceResourcesById.get(ref.resourceId);
            if (resource?.storage.kind === "source-file") return [];
            return [
              {
                id: ref.resourceId,
                connectorId: ref.connectorId,
                name: ref.displayName,
                kind: ref.kind,
                shellPath:
                  resource?.connectionId === ref.connectorId
                    ? projectShellPathForResource(resource)
                    : undefined,
              },
            ];
          }),
        }),
        details: {
          memoryCount: context.memories.length,
          skillCount: context.skills.length,
          connectorCount: descriptors.length,
          resourceCount: refs.length,
          sourceTreeCount: sourceTreesByConnection.size,
          resourcePackCount: active.input.resourcePacks?.length ?? 0,
        },
      };
    },
  };
  const environment = () => projectTools();
  const readOperations: ReadOperations = {
    access: async (path) => (await environment()).accessFile(path),
    readFile: async (path) => (await environment()).readFileBuffer(path),
    detectImageMimeType: async () => null,
  };
  const editOperations: EditOperations = {
    access: readOperations.access,
    readFile: readOperations.readFile,
    writeFile: async (path, content) =>
      (await environment()).writeFile(path, content),
  };
  const writeOperations: WriteOperations = {
    mkdir: async (path) => (await environment()).mkdirExisting(path),
    writeFile: async (path, content) =>
      (await environment()).writeFile(path, content),
  };
  const bashOperations: BashOperations = {
    exec: (command, cwd, options) => executeProjectBash(command, cwd, options),
  };
  const grepOperations: GrepOperations = {
    isDirectory: async (path) => (await environment()).isDirectory(path),
    readFile: async (path) => (await environment()).readFile(path),
    search: async (input) => (await environment()).grep(input),
  };
  const findOperations: FindOperations = {
    exists: async (path) => (await environment()).exists(path),
    glob: async (pattern, cwd, options) =>
      (await environment()).glob(pattern, cwd, options),
  };
  const lsOperations: LsOperations = {
    exists: async (path) => (await environment()).exists(path),
    stat: async (path) => {
      const stat = await (await environment()).stat(path);
      if (!stat) throw new Error(`Path not found: ${path}`);
      return { isDirectory: () => stat.type === "directory" };
    },
    readdir: async (path) => (await environment()).readdir(path),
  };
  const definitions = createAllToolDefinitions(PROJECT_SHELL_ROOT, {
    read: {
      autoResizeImages: false,
      operations: readOperations,
    },
    bash: {
      operations: bashOperations,
      environment: { NODE_ENV: "production" },
      exposeSessionEnvironment: false,
      persistTruncatedOutput: false,
    },
    edit: { operations: editOperations },
    write: { operations: writeOperations },
    grep: { operations: grepOperations },
    find: { operations: findOperations },
    ls: { operations: lsOperations },
  });
  const codingTools = [
    adaptPiCodingToolDefinition(definitions.read, { risk: "read" }),
    adaptPiCodingToolDefinition(definitions.bash, { risk: "propose" }),
    adaptPiCodingToolDefinition(definitions.edit, { risk: "propose" }),
    adaptPiCodingToolDefinition(definitions.write, { risk: "propose" }),
    adaptPiCodingToolDefinition(definitions.grep, { risk: "read" }),
    adaptPiCodingToolDefinition(definitions.find, { risk: "read" }),
    adaptPiCodingToolDefinition(definitions.ls, { risk: "read" }),
  ];
  const readTool = codingTools.find((tool) => tool.name === "read")!;
  readTool.description = `${readTool.description} Mobile workflow: search first when the target section is unknown, then read focused line ranges. A continuation notice is normal pagination, not a failure; automatically follow its next offset until the relevant section is complete, and do not ask the user to split an ordinary text file unless bounded reads still cannot recover the needed content.`;
  const bashTool = codingTools.find((tool) => tool.name === "bash")!;
  bashTool.description = bashTool.description.replace(
    "If truncated, full output is saved to a temp file.",
    "Truncated output remains bounded in memory; this mobile host does not expose a temporary output file.",
  );
  const writeTool = codingTools.find((tool) => tool.name === "write")!;
  writeTool.description = `${writeTool.description} In this mobile host it may create a new project-owned text path or overwrite an existing authorized writable project text resource. It cannot delete a path, create inside a connector mount, or modify an imported source snapshot.`;
  const skillReadTool: RuntimeTool<typeof skillReadParameters> = {
    name: "skill_read",
    label: "Read Skill instructions",
    description:
      "Load one enabled in-memory Skill by its exact catalog name. The host also exposes that Skill's registered specialized tool group for this conversation while the Skill remains enabled.",
    risk: "read",
    parameters: skillReadParameters,
    execute: async ({ name }) => {
      const active = requiredContext();
      const skill = createSessionResources(active.input).skills?.find(
        (item) => item.name === name,
      );
      if (!skill) {
        throw new Error(`Skill 不存在或未在当前项目启用：${name}`);
      }
      const activatedTools = activateSkillTools
        ? await activateSkillTools(skill.name)
        : [];
      return {
        content:
          protectSkillContent?.(skill.name, skill.content) ?? skill.content,
        details: { name: skill.name, activatedTools },
      };
    },
  };
  const deviceTools = deviceCapabilities
    ? [
        {
          name: "device",
          label: "使用设备能力",
          description:
            "Use one stable host-owned native capability across one or many turns: device status, location, Wi-Fi, BLE, local network, external-app Linking, calendar, iOS reminders, sensors, or media-notification audio playback. Load the matching enabled Skill for action details. No capability has a preset app, scheme, device, or target allowlist. Only a user-authored Device Profile with policy=allowlist restricts device communication. Global allow/ask/deny policy, one-time prompts, OS permissions, identifier redaction, cancellation, strict bounds, deterministic mutation patches, receipts, and recovery actions are enforced by the host. Never invent a result.",
          risk: "propose",
          parameters: deviceParameters,
          executionMode: "sequential",
          execute: async (parameters, context) => {
            const active = requiredContext();
            const project = active.input.project;
            const profilesDocument = project
              ? active.input.resources.find(
                  (resource) =>
                    resource.projectId === project.id &&
                    isProjectWorkspaceResource(resource) &&
                    resource.path.replace(/^\/+|^project\//u, "") ===
                      DEVICE_PROFILES_PROJECT_PATH,
                )?.content
              : undefined;
            context.update(
              JSON.stringify({
                action: parameters.action,
                state: "authorizing-device-access",
              }),
            );
            const result = await deviceCapabilities!.execute(
              parameters,
              {
                conversationId: active.input.conversationId,
                projectId: project?.id ?? "global-conversation",
                projectName: project?.name ?? "当前对话",
                runId: active.input.runId,
                ...(profilesDocument ? { profilesDocument } : {}),
              },
              context.signal ?? active.signal,
            );
            const serialized = JSON.stringify(result);
            return {
              content: registerSensitiveValue(serialized),
              details: {
                action: parameters.action,
                approved: result.approved !== false,
                resultRedactedFromDurableSession: true,
              },
            };
          },
        } satisfies RuntimeTool<typeof deviceParameters>,
      ]
    : [];
  const delegatedSkillReadTool: RuntimeTool<typeof skillReadParameters> = {
    ...skillReadTool,
    description:
      "Load one enabled in-memory Skill by its exact catalog name inside this read-only child task.",
    execute: async ({ name }) => {
      const active = requiredContext();
      const skill = createSessionResources(active.input).skills?.find(
        (item) => item.name === name,
      );
      if (!skill) {
        throw new Error(`Skill 不存在或未在当前项目启用：${name}`);
      }
      return {
        content:
          protectSkillContent?.(skill.name, skill.content) ?? skill.content,
        details: { name: skill.name, activatedTools: [] },
      };
    },
  };
  const projectResourceCatalogTool: RuntimeTool<
    typeof projectResourceCatalogParameters
  > = {
    name: "project_resource_catalog",
    label: "查找项目内置资源",
    description:
      "List or search metadata for the current project's enabled built-in H5 resource packs. Results are source catalog entries, not project files; copy exact selected paths with project_resource_copy before referencing them. Follow the already-loaded H5 resource Skill for selection rules.",
    risk: "read",
    parameters: projectResourceCatalogParameters,
    execute: async ({ action, packId, query, offset = 0, limit = 40 }) => {
      const active = requiredContext();
      if (!active.input.project) {
        throw new Error("当前对话没有绑定项目，不能使用项目内置资源。");
      }
      const enabled = active.input.resourcePacks ?? [];
      const enabledIds = enabled.map((pack) => pack.id);
      if (action === "list_packs") {
        return {
          content: JSON.stringify({
            projectId: active.input.project.id,
            packs: enabled.map((pack) => ({
              ...pack,
              manifestValue: pack.id,
              projectPathTemplate: `apps/<app>/assets/vendor/${pack.id}/`,
              copyRequired: true,
            })),
          }),
          details: { packCount: enabled.length },
        };
      }
      if (!packId || !isBuiltInProjectResourcePackId(packId)) {
        throw new Error(`${action} 需要有效的 packId。`);
      }
      if (!enabledIds.includes(packId)) {
        throw new Error(`当前项目没有启用内置资源：${packId}`);
      }
      if (action === "list_files") {
        const pack = builtInProjectResourcePack(packId);
        const selected = pack.files.slice(offset, offset + limit);
        return {
          content: JSON.stringify({
            pack: {
              id: pack.id,
              skillId: projectResourceSkillId(pack.id),
              name: pack.name,
              version: pack.version,
              license: pack.license,
            },
            offset,
            total: pack.files.length,
            nextOffset:
              offset + selected.length < pack.files.length
                ? offset + selected.length
                : null,
            files: selected.map((file) => ({
              ...file,
              projectPathAfterCopy: projectResourceH5Path(pack.id, file.path),
              copyRequired: true,
            })),
          }),
          details: {
            packId,
            resultCount: selected.length,
            total: pack.files.length,
          },
        };
      }
      if (!query?.trim()) throw new Error("search 需要 query。");
      const matches = searchBuiltInProjectResources({
        packIds: [packId],
        query,
        limit,
      });
      const catalogMatches = matches.map((match) =>
        match.kind === "file"
          ? {
              kind: match.kind,
              packId: match.packId,
              sourcePath: match.path,
              projectPathAfterCopy: match.h5Path,
              mimeType: match.mimeType,
              byteLength: match.byteLength,
              ...(match.width === undefined ? {} : { width: match.width }),
              ...(match.height === undefined ? {} : { height: match.height }),
              copyRequired: true,
            }
          : {
              kind: match.kind,
              packId: match.packId,
              name: match.name,
              className: match.className,
              stylesheetAfterCopy: match.stylesheet,
              requiredCopyPaths: ["bootstrap-icons.min.css"],
              copyRequired: true,
            },
      );
      return {
        content: JSON.stringify({
          packId,
          skillId: projectResourceSkillId(packId),
          query,
          matches: catalogMatches,
          copyRequired: true,
          nextTool: "project_resource_copy",
        }),
        details: { packId, query, resultCount: catalogMatches.length },
      };
    },
  };
  const projectResourceCopyTool: RuntimeTool<
    typeof projectResourceCopyParameters
  > = {
    name: "project_resource_copy",
    label: "复制资源到项目",
    description:
      "Copy exact catalog-selected files from one enabled built-in H5 resource pack into assets/vendor/<packId> under the requested project app. The host adds required dependencies and stages immutable binary files in the reviewable project Diff. Follow the already-loaded H5 resource Skill.",
    risk: "propose",
    parameters: projectResourceCopyParameters,
    executionMode: "sequential",
    execute: async ({ appRoot, packId, paths }, context) => {
      const active = requiredContext();
      if (!active.input.project) {
        throw new Error("当前对话没有绑定项目，不能复制项目资源。");
      }
      if (!projectResourceFiles) {
        throw new Error("当前构建没有可用的项目资源复制能力。");
      }
      if (
        !(active.input.resourcePacks ?? []).some((pack) => pack.id === packId)
      ) {
        throw new Error(`当前项目没有启用内置资源：${packId}`);
      }
      const selectedPaths = projectResourceCopyPaths(packId, paths);
      const descriptors = selectedPaths.map((path) => {
        const descriptor = builtInProjectResourceFile(packId, path);
        if (!descriptor) {
          throw new Error(`内置资源路径无效：${packId}/${path}`);
        }
        return descriptor;
      });
      const totalBytes = descriptors.reduce(
        (total, descriptor) => total + descriptor.byteLength,
        0,
      );
      if (descriptors.length > 8 || totalBytes > 512 * 1024) {
        throw new Error("单次最多复制 8 个且合计不超过 512 KiB 的项目资源。");
      }
      const environment = await projectTools();
      const copyInputs = await Promise.all(
        descriptors.map(async (descriptor) => ({
          path: `${appRoot}/assets/vendor/${packId}/${descriptor.path}`,
          packId,
          sourcePath: descriptor.path,
          mimeType: descriptor.mimeType,
          byteLength: descriptor.byteLength,
          sha256: descriptor.sha256,
          contentBase64: await projectResourceFiles.readBase64(
            packId,
            descriptor.path,
          ),
        })),
      );
      const statuses = await environment.stageBuiltInResourceCopies(
        copyInputs,
        context.signal,
      );
      const copied = descriptors.map((descriptor, index) => {
        const projectPath = copyInputs[index]!.path;
        return {
          sourcePath: descriptor.path,
          projectPath,
          entryReference: `./${projectPath.slice(appRoot.length + 1)}`,
          mimeType: descriptor.mimeType,
          byteLength: descriptor.byteLength,
          sha256: descriptor.sha256,
          status: statuses[index]!,
        };
      });
      return {
        content: JSON.stringify({
          appRoot,
          packId,
          copied,
          manifestValue: packId,
          note: "这些文件已进入本轮项目 Diff；H5 必须引用 copied.projectPath 对应的项目内相对路径。",
        }),
        details: {
          packId,
          copiedCount: copied.filter((file) => file.status === "copied").length,
          existingCount: copied.filter((file) => file.status === "existing")
            .length,
          byteLength: totalBytes,
          staged: copied.some((file) => file.status === "copied"),
        },
      };
    },
  };
  const credentialTools = [];
  if (credentialAccess) {
    credentialTools.push(
      {
        name: "credential_vault_list",
        label: "查看项目密码本授权",
        description:
          "List metadata for global credential-vault entries already granted to this conversation's project. Values are never returned by this tool.",
        risk: "read",
        parameters: credentialListParameters,
        execute: async () => {
          const active = requiredContext();
          if (!active.input.project) {
            throw new Error("当前对话没有绑定项目，不能读取项目密码本授权。");
          }
          const items = await credentialAccess!.listAuthorized(
            active.input.project.id,
          );
          return {
            content: JSON.stringify({
              projectId: active.input.project.id,
              credentials: items.map((item) => ({
                id: item.id,
                label: item.label,
                kind: item.kind,
                service: item.service,
                username: item.username,
                endpoint: item.endpoint,
                sshAuthentication: item.sshAuthentication,
                sshReady: Boolean(
                  item.kind === "ssh" &&
                  item.endpoint &&
                  item.username &&
                  item.sshHostKey,
                ),
                apiAuthentication: item.apiAuthentication,
                apiHeaderName: item.apiHeaderName,
              })),
            }),
            details: { credentialCount: items.length },
          };
        },
      } satisfies RuntimeTool<typeof credentialListParameters>,
      {
        name: "credential_access_request",
        label: "申请读取密码本",
        description:
          "Request one-time manual approval to inspect one typed credential already granted to the current project. State the concrete task purpose. Never echo returned secret fields or place them in another tool's arguments. Repository-owned connections should consume the credential ID internally instead.",
        risk: "read",
        parameters: credentialAccessParameters,
        executionMode: "sequential",
        execute: async ({ credentialId, purpose }, context) => {
          const active = requiredContext();
          const project = active.input.project;
          if (!project) {
            throw new Error("当前对话没有绑定项目，不能申请读取密码本。");
          }
          const authorized = await credentialAccess!.listAuthorized(project.id);
          if (
            authorized.some(
              (item) => item.id === credentialId && item.kind === "ssh",
            )
          ) {
            throw new Error(
              "SSH 凭据不能读取明文；请使用一级 sshpass 工具从密码本建立安全连接。",
            );
          }
          const decision = await credentialAccess!.requestAccess(
            {
              credentialId,
              projectId: project.id,
              projectName: project.name,
              conversationId: active.input.conversationId,
              purpose,
            },
            context.signal,
          );
          if (!decision.approved) {
            return {
              content: JSON.stringify({
                approved: false,
                credentialId,
                message: "用户拒绝了本次密码本读取。",
              }),
              details: { approved: false, credentialId },
            };
          }
          active.sensitiveAccessApproved = true;
          return {
            content: JSON.stringify({
              approved: true,
              credential: {
                id: decision.item.id,
                label: decision.item.label,
                kind: decision.item.kind,
                service: decision.item.service,
                username: decision.item.username,
                endpoint: decision.item.endpoint,
                sshAuthentication: decision.item.sshAuthentication,
                apiAuthentication: decision.item.apiAuthentication,
                apiHeaderName: decision.item.apiHeaderName,
                secret: markedCredentialSecret(
                  decision.secret,
                  registerSensitiveValue,
                ),
              },
              confidentiality:
                "Use once for reasoning only. Never display, transform, persist, or pass these secret fields to a tool.",
            }),
            details: {
              approved: true,
              credentialId: decision.item.id,
              oneTime: true,
            },
          };
        },
      } satisfies RuntimeTool<typeof credentialAccessParameters>,
    );
  }
  const sshTools = [];
  if (credentialAccess && sshCredentialConnection) {
    sshTools.push({
      name: "sshpass",
      label: "从密码本连接 SSH",
      description:
        "Open a native SSH session from one authorized credential ID returned by credential_vault_list. The host verifies the pinned host key and reads the password or private key from the device password book internally; no secret is returned or placed in a command argument. Command syntax and operational workflow come from the already-loaded operate-ssh Skill.",
      risk: "read",
      parameters: sshpassParameters,
      executionMode: "sequential",
      execute: async ({ credentialId }, context) => {
        const active = requiredContext();
        const project = active.input.project;
        if (!project) {
          throw new Error("当前对话没有绑定项目，不能连接 SSH。");
        }
        const session = await sshCredentialConnection!.connect(
          project,
          credentialId,
          active.signal,
        );
        return {
          content: JSON.stringify({
            connected: true,
            alias: session.alias,
            account: session.account,
            initialDirectory: session.root,
            pathAccess:
              "Determined by the remote account and server permissions; initialDirectory is not a path boundary.",
            verification: session.verification,
            usage: {
              execute: `ssh ${session.alias} -- '<remote command>'`,
              list: `sftp ${session.alias} ls .`,
              read: `sftp ${session.alias} cat <relative-path>`,
              diagnose: `ssh ${session.alias} diagnose`,
            },
          }),
          details: { credentialId, alias: session.alias },
        };
      },
    } satisfies RuntimeTool<typeof sshpassParameters>);
  }
  const browserTools = [];
  if (browserControl) {
    browserTools.push({
      name: "browser",
      label: "浏览网页",
      description:
        "Control one app-managed web page or project preview through its taskId. Use open/status, then revision-bound snapshot/read/search/wait/navigation actions; click or type only controls and actions returned by the latest snapshot. The host withholds cookies and form values and blocks submissions, unsafe network writes, uploads, purchases, publishing, deletion, and other external mutations. Follow the already-loaded operate-browser Skill for the complete workflow and cleanup rules.",
      risk: "read",
      parameters: browserParameters,
      executionMode: "sequential",
      execute: async (parameters, context) => {
        const active = requiredContext();
        const project = active.input.project;
        if (!project) {
          throw new Error("当前对话没有绑定项目，不能使用 Agent 浏览器。");
        }
        const scope = {
          projectId: project.id,
          runId: active.input.runId,
          ...(parameters.taskId ? { taskId: parameters.taskId } : {}),
        };
        let input: AgentBrowserControlInput;
        if (parameters.action === "open") {
          if (!parameters.url) throw new Error("open 需要 url。");
          input = {
            action: "open",
            projectId: project.id,
            runId: active.input.runId,
            url: parameters.url,
          };
        } else if (
          parameters.action === "close" ||
          parameters.action === "status" ||
          parameters.action === "snapshot"
        ) {
          input = { action: parameters.action, ...scope };
        } else if (parameters.action === "read_text") {
          if (!parameters.revision || parameters.offset === undefined) {
            throw new Error("read_text 需要 revision 和 offset。");
          }
          input = {
            action: "read_text",
            ...scope,
            revision: parameters.revision,
            offset: parameters.offset,
          };
        } else if (parameters.action === "find_text") {
          if (!parameters.revision || !parameters.query) {
            throw new Error("find_text 需要 revision 和 query。");
          }
          input = {
            action: "find_text",
            ...scope,
            revision: parameters.revision,
            query: parameters.query,
          };
        } else if (parameters.action === "wait_for_text") {
          if (!parameters.query) {
            throw new Error("wait_for_text 需要 query。");
          }
          input = {
            action: "wait_for_text",
            ...scope,
            query: parameters.query,
            condition: parameters.condition ?? "present",
            timeoutMs: parameters.timeoutMs ?? 5_000,
          };
        } else if (parameters.action === "navigate") {
          if (!parameters.url) throw new Error("navigate 需要 url。");
          input = {
            action: "navigate",
            ...scope,
            url: parameters.url,
          };
        } else if (parameters.action === "type") {
          if (!parameters.revision || !parameters.targetId) {
            throw new Error("type 需要 revision 和 targetId。");
          }
          if (parameters.text === undefined) {
            throw new Error("type 需要 text。");
          }
          input = {
            action: "type",
            ...scope,
            revision: parameters.revision,
            targetId: parameters.targetId,
            text: parameters.text,
          };
        } else if (
          parameters.action === "click" ||
          parameters.action === "follow_link" ||
          parameters.action === "highlight"
        ) {
          if (!parameters.revision || !parameters.targetId) {
            throw new Error(`${parameters.action} 需要 revision 和 targetId。`);
          }
          input = {
            action: parameters.action,
            ...scope,
            revision: parameters.revision,
            targetId: parameters.targetId,
          };
        } else if (parameters.action === "scroll") {
          if (!parameters.direction) {
            throw new Error("scroll 需要 direction。");
          }
          input = {
            action: "scroll",
            ...scope,
            direction: parameters.direction,
          };
        } else {
          input = { action: parameters.action, ...scope };
        }
        const result = await browserControl!.execute(input, context.signal);
        return {
          content: JSON.stringify(result),
          details: { action: parameters.action },
        };
      },
    } satisfies RuntimeTool<typeof browserParameters>);
  }
  const projectPreviewTools = [];
  if (browserControl && projectPreview) {
    projectPreviewTools.push({
      name: "preview_project",
      label: "预览项目 H5",
      description:
        "Open one existing HTML entry from the current project's /project tree as an isolated H5 preview and return its taskId. The host validates boltpocket.h5.json, local assets, runtime profile, CSP, directory scope, and declared native permissions; previews never receive normal browser cookies or credentials. Follow the already-loaded build-h5 or operate-browser Skill for creation, smoke testing, permission handling, presentation, and cleanup.",
      risk: "read",
      parameters: projectPreviewParameters,
      executionMode: "sequential",
      execute: async ({ entryPath, present }, context) => {
        const active = requiredContext();
        const project = active.input.project;
        if (!project) {
          throw new Error("当前对话没有绑定项目，不能预览项目 H5。");
        }
        const environment = await projectTools();
        const snapshot = await projectPreview!.create({
          projectId: project.id,
          entryPath,
          enabledResourcePackIds: (active.input.resourcePacks ?? []).map(
            (pack) => pack.id,
          ),
          files: await environment.previewFiles(entryPath, context.signal),
        });
        try {
          const result = await browserControl!.execute(
            {
              action: "preview",
              projectId: project.id,
              runId: active.input.runId,
              snapshot,
              present: present ?? true,
            },
            context.signal,
          );
          return {
            content: JSON.stringify(result),
            details: {
              entryPath: snapshot.entryPath,
              fileCount: snapshot.fileCount,
            },
          };
        } catch (error) {
          await Promise.resolve(projectPreview!.release(snapshot.id)).catch(
            () => undefined,
          );
          throw error;
        }
      },
    } satisfies RuntimeTool<typeof projectPreviewParameters>);
  }
  const documentCreateTool: RuntimeTool<typeof documentCreateParameters> = {
    name: "document_create",
    label: "新建连接器文档",
    description:
      "Stage one new document in an existing project-scoped Google Docs, Google Sheets, Google Slides, or Notion connector. Pass the exact connectorId shown by project_context_read, a visible title, and complete content. Use plain text for Docs, canonical CSV for Sheets, plain text separated by --- between slides (or canonical deck JSON) for Slides, and Markdown for Notion. This creates a reviewable Diff only; it does not call the provider during the Agent turn. Do not combine it with write, edit, or mutating bash calls in the same turn.",
    risk: "propose",
    parameters: documentCreateParameters,
    executionMode: "sequential",
    execute: async ({ connectorId, title, content }) => {
      const active = requiredContext();
      const project = active.input.project;
      if (!project) {
        throw new Error("当前对话没有绑定项目，不能新建连接器文档。");
      }
      if (active.proposal) {
        throw new Error("本轮已经存在修改提案，不能再新建连接器文档。");
      }
      if (content.includes("\0")) {
        throw new Error("连接器文档只能包含纯文本。");
      }
      if (active.toolEnvironment) {
        const staged = (await active.toolEnvironment).stagedChanges();
        if (staged.length > 0) {
          throw new Error("连接器文档新建不能和项目文件修改放在同一提案中。");
        }
      }
      const descriptor = active.registry
        .descriptors(project.id)
        .find((candidate) => candidate.id === connectorId);
      if (
        !descriptor ||
        !descriptor.capabilities.includes("create-text") ||
        (descriptor.kind !== "google-docs" &&
          descriptor.kind !== "google-sheets" &&
          descriptor.kind !== "google-slides" &&
          descriptor.kind !== "notion")
      ) {
        throw new Error("目标连接器不支持在当前项目中新建文档。");
      }
      const normalizedTitle = title.trim();
      if (!normalizedTitle || /[\u0000-\u001f\u007f]/u.test(normalizedTitle)) {
        throw new Error("文档标题无效。");
      }
      const createProfiles = {
        "google-docs": {
          resourceKind: "google-doc",
          titleKey: "runtime.agent.change.external.googleDocsTitle",
          canonicalize: (value: string) => value,
        },
        "google-sheets": {
          resourceKind: "google-sheet",
          titleKey: "runtime.agent.change.external.googleSheetsTitle",
          canonicalize: canonicalizeGoogleSheetCsv,
        },
        "google-slides": {
          resourceKind: "google-slide",
          titleKey: "runtime.agent.change.external.googleSlidesTitle",
          canonicalize: canonicalizeGoogleSlidesText,
        },
        notion: {
          resourceKind: "notion-page",
          titleKey: "runtime.agent.change.external.notionTitle",
          canonicalize: canonicalizeNotionMarkdown,
        },
      } as const satisfies Record<
        typeof descriptor.kind,
        {
          resourceKind:
            "google-doc" | "google-sheet" | "google-slide" | "notion-page";
          titleKey: MessageKey;
          canonicalize: (value: string) => string;
        }
      >;
      const createProfile = createProfiles[descriptor.kind];
      const canonicalContent = createProfile.canonicalize(content);
      const resourceId = `${createProfile.resourceKind}-created-${stableDocumentResourceId(
        `${project.id}\0${connectorId}\0${active.input.runId}`,
      )}`;
      const proposalId = `proposal-${active.input.runId}`;
      const proposalTitle = translate(createProfile.titleKey);
      const proposalSummary = translate(
        "runtime.agent.change.externalSummary",
        { title: normalizedTitle },
      ).slice(0, 1_000);
      active.proposal = {
        id: proposalId,
        projectId: project.id,
        title: proposalTitle,
        titleMessage: { key: createProfile.titleKey },
        kind: "agent",
        status: "pending",
        connectorId,
        connector: descriptor.label,
        createdAt: new Date().toISOString(),
        hunks: [
          {
            id: `${active.input.runId}-${resourceId}-0`,
            resourceId,
            target: normalizedTitle,
            operation: "create",
            createTarget: {
              provider: descriptor.kind,
              connectorId,
              accountId: descriptor.accountId,
              accountLabel: descriptor.accountLabel,
            },
            baseVersion: "absent",
            before: "",
            after: canonicalContent,
            summary: proposalSummary,
            summaryMessage: {
              key: "runtime.agent.change.externalSummary",
              values: { title: normalizedTitle },
            },
            lines: createTextDiffLines(normalizedTitle, "", canonicalContent),
          },
        ],
      };
      return {
        content: JSON.stringify({
          staged: true,
          connectorId,
          provider: descriptor.kind,
          title: normalizedTitle,
        }),
        details: {
          connectorId,
          provider: descriptor.kind,
          title: normalizedTitle,
        },
      };
    },
  };
  const mediaAnalysisTool: RuntimeTool<typeof mediaAnalysisParameters> = {
    name: "analyze_media",
    label: "识别图片",
    description:
      "Delegate bounded, read-only visual analysis to the configured vision specialist. It can inspect only image attachments from the current user turn and has no project files, tools, browser, credentials, or conversation history. Use it for OCR, screenshot inspection, image comparison, and detailed visual questions. Omit attachmentIds to analyze all current attachments, or pass exact attachment ids. Do not call it when the turn has no image attachment.",
    risk: "read",
    parameters: mediaAnalysisParameters,
    executionMode: "parallel",
    execute: async ({ question, attachmentIds }, context) => {
      const active = requiredContext();
      const requestedIds = attachmentIds ? new Set(attachmentIds) : null;
      const attachments = active.input.attachments.filter(
        (attachment) => !requestedIds || requestedIds.has(attachment.id),
      );
      if (
        requestedIds &&
        (attachments.length !== requestedIds.size ||
          attachments.some((attachment) => !requestedIds.has(attachment.id)))
      ) {
        throw new Error("图片编号不属于当前用户消息。");
      }
      if (attachments.length === 0) {
        throw new Error("当前用户消息没有可识别的图片附件。");
      }
      const result = await mediaAnalysis!.analyze({
        taskId: `${active.input.runId}:${context.toolCallId}`,
        parentRunId: active.input.runId,
        conversationId: active.input.conversationId,
        projectId: active.input.project?.id ?? null,
        question,
        attachments,
        signal: context.signal,
      });
      return {
        content: result.content,
        details: {
          attachmentCount: attachments.length,
          modelRef: result.modelRef,
        },
      };
    },
  };
  const imageGenerationTool: RuntimeTool<typeof imageGenerationParameters> = {
    name: "generate_image",
    label: "生成图片",
    description:
      "Generate one image with the configured image-output model and save it as a durable conversation attachment. Use this when the user explicitly asks to create, draw, render, or generate an image. The host selects the configured provider and model; never ask for or pass credentials, provider IDs, URLs, or model IDs. One parent run can create at most one image. This is not image analysis and cannot edit an existing attachment.",
    risk: "read",
    parameters: imageGenerationParameters,
    execute: async ({ prompt }, context) => {
      const active = requiredContext();
      if (
        (active.generatedMedia ?? []).some(
          (attachment) => attachment.kind === "generated-image",
        )
      ) {
        throw new Error("一次任务最多生成 1 张图片；请在下一条消息继续生成。");
      }
      const result = await imageGeneration!.generate({
        taskId: `${active.input.runId}:${context.toolCallId}`,
        parentRunId: active.input.runId,
        conversationId: active.input.conversationId,
        projectId: active.input.project?.id ?? null,
        prompt,
        signal: context.signal,
      });
      active.generatedMedia ??= [];
      active.generatedMedia.push(result.attachment);
      return {
        content: JSON.stringify({
          generated: true,
          attachmentId: result.attachment.id,
          provider: result.capability.providerName,
          model: result.capability.modelId,
          format: result.attachment.mimeType,
          byteLength: result.attachment.sizeBytes,
        }),
        details: {
          attachmentId: result.attachment.id,
          provider: result.capability.providerName,
          model: result.capability.modelId,
        },
      };
    },
  };
  const videoGenerationTool: RuntimeTool<typeof videoGenerationParameters> = {
    name: "generate_video",
    label: "生成视频",
    description:
      "Generate one short video with the configured video-output model and save it as a durable conversation attachment. Use this when the user explicitly asks to create or generate a video. Current-message image attachments may be selected with attachmentIds. HTTPS image, video, or audio references may be supplied with referenceUrls only when the exact URL appears in the current user message. The provider runs asynchronously, so this tool may take several minutes. The host selects the provider and model, polls the task, and downloads the result; never ask for or pass credentials, provider IDs, endpoint URLs, or model IDs. One parent run can create at most one video.",
    risk: "read",
    parameters: videoGenerationParameters,
    execute: async (
      {
        prompt,
        ratio,
        durationSeconds,
        generateAudio,
        attachmentIds,
        referenceUrls,
      },
      context,
    ) => {
      const active = requiredContext();
      if (
        (active.generatedMedia ?? []).some(
          (attachment) => attachment.kind === "generated-video",
        )
      ) {
        throw new Error("一次任务最多生成 1 个视频；请在下一条消息继续生成。");
      }
      const requestedIds = new Set(attachmentIds ?? []);
      const referenceImages = active.input.attachments
        .filter((attachment) => requestedIds.has(attachment.id))
        .map((attachment) => ({
          base64: attachment.base64,
          mimeType: attachment.mimeType,
        }));
      if (referenceImages.length !== requestedIds.size) {
        throw new Error("部分参考图片不在当前用户消息中。");
      }
      if (
        referenceUrls?.some(
          (reference) => !active.input.prompt.includes(reference.url),
        )
      ) {
        throw new Error("远程参考素材地址必须由用户在当前消息中明确提供。");
      }
      if (referenceImages.length + (referenceUrls?.length ?? 0) > 9) {
        throw new Error("一次最多使用 9 个参考素材。");
      }
      const result = await videoGeneration!.generate({
        taskId: `${active.input.runId}:${context.toolCallId}`,
        parentRunId: active.input.runId,
        conversationId: active.input.conversationId,
        projectId: active.input.project?.id ?? null,
        prompt,
        ratio,
        durationSeconds,
        generateAudio,
        referenceImages,
        referenceUrls,
        signal: context.signal,
      });
      active.generatedMedia ??= [];
      active.generatedMedia.push(result.attachment);
      return {
        content: JSON.stringify({
          generated: true,
          attachmentId: result.attachment.id,
          providerTaskId: result.providerTaskId,
          provider: result.capability.providerName,
          model: result.capability.modelId,
          format: result.attachment.mimeType,
          byteLength: result.attachment.sizeBytes,
          durationSeconds: result.attachment.durationSeconds,
        }),
        details: {
          attachmentId: result.attachment.id,
          providerTaskId: result.providerTaskId,
          provider: result.capability.providerName,
          model: result.capability.modelId,
        },
      };
    },
  };
  const subagentTool: RuntimeTool<typeof textDelegationParameters> = {
    name: "subagent",
    label: "协作 Agent",
    description:
      "Run one fresh specialist Pi session for a self-contained reasoning task. Available roles: scout locates and maps project code; planner designs a grounded implementation plan; reviewer independently checks correctness and risk. Children inherit no conversation history or credentials and receive only read-only project tools. For independent work, emit multiple subagent calls in the same assistant turn; Pi executes them in parallel. Do not use this for simple known-path reads, sequential steps, writes, external actions, or to bypass project scope. Verify and integrate every result yourself.",
    risk: "read",
    parameters: textDelegationParameters,
    executionMode: "parallel",
    execute: async ({ agent, task, description }, context) => {
      if (captureConversationSecrets(task).captures.length > 0) {
        throw new Error("子任务包含疑似凭据，已阻止发送给其他模型。");
      }
      const active = requiredContext();
      active.subagentCalls = (active.subagentCalls ?? 0) + 1;
      if (active.subagentCalls > 3) {
        throw new Error("一次主 Agent 运行最多启动 3 个协作 Agent。");
      }
      const readOnlyToolNames = new Set([
        "project_context_read",
        "read",
        "grep",
        "find",
        "ls",
        "skill_read",
        "project_resource_catalog",
      ]);
      const tools = [
        readContextTool,
        ...codingTools,
        delegatedSkillReadTool,
        projectResourceCatalogTool,
      ].filter((tool) => readOnlyToolNames.has(tool.name));
      const result = await textDelegation!.execute({
        taskId: `${active.input.runId}:${context.toolCallId}`,
        parentRunId: active.input.runId,
        conversationId: active.input.conversationId,
        projectId: active.input.project?.id ?? null,
        role: agent,
        instruction: task,
        tools,
        resources: createSessionResources(active.input),
        signal: context.signal,
      });
      if (context.signal?.aborted) throw new Error("协作 Agent 已取消。");
      return {
        content: result.content.slice(0, 16_000),
        details: {
          agent,
          description,
          modelRef: result.modelRef,
          toolActivity: result.toolActivity.slice(0, 32),
        },
      };
    },
  };
  return [
    readContextTool,
    ...(thirdPartyCapabilityTools as unknown as RuntimeTool[]),
    ...(skillMarketPublicationTools as unknown as RuntimeTool[]),
    documentCreateTool,
    ...(textDelegation ? [subagentTool] : []),
    ...(mediaAnalysis ? [mediaAnalysisTool] : []),
    ...(imageGeneration ? [imageGenerationTool] : []),
    ...(videoGeneration ? [videoGenerationTool] : []),
    ...codingTools,
    ...(executeJavaScript
      ? [createAgentJavaScriptTool(executeJavaScript)]
      : []),
    ...(mcpTools as unknown as RuntimeTool[]),
    skillReadTool,
    projectResourceCatalogTool,
    ...(projectResourceFiles ? [projectResourceCopyTool] : []),
    ...(credentialTools as unknown as RuntimeTool[]),
    ...(sshTools as unknown as RuntimeTool[]),
    ...(browserTools as unknown as RuntimeTool[]),
    ...(deviceTools as unknown as RuntimeTool[]),
    ...(projectPreviewTools as unknown as RuntimeTool[]),
  ];
}
