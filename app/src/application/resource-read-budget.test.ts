import assert from "node:assert/strict";
import test from "node:test";

import { ResourceReadBudget } from "./resource-read-budget.ts";

test("resource reads are counted once and remain queryable", () => {
  const budget = new ResourceReadBudget({
    maxResources: 2,
    maxCharacters: 10,
  });

  budget.register("one", 6);
  budget.register("one", 6);

  assert.equal(budget.has("one"), true);
  assert.equal(budget.resourceCount, 1);
  assert.equal(budget.characterCount, 6);
});

test("resource read count and character limits fail closed", () => {
  const countBudget = new ResourceReadBudget({
    maxResources: 1,
    maxCharacters: 100,
  });
  countBudget.register("one", 1);
  assert.throws(() => countBudget.register("two", 1), /最多读取 1 个资源/);

  const characterBudget = new ResourceReadBudget({
    maxResources: 2,
    maxCharacters: 5,
  });
  characterBudget.register("one", 4);
  assert.throws(() => characterBudget.register("two", 2), /超过 5 字符/);
  assert.equal(characterBudget.has("two"), false);
});
