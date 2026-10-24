import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  packageRoot,
  "src/upstream-openai-model-capacities.generated.ts",
);

const capacities = new Map();
for (const catalog of [OPENAI_MODELS, OPENAI_CODEX_MODELS]) {
  for (const model of Object.values(catalog)) {
    // Custom completion endpoints follow the public OpenAI catalog when an ID
    // also exists in the Codex catalog; Codex-only IDs fill the remaining set.
    if (capacities.has(model.id)) continue;
    capacities.set(model.id, {
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    });
  }
}

const entries = [...capacities].sort(([left], [right]) =>
  left.localeCompare(right, "en"),
);
const codexEntries = Object.values(OPENAI_CODEX_MODELS)
  .map((model) => [
    model.id,
    {
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsImages: model.input.includes("image"),
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap ?? {},
    },
  ])
  .sort(([left], [right]) => left.localeCompare(right, "en"));
const propertyName = (value) =>
  /^[$A-Z_a-z][$\w]*$/u.test(value) ? value : JSON.stringify(value);
const recordLiteral = (value) =>
  `{ ${Object.entries(value)
    .map(([key, item]) => `${propertyName(key)}: ${JSON.stringify(item)}`)
    .join(", ")} }`;
const generated = [
  "// Generated from the pinned @earendil-works/pi-ai model catalogs; do not edit.",
  "export const UPSTREAM_OPENAI_MODEL_CAPACITIES = {",
  ...entries.flatMap(([id, capacity]) => [
    `  ${propertyName(id)}: {`,
    `    contextWindow: ${capacity.contextWindow},`,
    `    maxTokens: ${capacity.maxTokens},`,
    "  },",
  ]),
  "} as const;",
  "",
  "export const UPSTREAM_OPENAI_CODEX_MODEL_CAPACITIES = {",
  ...codexEntries.flatMap(([id, capacity]) => [
    `  ${propertyName(id)}: {`,
    `    contextWindow: ${capacity.contextWindow},`,
    `    maxTokens: ${capacity.maxTokens},`,
    `    supportsImages: ${capacity.supportsImages},`,
    `    reasoning: ${capacity.reasoning},`,
    `    thinkingLevelMap: ${recordLiteral(capacity.thinkingLevelMap)},`,
    "  },",
  ]),
  "} as const;",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    throw new Error(
      "Generated OpenAI capacities are stale. Run pnpm --filter @boltpocket/agent-runtime generate:model-capacities.",
    );
  }
} else {
  await writeFile(outputPath, generated, "utf8");
}
