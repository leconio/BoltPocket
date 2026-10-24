import assert from "node:assert/strict";
import test from "node:test";

import {
  messageCatalogs,
  messagePlaceholders,
  translateMessage,
  type MessageKey,
} from "./messages.ts";

const HAN = /[\u3400-\u9fff]/u;

test("explicit message catalogs contain the same page-qualified keys", () => {
  const chineseKeys = Object.keys(messageCatalogs["zh-CN"]).sort();
  const englishKeys = Object.keys(messageCatalogs.en).sort();

  assert.deepEqual(englishKeys, chineseKeys);
  assert.ok(chineseKeys.every((key) => key.split(".").length >= 3));
  assert.equal(
    Object.values(messageCatalogs.en).some((message) => HAN.test(message)),
    false,
  );
});

test("explicit translations preserve the same named parameters", () => {
  for (const key of Object.keys(messageCatalogs.en) as MessageKey[]) {
    assert.deepEqual(
      [...messagePlaceholders(messageCatalogs.en[key])].sort(),
      [...messagePlaceholders(messageCatalogs["zh-CN"][key])].sort(),
      key,
    );
  }

  assert.equal(
    translateMessage("chat.screen.openProject", "en", { name: "Atlas" }),
    "Open project Atlas",
  );
  assert.equal(
    translateMessage("chat.screen.openProject", "zh-CN", { name: "Atlas" }),
    "打开项目 Atlas",
  );
});
