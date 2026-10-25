import Native from "@boltpocket/expo-bolt-runtime";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import {
  artifactSpec,
  DEFAULT_LOCAL_MODEL_ID,
  localModelById,
  modelDownloadUrl,
  type LocalModelId,
} from "./local-model-catalog";
import { LocalDownloadController } from "./local-download-controller";
import { parseLocalModelPreference } from "./model-source-selection";

export const localDownloads = new LocalDownloadController({
  info: (id) => Native.modelArtifactInfo(artifactSpec(localModelById(id))),
  async removePartial(id) {
    const info = await Native.modelArtifactInfo(
      artifactSpec(localModelById(id)),
    );
    await FileSystem.deleteAsync(info.partialUri, { idempotent: true });
  },
  commit: (id) => Native.commitModelArtifact(artifactSpec(localModelById(id))),
  transfer(id, uri, progress) {
    const transfer = FileSystem.createDownloadResumable(
      modelDownloadUrl(localModelById(id)),
      uri,
      { sessionType: FileSystem.FileSystemSessionType.FOREGROUND },
      (event) => progress(event.totalBytesWritten),
    );
    return {
      async run() {
        try {
          if (Platform.OS === "android") await Native.beginModelDownloadRoute();
          return await transfer.downloadAsync();
        } finally {
          if (Platform.OS === "android") await Native.endModelDownloadRoute();
        }
      },
      cancel: () => transfer.cancelAsync(),
    };
  },
});

const selectionUri = () => {
  if (!FileSystem.documentDirectory)
    throw new Error("Local storage unavailable");
  return FileSystem.documentDirectory + "local-model-selection.json";
};
export async function selectedLocalModelId(): Promise<LocalModelId> {
  return (await localModelPreference()).id;
}
export async function localModelPreference() {
  try {
    return parseLocalModelPreference(
      JSON.parse(await FileSystem.readAsStringAsync(selectionUri())),
    );
  } catch {
    return { id: DEFAULT_LOCAL_MODEL_ID, active: false };
  }
}
let selecting = false;
export async function selectLocalModel(id: LocalModelId) {
  if (selecting) throw new Error("Model selection is being saved");
  selecting = true;
  try {
    const info = await Native.modelArtifactInfo(
      artifactSpec(localModelById(id)),
    );
    if (!info.ready) throw new Error("Model has not been verified");
    const uri = selectionUri();
    await FileSystem.writeAsStringAsync(
      uri + ".tmp",
      JSON.stringify({ id, active: true }),
    );
    await FileSystem.moveAsync({ from: uri + ".tmp", to: uri });
  } finally {
    selecting = false;
  }
}
export async function useApiModelDefault() {
  if (selecting) throw new Error("Model selection is being saved");
  selecting = true;
  try {
    const preference = await localModelPreference();
    const uri = selectionUri();
    await FileSystem.writeAsStringAsync(
      uri + ".tmp",
      JSON.stringify({ ...preference, active: false }),
    );
    await FileSystem.moveAsync({ from: uri + ".tmp", to: uri });
  } finally {
    selecting = false;
  }
}
