import type { ChatMessage } from "../domain/models.ts";

export const MODEL_CONTEXT_WINDOW_OPTIONS = Object.freeze([
  16_384, 32_768, 64_000, 128_000, 200_000, 256_000, 272_000, 400_000,
  1_000_000, 1_047_576, 2_000_000,
]);

export function nearestContextWindowOption(value: number) {
  return MODEL_CONTEXT_WINDOW_OPTIONS.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value)
      ? candidate
      : nearest,
  );
}

export function contextWindowOptionAtPosition(
  position: number,
  trackStart: number,
  trackWidth: number,
) {
  if (!Number.isFinite(position) || !Number.isFinite(trackStart)) {
    return MODEL_CONTEXT_WINDOW_OPTIONS[0]!;
  }
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) {
    return MODEL_CONTEXT_WINDOW_OPTIONS[0]!;
  }
  const ratio = Math.max(0, Math.min(1, (position - trackStart) / trackWidth));
  const index = Math.round(ratio * (MODEL_CONTEXT_WINDOW_OPTIONS.length - 1));
  return MODEL_CONTEXT_WINDOW_OPTIONS[index]!;
}

export function formatCompactTokenCount(value: number) {
  const bounded = Math.max(0, Math.round(value));
  if (bounded >= 1_000_000) {
    const millions = bounded / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "")}M`;
  }
  if (bounded >= 1_000) {
    const thousands = bounded / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1).replace(/\.0$/u, "")}K`;
  }
  return String(bounded);
}

export function contextUsageProgress(
  usedTokens: number,
  contextWindow: number,
) {
  if (
    !Number.isFinite(usedTokens) ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.min(1, usedTokens / contextWindow));
}

/**
 * Startup fallback used until the encrypted Pi transcript is opened. Once a
 * live session exists, the runtime replaces this with provider-aware usage.
 */
export function estimateConversationContextTokens(
  messages: readonly ChatMessage[],
) {
  return messages.reduce((total, message) => {
    const executionCharacters = message.execution?.activity.reduce(
      (sum, item) => {
        if (item.kind === "tool") return sum + item.label.length;
        if (item.kind === "context") return sum;
        return sum + item.content.length;
      },
      0,
    );
    const characters =
      message.content.length +
      (executionCharacters ??
        (message.thinking?.length ?? 0) +
          (message.toolActivity?.reduce(
            (sum, activity) => sum + activity.length,
            0,
          ) ?? 0)) +
      (message.collaboration?.reduce(
        (sum, task) =>
          sum +
          task.description.length +
          (task.summary?.length ?? 0) +
          (task.toolActivity?.reduce(
            (activitySum, activity) => activitySum + activity.length,
            0,
          ) ?? 0),
        0,
      ) ?? 0);
    const attachmentTokens = (message.attachments?.length ?? 0) * 1_200;
    return total + Math.ceil(characters / 4) + attachmentTokens + 32;
  }, 0);
}
