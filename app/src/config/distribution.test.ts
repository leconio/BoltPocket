import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CHINA_MAINLAND_DISTRIBUTION_PROFILE,
  GLOBAL_DISTRIBUTION_PROFILE,
  activateDistributionRegion,
  activeDistributionRegion,
  compiledDistributionRegion,
  distributionProfile,
  parseDistributionMode,
  parseDistributionRegion,
  unsupportedMiniAppNetworkOrigins,
} from "./distribution.ts";

test("distribution selector accepts only the two signed editions", () => {
  assert.equal(parseDistributionRegion(undefined), "global");
  assert.equal(parseDistributionRegion("global"), "global");
  assert.equal(parseDistributionRegion("china-mainland"), "china-mainland");
  assert.throws(
    () => parseDistributionRegion("cn"),
    /global or china-mainland/u,
  );
  assert.equal(distributionProfile("global"), GLOBAL_DISTRIBUTION_PROFILE);
  assert.equal(
    distributionProfile("china-mainland"),
    CHINA_MAINLAND_DISTRIBUTION_PROFILE,
  );
});

test("global mini apps use exact declarations while mainland requires signed registrations", () => {
  const origins = ["https://api.example.com", "wss://stream.example.com"];
  assert.deepEqual(unsupportedMiniAppNetworkOrigins(origins, "global"), []);
  assert.deepEqual(
    unsupportedMiniAppNetworkOrigins(origins, "china-mainland"),
    origins,
  );
});

test("automatic builds use the activated runtime region and default safely to global", () => {
  activateDistributionRegion("global");
  assert.equal(parseDistributionMode(undefined), "automatic");
  assert.equal(parseDistributionMode("automatic"), "automatic");
  assert.equal(compiledDistributionRegion("automatic"), "global");

  activateDistributionRegion("china-mainland");
  assert.equal(activeDistributionRegion(), "china-mainland");
  assert.equal(compiledDistributionRegion("automatic"), "china-mainland");
  assert.equal(distributionProfile(), CHINA_MAINLAND_DISTRIBUTION_PROFILE);

  activateDistributionRegion("global");
  assert.throws(() => parseDistributionMode("unknown"), /automatic/u);
});

test("runtime public variables are limited to region and native benchmark defaults", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (
        /\.(?:ts|tsx)$/u.test(entry.name) &&
        !entry.name.includes(".test.")
      ) {
        files.push(path);
      }
    }
  };
  visit(root);
  const variables = files.flatMap((path) =>
    [
      ...readFileSync(path, "utf8").matchAll(
        /process\.env\.(EXPO_PUBLIC_BOLTPOCKET_[A-Z0-9_]+)/gu,
      ),
    ].map((match) => match[1]),
  );
  assert.deepEqual([...new Set(variables)].sort(), [
    "EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION",
    "EXPO_PUBLIC_BOLTPOCKET_GPU_LAYERS",
    "EXPO_PUBLIC_BOLTPOCKET_MODEL_PROFILE",
  ]);
});
