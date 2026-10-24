const MAX_EXTERNAL_URL_LENGTH = 2_048;
const DISALLOWED_SCHEMES = new Set([
  "about",
  "blob",
  "data",
  "file",
  "javascript",
  "boltpocket",
]);

export type ExternalAppTarget = Readonly<{
  scheme: string;
  url: string;
}>;

export function parseExternalAppTarget(value: string | undefined) {
  const url = value?.trim() ?? "";
  if (
    !url ||
    url !== value ||
    url.length > MAX_EXTERNAL_URL_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(url)
  ) {
    throw new Error("外部 App 地址无效。");
  }
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(url);
  if (!match) throw new Error("外部 App 地址必须包含 URI scheme。");
  const scheme = match[1]!.toLowerCase();
  if (DISALLOWED_SCHEMES.has(scheme)) {
    throw new Error(`不能把 ${scheme}: 地址交给外部 App。`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("外部 App 地址格式无效。", { cause: error });
  }
  if (parsed.username || parsed.password) {
    throw new Error("外部 App 地址不能携带内嵌账号或密码。");
  }
  return Object.freeze({ scheme, url }) satisfies ExternalAppTarget;
}

export function externalAppDataDescription(value: string | undefined) {
  const target = parseExternalAppTarget(value);
  return `把 ${target.url} 交给系统，由已注册 ${target.scheme}: 的外部 App 打开`;
}

export class ExternalAppOperations {
  readonly #openUrl: (url: string) => Promise<unknown>;

  constructor(
    openUrl: (url: string) => Promise<unknown> = async (url) => {
      const { Linking } = await import("react-native");
      return Linking.openURL(url);
    },
  ) {
    this.#openUrl = openUrl;
  }

  async open(value: string | undefined, signal?: AbortSignal) {
    const target = parseExternalAppTarget(value);
    if (signal?.aborted) throw abortError();
    await this.#openUrl(target.url);
    return Object.freeze({
      opened: true,
      scheme: target.scheme,
      openedAt: new Date().toISOString(),
    });
  }
}

function abortError() {
  const error = new Error("打开外部 App 已取消。");
  error.name = "AbortError";
  return error;
}
