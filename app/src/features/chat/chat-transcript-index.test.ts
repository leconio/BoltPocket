import assert from "node:assert/strict";
import test from "node:test";

import { initialAppState } from "@/domain/app-state";
import type { ChatMessage } from "@/domain/models";

import { createChatMessageRowSelector } from "./chat-transcript-index.ts";

test("a completed message row retains identity across footer and append updates", () => {
  const completed: ChatMessage = {
    id: "assistant-completed",
    role: "assistant",
    content: "Done",
  };
  const initial = {
    ...initialAppState,
    messagesByConversation: { conversation: [completed] },
  };
  const selector = createChatMessageRowSelector("conversation", completed.id);
  const first = selector(initial);

  const footerChanged = selector({
    ...initial,
    runErrorsByConversation: { conversation: "Network unavailable" },
    storageError: "Storage unavailable",
  });
  assert.equal(footerChanged, first);

  const appended: ChatMessage = {
    id: "assistant-later",
    role: "assistant",
    content: "Later",
  };
  const transcriptChanged = selector({
    ...initial,
    messagesByConversation: {
      conversation: [completed, appended],
    },
  });
  assert.equal(transcriptChanged, first);

  const edited = selector({
    ...initial,
    messagesByConversation: {
      conversation: [{ ...completed, content: "Updated" }, appended],
    },
  });
  assert.notEqual(edited, first);
  assert.equal(edited.message?.content, "Updated");
});
