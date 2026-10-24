import assert from "node:assert/strict";
import test from "node:test";

import type { AiDataRecipient } from "@/application/ports/ai-data-consent";
import { InMemoryDurableDocumentStore } from "@/infrastructure/persistence/document-store";

import { AiDataConsentBroker } from "./ai-data-consent-broker.ts";
import { AiDataConsentRepository } from "./ai-data-consent-repository.ts";

class CountingDocumentStore extends InMemoryDurableDocumentStore {
  reads = 0;

  override async read(key: string) {
    this.reads += 1;
    return super.read(key);
  }
}

const recipient: AiDataRecipient = {
  providerId: "provider-1",
  providerName: "模型服务",
  baseUrl: "https://ai.example.com/v1",
  modelId: "model-1",
  modelName: "Model 1",
  recipientName: "Example AI",
  recipientLocation: "美国",
  filingNumber: null,
  crossBorder: true,
};

test("first model disclosure requires approval and the exact grant is reused", async () => {
  const repository = new AiDataConsentRepository(
    new InMemoryDurableDocumentStore(),
  );
  let sequence = 0;
  const broker = new AiDataConsentBroker(
    repository,
    () => `request-${++sequence}`,
    () => new Date("2026-08-09T00:00:00.000Z"),
  );
  const pending = broker.requestConsent(recipient, ["message", "attachments"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(broker.pending()?.recipientName, "Example AI");
  await broker.approve("request-1");
  assert.equal(await pending, true);

  assert.equal(
    await broker.requestConsent(recipient, ["message", "attachments"]),
    true,
  );
  assert.equal(broker.pending(), null);
  assert.equal((await broker.listGrants()).length, 1);
});

test("a broader disclosure asks again and withdrawal invalidates every grant", async () => {
  const broker = new AiDataConsentBroker(
    new AiDataConsentRepository(new InMemoryDurableDocumentStore()),
    (() => {
      let sequence = 0;
      return () => `request-${++sequence}`;
    })(),
  );
  const first = broker.requestConsent(recipient, ["message"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await broker.approve("request-1");
  assert.equal(await first, true);

  const broader = broker.requestConsent(recipient, [
    "message",
    "project-context",
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(broker.pending()?.requestId, "request-2");
  broker.deny("request-2");
  assert.equal(await broader, false);

  await broker.withdrawAll();
  assert.deepEqual(await broker.listGrants(), []);
});

test("validated consent manifests are reused without repeated durable reads", async () => {
  const store = new CountingDocumentStore();
  const repository = new AiDataConsentRepository(store);

  assert.deepEqual(await repository.list(), []);
  assert.deepEqual(await repository.list(), []);
  assert.equal(await repository.find("missing"), null);
  assert.equal(store.reads, 1);
});

test("Mainland AI disclosure requires a separate consent record", async () => {
  const store = new InMemoryDurableDocumentStore();
  const globalBroker = new AiDataConsentBroker(
    new AiDataConsentRepository(store),
    () => "global-request",
  );
  const globalConsent = globalBroker.requestConsent(recipient, ["message"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await globalBroker.approve("global-request");
  assert.equal(await globalConsent, true);

  const mainlandBroker = new AiDataConsentBroker(
    new AiDataConsentRepository(store, "china-mainland"),
    () => "mainland-request",
  );
  assert.deepEqual(await mainlandBroker.listGrants(), []);
  const mainlandConsent = mainlandBroker.requestConsent(recipient, ["message"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(mainlandBroker.pending()?.requestId, "mainland-request");
  mainlandBroker.deny("mainland-request");
  assert.equal(await mainlandConsent, false);
});
