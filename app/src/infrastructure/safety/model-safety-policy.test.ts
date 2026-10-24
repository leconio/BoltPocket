import assert from "node:assert/strict";
import test from "node:test";

import { ModelSafetyPolicy } from "./model-safety-policy.ts";

test("model safety checks fail closed, block disabled models, and cache allows", async () => {
  let requests = 0;
  let allowed = true;
  const policy = new ModelSafetyPolicy(
    { baseUrl: "https://safety.example", returnUrl: "boltpocket://oauth/complete" },
    {
      now: () => 1_000,
      fetch: (async () => {
        requests += 1;
        return Response.json({ allowed, checkedAt: 1_000 });
      }) as typeof fetch,
    },
  );
  await policy.assertAllowed({ model: "model-1", providerId: "provider-1" });
  await policy.assertAllowed({ model: "model-1", providerId: "provider-1" });
  assert.equal(requests, 1);

  allowed = false;
  await assert.rejects(
    policy.assertAllowed({ model: "model-2", providerId: "provider-1" }),
    /暂停使用/u,
  );

  const unavailable = new ModelSafetyPolicy(
    { baseUrl: "https://safety.example", returnUrl: "boltpocket://oauth/complete" },
    {
      fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch,
    },
  );
  await assert.rejects(
    unavailable.assertAllowed({ model: "model-1", providerId: "provider-1" }),
    /无法完成/u,
  );

  const timedOut = new ModelSafetyPolicy(
    { baseUrl: "https://safety.example", returnUrl: "boltpocket://oauth/complete" },
    {
      requestTimeoutMs: 5,
      fetch: (async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        })) as typeof fetch,
    },
  );
  await assert.rejects(
    timedOut.assertAllowed({ model: "model-1", providerId: "provider-1" }),
    /无法完成/u,
  );
});
