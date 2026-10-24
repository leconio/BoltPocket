import assert from "node:assert/strict";
import test from "node:test";

import { ConnectorError } from "@boltpocket/connector-core";

import {
  RecoverableNativeTextStorage,
  type NativeTextFilePort,
} from "./recoverable-native-text-storage.ts";

class FakeNativeFiles implements NativeTextFilePort {
  text = "draft";
  recoveries = new Map<string, string>();
  failAfterPartialWrite = false;
  failRestore = false;
  writes = 0;

  async readText() {
    return this.text;
  }

  async writeText(_locator: string, text: string) {
    this.writes += 1;
    if (this.failAfterPartialWrite && this.writes === 1) {
      this.text = "partial";
      throw new Error("provider interrupted");
    }
    if (this.failRestore && this.writes > 1) {
      throw new Error("provider refused restore");
    }
    this.text = text;
  }

  async persistRecovery(_locator: string, snapshot: { text: string }) {
    const ref = `recovery-${this.recoveries.size + 1}`;
    this.recoveries.set(ref, snapshot.text);
    return ref;
  }
}

const versionText = async (text: string) => `sha256:${text}`;

function fixture() {
  const files = new FakeNativeFiles();
  const storage = new RecoverableNativeTextStorage({
    allowedLocators: ["content://workspace/plan.txt"],
    files,
    versionText,
  });
  return { files, storage };
}

test("native replacement requires a matching durable recovery", async () => {
  const { files, storage } = fixture();

  await assert.rejects(
    storage.replaceWithRecovery(
      "content://workspace/plan.txt",
      "sha256:draft",
      "ready",
    ),
    (error) =>
      error instanceof ConnectorError && error.code === "recovery_failed",
  );
  assert.equal(files.text, "draft");
});

test("native replacement verifies the provider result", async () => {
  const { files, storage } = fixture();
  const before = await storage.read("content://workspace/plan.txt");
  const recovery = await storage.createRecoveryPoint(before.locator, before);
  const result = await storage.replaceWithRecovery(
    before.locator,
    before.version,
    "ready",
  );

  assert.equal(files.recoveries.get(recovery.storageRef), "draft");
  assert.equal(result.text, "ready");
  assert.equal(result.version, "sha256:ready");
});

test("a partial provider write is automatically restored", async () => {
  const { files, storage } = fixture();
  const before = await storage.read("content://workspace/plan.txt");
  await storage.createRecoveryPoint(before.locator, before);
  files.failAfterPartialWrite = true;

  await assert.rejects(
    storage.replaceWithRecovery(before.locator, before.version, "ready"),
    (error) =>
      error instanceof ConnectorError &&
      error.code === "io_failure" &&
      error.retryable,
  );
  assert.equal(files.text, "draft");
});

test("out-of-scope native locators are rejected before I/O", async () => {
  const { files, storage } = fixture();

  await assert.rejects(
    storage.read("content://other/private.txt"),
    (error) =>
      error instanceof ConnectorError && error.code === "permission_denied",
  );
  assert.equal(files.writes, 0);
});
