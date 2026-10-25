import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalDownloadController, type DownloadPort } from "./local-download-controller.ts";
import { LOCAL_MODELS, modelDownloadUrl } from "./local-model-catalog.ts";

const bonsai = LOCAL_MODELS[0], nemotron = LOCAL_MODELS[1];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(overrides: Partial<DownloadPort> = {}) {
  const calls: string[] = [];
  const ready = new Set<string>();
  const port: DownloadPort = {
    async info(id) { return { ready: ready.has(id), partialUri: "file:///model.part", freeBytes: 10e9 }; },
    async removePartial(id) { calls.push("cleanup:" + id); },
    async commit(id) { calls.push("commit:" + id); ready.add(id); },
    transfer(id, _uri, progress) {
      calls.push("transfer:" + id);
      return { async run() { progress(100); return { status: 200 }; }, async cancel() {} };
    },
    ...overrides,
  };
  return { controller: new LocalDownloadController(port), calls, ready };
}
test("a model becomes ready only after verification; >4 GiB lengths are preserved", async () => {
  const gate = deferred<void>();
  const { controller } = fixture({ async commit() { await gate.promise; } });
  const operation = controller.download(nemotron.id);
  while (controller.snapshot()[nemotron.id].phase !== "verifying") await new Promise(setImmediate);
  assert.equal(controller.snapshot()[nemotron.id].received, 5060482240);
  gate.resolve();
  await operation;
  assert.equal(controller.snapshot()[nemotron.id].phase, "ready");
  assert.equal(controller.snapshot()[bonsai.id].phase, "missing");
});
test("hash failure never enables a model and retry succeeds", async () => {
  let attempts = 0;
  const { controller, calls } = fixture({ async commit() {
    if (++attempts === 1) throw new Error("bad digest");
  } });
  await controller.download(bonsai.id);
  assert.equal(controller.snapshot()[bonsai.id].phase, "error");
  assert.equal(controller.snapshot()[bonsai.id].error, "integrity");
  assert.equal(calls.filter((x) => x.startsWith("cleanup")).length, 2);
  await controller.download(bonsai.id);
  assert.equal(controller.snapshot()[bonsai.id].phase, "ready");
});
test("HTTP errors, even with a completed body, never reach the verifier", async () => {
  const { controller, calls } = fixture({ transfer() {
    return { async run() { return { status: 403 }; }, async cancel() {} };
  } });
  await controller.download(bonsai.id);
  assert.equal(controller.snapshot()[bonsai.id].error, "network");
  assert.ok(!calls.some((x) => x.startsWith("commit")));
});
test("low disk space prevents a large model transfer", async () => {
  const { controller, calls } = fixture({ async info() {
    return { ready: false, partialUri: "file:///model.part", freeBytes: nemotron.bytes };
  } });
  await controller.download(nemotron.id);
  assert.equal(controller.snapshot()[nemotron.id].error, "storage");
  assert.ok(!calls.some((x) => x.startsWith("transfer")));
});
test("retry reclaims an interrupted partial before checking storage", async () => {
  let reclaimed = false;
  const { controller } = fixture({
    async info() {
      return { ready: false, partialUri: "file:///model.part",
        freeBytes: reclaimed ? 10e9 : 1e6 };
    },
    async removePartial() { reclaimed = true; },
  });
  await controller.download(nemotron.id);
  assert.equal(controller.snapshot()[nemotron.id].phase, "ready");
});
test("cancel waits for the writer, blocks concurrent downloads, then allows retry", async () => {
  const writer = deferred<{ status: number } | undefined>();
  let transfers = 0;
  const { controller, calls } = fixture({ transfer(id) {
    transfers++;
    return { run: () => writer.promise, async cancel() { calls.push("cancel:" + id); } };
  } });
  const operation = controller.download(bonsai.id);
  while (!transfers) await new Promise(setImmediate);
  await controller.cancel(bonsai.id);
  await controller.download(nemotron.id);
  assert.equal(transfers, 1);
  assert.equal(controller.snapshot()[bonsai.id].phase, "cancelling");
  writer.resolve(undefined);
  await operation;
  assert.equal(controller.snapshot()[bonsai.id].phase, "missing");
  assert.ok(!calls.some((x) => x.startsWith("commit")));
  await controller.download(nemotron.id);
  assert.equal(transfers, 2);
});
test("a stale refresh cannot erase a live transfer", async () => {
  const stale = deferred<{ ready: boolean; partialUri: string; freeBytes: number }>();
  const writer = deferred<{ status: number } | undefined>();
  let first = true;
  const { controller } = fixture({
    async info(id) {
      if (id === bonsai.id && first) { first = false; return stale.promise; }
      return { ready: false, partialUri: "file:///model.part", freeBytes: 10e9 };
    },
    transfer() { return { run: () => writer.promise, async cancel() {} }; },
  });
  const refresh = controller.refresh();
  const download = controller.download(bonsai.id);
  stale.resolve({ ready: false, partialUri: "file:///model.part", freeBytes: 10e9 });
  await refresh;
  assert.equal(controller.snapshot()[bonsai.id].phase, "downloading");
  writer.resolve({ status: 200 }); await download;
});
test("catalog links pin immutable revisions and distinct artifacts", () => {
  assert.notEqual(bonsai.sha256, nemotron.sha256);
  for (const model of LOCAL_MODELS) {
    assert.match(model.revision, /^[a-f0-9]{40}$/);
    assert.match(model.sha256, /^[a-f0-9]{64}$/);
    assert.ok(modelDownloadUrl(model).includes("/resolve/" + model.revision + "/"));
  }
});
