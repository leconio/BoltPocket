import assert from "node:assert/strict";
import test from "node:test";

import { SafetyReportError } from "@/application/ports/safety-report";

import { ExpoSafetyReportService } from "./expo-safety-report-service.ts";

const INSTALLATION_ID = "00000000-0000-4000-8000-000000000001";
const REPORT_ID = "00000000-0000-4000-8000-000000000002";

test("safety reports omit content unless the user explicitly includes it", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const service = createService({
    fetch: (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(
        { expiresAt: 2_000, reportId: REPORT_ID, status: "received" },
        { status: 201 },
      );
    }) as typeof fetch,
  });

  await service.submit({
    category: "unsafe",
    includeContent: false,
    targetId: "message-1",
    targetType: "assistant_message",
  });

  assert.equal(requestBody?.excerpt, undefined);
  assert.equal(requestBody?.note, undefined);
  assert.equal(requestBody?.platform, "ios");
  assert.equal(requestBody?.appVersion, "1.2.3");
});

test("safety report rate limits use a typed client error", async () => {
  const service = createService({
    fetch: (async () =>
      Response.json(
        { error: { code: "report_rate_limited" } },
        { status: 429 },
      )) as typeof fetch,
  });

  await assert.rejects(
    () =>
      service.submit({
        category: "spam",
        includeContent: false,
        targetId: "message-1",
        targetType: "assistant_message",
      }),
    (error) =>
      error instanceof SafetyReportError && error.code === "rate-limited",
  );
});

test("safety report transport aborts on a bounded timeout", async () => {
  const service = createService({
    requestTimeoutMs: 5,
    fetch: (async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      })) as typeof fetch,
  });

  await assert.rejects(
    () =>
      service.submit({
        category: "other",
        includeContent: false,
        targetId: "message-1",
        targetType: "assistant_message",
      }),
    (error) =>
      error instanceof SafetyReportError && error.code === "submit-failed",
  );
});

function createService(
  options: ConstructorParameters<typeof ExpoSafetyReportService>[1],
) {
  return new ExpoSafetyReportService(
    {
      baseUrl: "https://safety.example.com",
      returnUrl: "boltpocket://oauth/complete",
    },
    {
      appVersion: "1.2.3",
      installationIdentity: async () => INSTALLATION_ID,
      locale: () => "en",
      platform: "ios",
      ...options,
    },
  );
}
