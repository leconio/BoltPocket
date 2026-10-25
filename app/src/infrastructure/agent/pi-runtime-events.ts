import type { AgentRuntimeEvent as CoreAgentRuntimeEvent } from "@boltpocket/agent-runtime";

import type { AgentRunEvent } from "@/application/ports/agent-runtime";
import { AGENT_TEXT_LIMITS } from "@/application/bounded-text";
import {
  translateMessage,
  type MessageKey,
  type MessageValues,
} from "@/i18n/messages";
import type { AppLocale } from "@/i18n/translate";

type Translate = (key: MessageKey, values?: MessageValues) => string;

type ToolLabelContext = Readonly<{
  mcpServerNames?: ReadonlyMap<string, string>;
}>;

const fallbackToolLabelKeys: Record<string, MessageKey> = {
  project_context_read: "runtime.agent.action.projectContext",
  read: "runtime.agent.action.readFile",
  edit: "runtime.agent.action.editFile",
  write: "runtime.agent.action.writeFile",
  grep: "runtime.agent.action.grep",
  find: "runtime.agent.action.findFiles",
  ls: "runtime.agent.action.listDirectory",
  js_exec: "runtime.agent.action.javascript",
  skill_read: "runtime.agent.action.readProjectSkill",
  project_resource_catalog: "runtime.agent.action.resourceCatalog",
  project_resource_copy: "runtime.agent.action.resourceCopy",
  preview_project: "runtime.agent.action.previewProject",
  credential_vault_list: "runtime.agent.action.vaultList",
  credential_access_request: "runtime.agent.action.credentialRequest",
  sshpass: "runtime.agent.action.sshConnect",
  mcp: "runtime.agent.action.mcp",
  browser: "runtime.agent.action.browser",
  analyze_media: "runtime.agent.action.analyzeMedia",
  generate_image: "runtime.agent.action.generateImage",
  generate_video: "runtime.agent.action.generateVideo",
  subagent: "runtime.agent.action.subagent",
};

const MAX_TOOL_LABEL_CHARACTERS = 120;
const COMMAND_CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const SENSITIVE_ASSIGNMENT =
  /(\b(?:api[_-]?key|authorization|password|passwd|passphrase|secret|token)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;&|]+)/giu;
const SENSITIVE_OPTION =
  /((?:^|\s)(?:--(?:api[_-]?key|authorization|password|passwd|passphrase|secret|token)|-u|--user)\s+)(?:"[^"]*"|'[^']*'|[^\s;&|]+)/giu;

function toolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function visibleText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(COMMAND_CONTROL_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(SENSITIVE_ASSIGNMENT, "$1••••")
    .replace(SENSITIVE_OPTION, "$1••••")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, "$1••••")
    .replace(/((?:https?|ssh):\/\/[^/\s:@]+:)[^@/\s]+@/giu, "$1••••@");
}

function boundedLabel(value: string) {
  if (value.length <= MAX_TOOL_LABEL_CHARACTERS) return value;
  const tailLength = 28;
  return `${value.slice(0, MAX_TOOL_LABEL_CHARACTERS - tailLength - 1)}…${value.slice(-tailLength)}`;
}

function toolFailureReason(value: unknown) {
  const content =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).content
      : value;
  const texts = Array.isArray(content)
    ? content
        .filter((block): block is { type: "text"; text: string } =>
          Boolean(
            block &&
            typeof block === "object" &&
            !Array.isArray(block) &&
            (block as Record<string, unknown>).type === "text" &&
            typeof (block as Record<string, unknown>).text === "string",
          ),
        )
        .map((block) => block.text)
    : typeof content === "string"
      ? [content]
      : [];
  const reason = visibleText(texts.join(" "));
  return reason
    ? reason.slice(0, AGENT_TEXT_LIMITS.toolFailureReasonCharacters)
    : undefined;
}

function detailedLabel(
  t: Translate,
  action: string,
  primary: unknown,
  ...secondary: unknown[]
) {
  const details = [primary, ...secondary]
    .map(visibleText)
    .filter((value) => value.length > 0);
  return boundedLabel(
    details.length
      ? t("runtime.agent.detail", {
          action,
          details: details.join(" · "),
        })
      : action,
  );
}

function lineRange(t: Translate, arguments_: Record<string, unknown>) {
  const offset =
    typeof arguments_.offset === "number" && Number.isFinite(arguments_.offset)
      ? Math.max(1, Math.floor(arguments_.offset))
      : undefined;
  const limit =
    typeof arguments_.limit === "number" && Number.isFinite(arguments_.limit)
      ? Math.max(1, Math.floor(arguments_.limit))
      : undefined;
  if (offset && limit) {
    return t("runtime.agent.line.range", {
      start: offset,
      end: offset + limit - 1,
    });
  }
  if (offset) return t("runtime.agent.line.from", { start: offset });
  if (limit) return t("runtime.agent.line.first", { count: limit });
  return "";
}

function browserUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return visibleText(value).replace(/[?#].*$/u, "");
  }
}

function browserLabel(t: Translate, arguments_: Record<string, unknown>) {
  const action = visibleText(arguments_.action);
  if (action === "open") {
    return detailedLabel(
      t,
      t("runtime.agent.browser.openTemporary"),
      browserUrl(arguments_.url),
    );
  }
  if (action === "close") return t("runtime.agent.browser.closeTemporary");
  if (action === "status") return t("runtime.agent.browser.status");
  if (action === "snapshot") return t("runtime.agent.browser.snapshot");
  if (action === "read_text") return t("runtime.agent.browser.readText");
  if (action === "find_text") return t("runtime.agent.browser.findText");
  if (action === "wait_for_text") {
    return t("runtime.agent.browser.waitForText");
  }
  if (action === "navigate") {
    return detailedLabel(
      t,
      t("runtime.agent.browser.navigate"),
      browserUrl(arguments_.url),
    );
  }
  if (action === "click") return t("runtime.agent.browser.click");
  if (action === "type") return t("runtime.agent.browser.type");
  if (action === "follow_link") return t("runtime.agent.browser.followLink");
  if (action === "highlight") return t("runtime.agent.browser.highlight");
  if (action === "scroll") {
    return detailedLabel(
      t,
      t("runtime.agent.browser.scroll"),
      t(
        arguments_.direction === "up"
          ? "runtime.agent.browser.scrollUp"
          : "runtime.agent.browser.scrollDown",
      ),
    );
  }
  if (action === "back") return t("runtime.agent.browser.back");
  if (action === "forward") return t("runtime.agent.browser.forward");
  if (action === "reload") return t("runtime.agent.browser.reload");
  return t("runtime.agent.action.browser");
}

function mcpLabel(
  t: Translate,
  arguments_: Record<string, unknown>,
  context: ToolLabelContext,
) {
  const action = visibleText(arguments_.action);
  const serverId = visibleText(arguments_.serverId);
  const serverName = serverId
    ? visibleText(context.mcpServerNames?.get(serverId)) || serverId
    : "";
  const targetName =
    visibleText(arguments_.toolName) ||
    visibleText(arguments_.promptName) ||
    (action === "read-resource" ? visibleText(arguments_.uri) : "");
  const actionDetail =
    action === "call" || action === "schema" || action === "get-prompt"
      ? ""
      : action;
  return detailedLabel(
    t,
    t("runtime.agent.action.mcp"),
    serverName,
    targetName,
    actionDetail,
    action === "search" ? arguments_.query : "",
  );
}

function toolLabel(
  t: Translate,
  toolName: string,
  rawArguments: unknown,
  context: ToolLabelContext,
) {
  const arguments_ = toolArguments(rawArguments);
  if (toolName === "bash") {
    return detailedLabel(
      t,
      t("runtime.agent.action.run"),
      visibleText(arguments_.command)
        ? arguments_.command
        : t("runtime.agent.commandUnavailable"),
    );
  }
  if (toolName === "js_exec") {
    return detailedLabel(
      t,
      t("runtime.agent.action.javascript"),
      arguments_.code,
    );
  }
  if (toolName === "read") {
    return detailedLabel(
      t,
      t("runtime.agent.action.read"),
      arguments_.path,
      lineRange(t, arguments_),
    );
  }
  if (toolName === "edit") {
    const editCount = Array.isArray(arguments_.edits)
      ? arguments_.edits.length
      : typeof arguments_.oldText === "string" &&
          typeof arguments_.newText === "string"
        ? 1
        : 0;
    return detailedLabel(
      t,
      t("runtime.agent.action.edit"),
      arguments_.path,
      editCount > 0 ? t("runtime.agent.editCount", { count: editCount }) : "",
    );
  }
  if (toolName === "write") {
    return detailedLabel(t, t("runtime.agent.action.write"), arguments_.path);
  }
  if (toolName === "grep") {
    return detailedLabel(
      t,
      t("runtime.agent.action.search"),
      arguments_.pattern,
      arguments_.path ?? ".",
    );
  }
  if (toolName === "find") {
    return detailedLabel(
      t,
      t("runtime.agent.action.find"),
      arguments_.pattern,
      arguments_.path ?? ".",
    );
  }
  if (toolName === "ls") {
    return detailedLabel(
      t,
      t("runtime.agent.action.list"),
      arguments_.path ?? ".",
    );
  }
  if (toolName === "skill_read") {
    return detailedLabel(
      t,
      t("runtime.agent.action.readSkill"),
      arguments_.name,
    );
  }
  if (toolName === "credential_access_request") {
    return detailedLabel(
      t,
      t("runtime.agent.action.credentialRequest"),
      arguments_.purpose,
    );
  }
  if (toolName === "analyze_media") {
    return detailedLabel(
      t,
      t("runtime.agent.action.analyzeMedia"),
      arguments_.question,
    );
  }
  if (toolName === "generate_image") {
    return detailedLabel(
      t,
      t("runtime.agent.action.generateImage"),
      arguments_.prompt,
    );
  }
  if (toolName === "generate_video") {
    return detailedLabel(
      t,
      t("runtime.agent.action.generateVideo"),
      arguments_.prompt,
      arguments_.durationSeconds
        ? t("runtime.agent.durationSeconds", {
            count: String(arguments_.durationSeconds),
          })
        : "",
    );
  }
  if (toolName === "subagent") {
    const role =
      arguments_.agent === "scout"
        ? t("runtime.agent.subagent.scout")
        : arguments_.agent === "planner"
          ? t("runtime.agent.subagent.planner")
          : arguments_.agent === "reviewer"
            ? t("runtime.agent.subagent.reviewer")
            : arguments_.agent;
    return detailedLabel(
      t,
      t("runtime.agent.action.subagent"),
      role,
      arguments_.description,
    );
  }
  if (toolName === "mcp") return mcpLabel(t, arguments_, context);
  if (toolName === "browser") return browserLabel(t, arguments_);
  const fallbackKey = fallbackToolLabelKeys[toolName];
  return fallbackKey ? t(fallbackKey) : toolName;
}

export function toAgentRunEvent(
  event: CoreAgentRuntimeEvent,
  locale: AppLocale = "zh-CN",
  context: ToolLabelContext = {},
): AgentRunEvent | null {
  const t: Translate = (key, values) => translateMessage(key, locale, values);
  if (event.type === "run_started") {
    return { type: "status", label: t("runtime.agent.status.connected") };
  }
  if (event.type === "turn_started") {
    return { type: "status", label: t("runtime.agent.status.thinking") };
  }
  // Public text is coalesced by PiMobileAgentRuntime before meaningful tool
  // phases. Private model activity remains a content-free heartbeat here.
  // The final answer still arrives only through AgentRunOutput.
  if (event.type === "text_delta" || event.type === "model_activity")
    return null;
  if (event.type === "tool_started") {
    return {
      type: "tool-started",
      toolCallId: event.execution.toolCallId,
      label: toolLabel(
        t,
        event.execution.toolName,
        event.execution.arguments,
        context,
      ),
    };
  }
  if (event.type === "tool_completed") {
    const staged =
      event.execution.toolName === "edit" ||
      event.execution.toolName === "write";
    const failureReason = event.execution.isError
      ? toolFailureReason(event.execution.result)
      : undefined;
    return {
      type: "tool-completed",
      toolCallId: event.execution.toolCallId,
      label: toolLabel(
        t,
        event.execution.toolName,
        event.execution.arguments,
        context,
      ),
      outcome: event.execution.isError
        ? "failed"
        : staged
          ? "staged"
          : "completed",
      ...(failureReason ? { failureReason } : {}),
    };
  }
  if (event.type === "context_maintenance") {
    return {
      type: "context-maintenance",
      operation: event.operation,
      phase: event.phase,
      label:
        event.operation === "overflow_recovery"
          ? event.phase === "started"
            ? t("runtime.agent.context.overflowStarted")
            : event.phase === "completed"
              ? t("runtime.agent.context.overflowCompleted")
              : t("runtime.agent.context.overflowFailed")
          : event.phase === "started"
            ? t("runtime.agent.context.compactionStarted")
            : event.phase === "completed"
              ? t("runtime.agent.context.compactionCompleted")
              : t("runtime.agent.context.compactionFailed"),
      ...(event.tokensBefore === undefined
        ? {}
        : { tokensBefore: event.tokensBefore }),
      ...(event.tokensAfter === undefined
        ? {}
        : { tokensAfter: event.tokensAfter }),
    };
  }
  if (event.type === "retry_status") {
    const subject =
      event.operation === "turn"
        ? t("runtime.agent.retry.subject.turn")
        : event.operation === "compaction"
          ? t("runtime.agent.retry.subject.compaction")
          : t("runtime.agent.retry.subject.branch");
    if (event.phase === "scheduled") {
      return {
        type: "status",
        label:
          event.attempt && event.maxAttempts
            ? t("runtime.agent.retry.scheduledProgress", {
                attempt: event.attempt,
                maximum: event.maxAttempts,
                subject,
              })
            : t("runtime.agent.retry.scheduled", { subject }),
      };
    }
    if (event.phase === "attempt_started") {
      return {
        type: "status",
        label: t("runtime.agent.retry.attemptStarted", { subject }),
      };
    }
    return {
      type: "status",
      label:
        event.success === true
          ? t("runtime.agent.retry.succeeded", { subject })
          : event.success === false
            ? t("runtime.agent.retry.failed", { subject })
            : t("runtime.agent.retry.ended", { subject }),
    };
  }
  return null;
}
