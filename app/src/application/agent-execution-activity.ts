import type { AgentActivityItem } from "../domain/models.ts";

import { AGENT_TEXT_LIMITS, boundText } from "./bounded-text.ts";

export const AGENT_ACTIVITY_LIMITS = Object.freeze({
  items: 256,
  textCharacters: 24_000,
  textItemCharacters: 2_000,
});

type ToolStatus = Extract<AgentActivityItem, { kind: "tool" }>["status"];
type ContextOperation = Extract<
  AgentActivityItem,
  { kind: "context" }
>["operation"];
type ContextStatus = Extract<AgentActivityItem, { kind: "context" }>["status"];

type VisibleActivityItem = Exclude<AgentActivityItem, { kind: "thinking" }>;

/**
 * Builds a bounded, chronological, user-visible record of a Pi tool loop.
 * Private model reasoning, raw tool arguments, and raw results never cross
 * this boundary; callers provide only sanitized public narration and labels.
 */
export class AgentExecutionActivityBuilder {
  readonly #items: VisibleActivityItem[] = [];
  readonly #toolIndexByCallId = new Map<string, number>();
  readonly #toolStartedAtByCallId = new Map<string, number>();
  readonly #contextIndexByOperation = new Map<ContextOperation, number>();
  readonly #contextStartedAtByOperation = new Map<ContextOperation, number>();
  #nextId = 0;
  #textCharacters = 0;

  appendText(content: string) {
    const normalized = content.trim();
    const remaining =
      AGENT_ACTIVITY_LIMITS.textCharacters - this.#textCharacters;
    if (
      !normalized ||
      remaining <= 0 ||
      this.#items.length >= AGENT_ACTIVITY_LIMITS.items
    ) {
      return;
    }
    const itemLimit = Math.min(
      AGENT_ACTIVITY_LIMITS.textItemCharacters,
      remaining,
    );
    const visible =
      normalized.length <= itemLimit
        ? normalized
        : itemLimit >= 64
          ? boundText(normalized, itemLimit)
          : normalized.slice(0, itemLimit);
    if (!visible) return;
    this.#items.push({
      id: this.#createId("text"),
      kind: "text",
      content: visible,
    });
    this.#textCharacters += visible.length;
  }

  startTool(toolCallId: string, label: string, startedAt = Date.now()) {
    if (!label || this.#items.length >= AGENT_ACTIVITY_LIMITS.items) return;
    const index = this.#items.length;
    this.#items.push({
      id: this.#createId("tool"),
      kind: "tool",
      label,
      status: "running",
    });
    this.#toolIndexByCallId.set(toolCallId, index);
    this.#toolStartedAtByCallId.set(toolCallId, startedAt);
  }

  completeTool(
    toolCallId: string,
    label: string,
    status: Exclude<ToolStatus, "running" | "cancelled">,
    completedAt = Date.now(),
    failureReason?: string,
  ) {
    const index = this.#toolIndexByCallId.get(toolCallId);
    const startedAt = this.#toolStartedAtByCallId.get(toolCallId);
    const durationMs =
      startedAt === undefined
        ? undefined
        : Math.max(0, completedAt - startedAt);
    const visibleFailureReason =
      status === "failed" && failureReason?.trim()
        ? failureReason
            .trim()
            .slice(0, AGENT_TEXT_LIMITS.toolFailureReasonCharacters)
        : undefined;
    if (index === undefined) {
      if (!label || this.#items.length >= AGENT_ACTIVITY_LIMITS.items) return;
      this.#items.push({
        id: this.#createId("tool"),
        kind: "tool",
        label,
        status,
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(visibleFailureReason
          ? { failureReason: visibleFailureReason }
          : {}),
      });
      return;
    }
    const item = this.#items[index];
    if (item?.kind === "tool") {
      this.#items[index] = {
        ...item,
        label,
        status,
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(visibleFailureReason
          ? { failureReason: visibleFailureReason }
          : {}),
      };
    }
    this.#toolIndexByCallId.delete(toolCallId);
    this.#toolStartedAtByCallId.delete(toolCallId);
  }

  startContextMaintenance(operation: ContextOperation, startedAt = Date.now()) {
    if (this.#items.length >= AGENT_ACTIVITY_LIMITS.items) return;
    const currentIndex = this.#contextIndexByOperation.get(operation);
    const current =
      currentIndex === undefined ? undefined : this.#items[currentIndex];
    if (current?.kind === "context" && current.status === "running") return;
    const index = this.#items.length;
    this.#items.push({
      id: this.#createId("context"),
      kind: "context",
      operation,
      status: "running",
    });
    this.#contextIndexByOperation.set(operation, index);
    this.#contextStartedAtByOperation.set(operation, startedAt);
  }

  completeContextMaintenance(
    operation: ContextOperation,
    status: Exclude<ContextStatus, "running" | "cancelled">,
    tokensBefore?: number,
    tokensAfter?: number,
    completedAt = Date.now(),
  ) {
    const index = this.#contextIndexByOperation.get(operation);
    const startedAt = this.#contextStartedAtByOperation.get(operation);
    const details = {
      ...(tokensBefore === undefined ? {} : { tokensBefore }),
      ...(tokensAfter === undefined ? {} : { tokensAfter }),
      ...(startedAt === undefined
        ? {}
        : { durationMs: Math.max(0, completedAt - startedAt) }),
    };
    if (index === undefined) {
      if (this.#items.length >= AGENT_ACTIVITY_LIMITS.items) return;
      this.#items.push({
        id: this.#createId("context"),
        kind: "context",
        operation,
        status,
        ...details,
      });
    } else {
      const item = this.#items[index];
      if (item?.kind === "context") {
        this.#items[index] = { ...item, status, ...details };
      }
    }
    this.#contextIndexByOperation.delete(operation);
    this.#contextStartedAtByOperation.delete(operation);
  }

  snapshot(): VisibleActivityItem[] {
    return this.#items.map((item) => ({ ...item }));
  }

  finish({
    unfinishedToolStatus,
    finishedAt = Date.now(),
  }: {
    unfinishedToolStatus?: "failed" | "cancelled";
    finishedAt?: number;
  } = {}) {
    let activity = this.snapshot();
    if (unfinishedToolStatus) {
      activity = activity.map((item) => {
        if (
          (item.kind !== "tool" && item.kind !== "context") ||
          item.status !== "running"
        ) {
          return item;
        }
        if (item.kind === "tool") {
          const callId = [...this.#toolIndexByCallId.entries()].find(
            ([, index]) => this.#items[index]?.id === item.id,
          )?.[0];
          const startedAt = callId
            ? this.#toolStartedAtByCallId.get(callId)
            : undefined;
          return {
            ...item,
            status: unfinishedToolStatus,
            ...(startedAt === undefined
              ? {}
              : { durationMs: Math.max(0, finishedAt - startedAt) }),
          };
        }
        if (item.kind === "context") {
          const startedAt = this.#contextStartedAtByOperation.get(
            item.operation,
          );
          return {
            ...item,
            status: unfinishedToolStatus,
            ...(startedAt === undefined
              ? {}
              : { durationMs: Math.max(0, finishedAt - startedAt) }),
          };
        }
        return item;
      });
    }
    return activity;
  }

  #createId(kind: VisibleActivityItem["kind"]) {
    const id = `activity-${kind}-${this.#nextId}`;
    this.#nextId += 1;
    return id;
  }
}
