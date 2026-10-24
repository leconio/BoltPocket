type CostRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: (CostRates & { inputTokensAbove: number })[];
};

/**
 * Pi's OpenAI provider imports these two pure helpers through `models.js`.
 * Re-exporting that module would pull the full provider/auth registry into the
 * React Native graph, so this is the only remaining source-level compatibility
 * copy. `rn-pi-shims.test.ts` checks it against the pinned upstream behavior.
 */

type ModelLike = {
  reasoning: boolean;
  cost: CostRates;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

type UsageLike = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

type ThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const thinkingLevels: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function calculateCost(model: ModelLike, usage: UsageLike) {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates = model.cost;
  let threshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (
      inputTokens > tier.inputTokensAbove &&
      tier.inputTokensAbove > threshold
    ) {
      rates = tier;
      threshold = tier.inputTokensAbove;
    }
  }
  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = (rates.input / 1_000_000) * usage.input;
  usage.cost.output = (rates.output / 1_000_000) * usage.output;
  usage.cost.cacheRead = (rates.cacheRead / 1_000_000) * usage.cacheRead;
  usage.cost.cacheWrite =
    (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1_000_000;
  usage.cost.total =
    usage.cost.input +
    usage.cost.output +
    usage.cost.cacheRead +
    usage.cost.cacheWrite;
  return usage.cost;
}

export function clampThinkingLevel(model: ModelLike, level: ThinkingLevel) {
  if (!model.reasoning) return "off" as const;
  const available = thinkingLevels.filter((candidate) => {
    const mapped = model.thinkingLevelMap?.[candidate];
    if (mapped === null) return false;
    if (candidate === "xhigh" || candidate === "max") {
      return mapped !== undefined;
    }
    return true;
  });
  if (available.includes(level)) return level;
  const requestedIndex = thinkingLevels.indexOf(level);
  for (let index = requestedIndex; index < thinkingLevels.length; index += 1) {
    const candidate = thinkingLevels[index];
    if (candidate && available.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = thinkingLevels[index];
    if (candidate && available.includes(candidate)) return candidate;
  }
  return available[0] ?? "off";
}
