import { requireOptionalNativeModule } from "expo-modules-core";

type NativeProjectPreviewServer = {
  start(
    snapshotId: string,
    rootUri: string,
    runtimeRootUri: string,
  ): Promise<number>;
  stop(snapshotId: string): Promise<void>;
};

const nativeModule = requireOptionalNativeModule<NativeProjectPreviewServer>(
  "BoltPocketProjectPreviewServer",
);

function requiredModule(): NativeProjectPreviewServer {
  if (!nativeModule) {
    throw new Error(
      "The iOS project preview server is unavailable in this app build.",
    );
  }
  return nativeModule;
}

function assertSnapshotId(snapshotId: string) {
  if (!/^[a-f0-9]{32}$/u.test(snapshotId)) {
    throw new Error("Project preview snapshot id is invalid.");
  }
}

function assertRootUri(rootUri: string) {
  let parsed: URL;
  try {
    parsed = new URL(rootUri);
  } catch {
    throw new Error("Project preview root is invalid.");
  }
  if (
    parsed.protocol !== "file:" ||
    parsed.host ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Project preview root is invalid.");
  }
}

export const projectPreviewServerAvailable = Boolean(nativeModule);

export async function startProjectPreviewServer(
  snapshotId: string,
  rootUri: string,
  runtimeRootUri: string,
) {
  assertSnapshotId(snapshotId);
  assertRootUri(rootUri);
  assertRootUri(runtimeRootUri);
  const port = await requiredModule().start(
    snapshotId,
    rootUri,
    runtimeRootUri,
  );
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    await requiredModule()
      .stop(snapshotId)
      .catch(() => undefined);
    throw new Error("Project preview server returned an invalid port.");
  }
  return `http://127.0.0.1:${port}/${snapshotId}/content/`;
}

export async function stopProjectPreviewServer(snapshotId: string) {
  assertSnapshotId(snapshotId);
  if (!nativeModule) return;
  await nativeModule.stop(snapshotId);
}
