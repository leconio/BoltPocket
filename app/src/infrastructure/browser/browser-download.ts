import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { normalizeBrowserUrl } from "./browser-url";

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export async function downloadBrowserFile(url: string, signal?: AbortSignal) {
  const normalized = normalizeBrowserUrl(url);
  const directory = new Directory(
    Paths.cache,
    "browser-downloads",
    randomUUID(),
  );
  directory.create({ idempotent: true, intermediates: true });
  let file: File | undefined;
  try {
    file = await File.downloadFileAsync(normalized, directory, { signal });
    if (file.size > MAX_DOWNLOAD_BYTES) {
      file.delete();
      throw new Error("文件超过 100 MB，已停止保存。");
    }
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("当前设备没有可用的文件保存方式。");
    }
    await Sharing.shareAsync(file.uri, {
      dialogTitle: "保存文件",
      ...(file.type ? { mimeType: file.type } : {}),
    });
    return { name: file.name, size: file.size };
  } catch (error) {
    if (file?.exists) file.delete();
    throw error;
  }
}
