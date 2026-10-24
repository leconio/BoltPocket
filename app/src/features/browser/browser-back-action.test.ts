import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrowserBackAction } from "./browser-back-action.ts";

const baseState = {
  canGoBack: false,
  fullscreen: false,
};

test("browser back exits full screen before navigating or minimizing", () => {
  assert.equal(
    resolveBrowserBackAction({
      canGoBack: true,
      fullscreen: true,
    }),
    "exit-fullscreen",
  );
});

test("browser back navigates when possible and otherwise minimizes", () => {
  assert.equal(
    resolveBrowserBackAction({ ...baseState, canGoBack: true }),
    "navigate-back",
  );
  assert.equal(resolveBrowserBackAction(baseState), "minimize");
});
