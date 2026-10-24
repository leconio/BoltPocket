import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBrowserPageFindResult,
  parseBrowserPageInteractionReceipt,
  parseBrowserPageSnapshot,
  parseBrowserPageTextChunk,
} from "./browser-page-snapshot.ts";

function snapshot() {
  return {
    revision: "revision-one",
    url: "https://example.com/account?session=hidden",
    title: "Account",
    text: "Visible account page",
    controls: [
      {
        id: "control-1",
        kind: "link",
        label: "Orders",
        actions: ["click"],
        href: "https://example.com/orders?session=hidden",
      },
      {
        id: "control-2",
        kind: "input",
        label: "Password",
        actions: [],
        sensitive: true,
      },
    ],
  };
}

test("validates a bounded page snapshot without input values", () => {
  assert.deepEqual(parseBrowserPageSnapshot(snapshot()), snapshot());
});

test("rejects untrusted snapshots with duplicate controls or oversized text", () => {
  const duplicate = snapshot();
  duplicate.controls[1]!.id = "control-1";
  assert.throws(() => parseBrowserPageSnapshot(duplicate), /重复/u);
  assert.throws(
    () => parseBrowserPageSnapshot({ ...snapshot(), text: "x".repeat(16_001) }),
    /超出限制/u,
  );
});

test("rejects any page-provided form value field by omission at the protocol edge", () => {
  const value = snapshot() as ReturnType<typeof snapshot> & {
    controls: (ReturnType<typeof snapshot>["controls"][number] & {
      value?: string;
    })[];
  };
  value.controls[1]!.value = "must-not-cross-the-bridge";
  const parsed = parseBrowserPageSnapshot(value);
  assert.equal("value" in parsed.controls[1]!, false);
});

test("validates only bounded safe control actions and interaction receipts", () => {
  const parsed = parseBrowserPageSnapshot({
    ...snapshot(),
    controls: [
      {
        id: "control-1",
        kind: "input",
        label: "Search",
        actions: ["type"],
      },
    ],
  });
  assert.deepEqual(parsed.controls[0]?.actions, ["type"]);
  assert.throws(
    () =>
      parseBrowserPageSnapshot({
        ...snapshot(),
        controls: [
          {
            id: "control-1",
            kind: "input",
            label: "Password",
            actions: ["type"],
            sensitive: true,
          },
        ],
      }),
    /不安全/u,
  );
  assert.deepEqual(
    parseBrowserPageInteractionReceipt({
      action: "type",
      revision: "revision-one",
      url: "https://example.com/search",
      targetId: "control-1",
      inputLength: 12,
      value: "must-not-cross-the-bridge",
    }),
    {
      action: "type",
      revision: "revision-one",
      url: "https://example.com/search",
      targetId: "control-1",
      inputLength: 12,
    },
  );
  assert.throws(() =>
    parseBrowserPageInteractionReceipt({
      action: "click",
      revision: "revision-one",
      url: "https://example.com/search",
      targetId: "control-1",
      inputLength: 1,
    }),
  );
});

test("validates bounded long-page chunks and deterministic continuation offsets", () => {
  assert.deepEqual(
    parseBrowserPageTextChunk({
      revision: "revision-one",
      url: "https://example.com/report?secret=hidden",
      title: "Report",
      offset: 16_000,
      text: "next segment",
      searchedLength: 32_000,
      nextOffset: 16_012,
      truncated: true,
    }),
    {
      revision: "revision-one",
      url: "https://example.com/report?secret=hidden",
      title: "Report",
      offset: 16_000,
      text: "next segment",
      totalLength: 32_000,
      nextOffset: 16_012,
      truncated: true,
    },
  );
  assert.throws(
    () =>
      parseBrowserPageTextChunk({
        revision: "revision-one",
        url: "https://example.com/report",
        title: "Report",
        offset: 0,
        text: "segment",
        searchedLength: 20,
        nextOffset: 9,
        truncated: false,
      }),
    /下一段偏移/u,
  );
});

test("validates bounded full-page matches without accepting arbitrary fields", () => {
  const parsed = parseBrowserPageFindResult({
    revision: "revision-one",
    url: "https://example.com/report?secret=hidden",
    title: "Report",
    matches: [
      {
        offset: 20,
        snippet: "A matching report section",
        value: "must-not-cross-the-bridge",
      },
    ],
    totalMatches: 1,
    searchedLength: 2_000,
    truncated: false,
  });
  assert.deepEqual(parsed.matches, [
    { offset: 20, snippet: "A matching report section" },
  ]);
  assert.equal("value" in parsed.matches[0]!, false);
  assert.throws(
    () =>
      parseBrowserPageFindResult({
        revision: "revision-one",
        url: "https://example.com/report",
        title: "Report",
        matches: Array.from({ length: 21 }, (_, offset) => ({
          offset,
          snippet: "match",
        })),
        totalMatches: 21,
        searchedLength: 2_000,
        truncated: false,
      }),
    /数量超出/u,
  );
});
