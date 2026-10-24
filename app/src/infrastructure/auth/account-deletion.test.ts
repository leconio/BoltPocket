import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthenticationError,
  type AuthenticationErrorCode,
} from "./casdoor-authentication.ts";
import { AccountDeletionService } from "./account-deletion.ts";

test("account deletion uses only the authenticated first-party endpoint before clearing local session", async () => {
  const events: string[] = [];
  const service = new AccountDeletionService({
    authentication: {
      async completeAccountDeletion() {
        events.push("session:clear");
      },
    },
    baseUrl: "https://api.example.com",
    fetch: (async (input, init) => {
      events.push("api:delete");
      assert.equal(String(input), "https://api.example.com/v1/account");
      assert.equal(init?.method, "DELETE");
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });

  await service.deleteAccount();
  assert.deepEqual(events, ["api:delete", "session:clear"]);
});

test("account deletion keeps the local session when the server did not confirm deletion", async () => {
  let cleared = false;
  for (const [status, expected] of [
    [401, "session_expired"],
    [503, "server"],
  ] as const) {
    const service = new AccountDeletionService({
      authentication: {
        async completeAccountDeletion() {
          cleared = true;
        },
      },
      baseUrl: "https://api.example.com",
      fetch: (async () => new Response(null, { status })) as typeof fetch,
    });
    await assert.rejects(
      service.deleteAccount(),
      (error: unknown) => authenticationCode(error) === expected,
    );
  }
  assert.equal(cleared, false);
});

test("account deletion maps transport failure without exposing server content", async () => {
  const service = new AccountDeletionService({
    authentication: { async completeAccountDeletion() {} },
    baseUrl: "https://api.example.com",
    fetch: (async () => {
      throw new Error("secret transport detail");
    }) as typeof fetch,
  });

  await assert.rejects(
    service.deleteAccount(),
    (error: unknown) => authenticationCode(error) === "network",
  );
});

function authenticationCode(error: unknown): AuthenticationErrorCode | null {
  return error instanceof AuthenticationError ? error.code : null;
}
