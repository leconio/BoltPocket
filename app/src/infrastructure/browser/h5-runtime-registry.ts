import type {
  ProjectH5Addon,
  ProjectH5Manifest,
  ProjectH5Profile,
} from "@/domain/project-h5-manifest";

export type H5RuntimeAsset = Readonly<{
  id: string;
  packageName: string;
  version: string;
  sources: readonly H5RuntimeSource[];
  sha256: string;
  byteLength: number;
  extension: "js";
  allowedMimeTypes: readonly string[];
  license: "Apache-2.0" | "MIT";
  licenseUrl: string;
}>;

export const H5_RUNTIME_SOURCE_IDS = Object.freeze([
  "npmmirror",
  "bootcdn",
  "staticfile",
  "jsdelivr",
  "unpkg",
] as const);

export type H5RuntimeSourceId = (typeof H5_RUNTIME_SOURCE_IDS)[number];

export type H5RuntimeSource = Readonly<{
  id: H5RuntimeSourceId;
  region: "mainland" | "global";
  url: string;
}>;

const H5_RUNTIME_SOURCE_HOSTS: Readonly<Record<H5RuntimeSourceId, string>> =
  Object.freeze({
    npmmirror: "registry.npmmirror.com",
    bootcdn: "cdn.bootcdn.net",
    staticfile: "cdn.staticfile.net",
    jsdelivr: "cdn.jsdelivr.net",
    unpkg: "unpkg.com",
  });

const JAVASCRIPT_MIME_TYPES = Object.freeze([
  "application/javascript",
  "application/x-javascript",
  "text/javascript",
  "text/plain",
]);

export function normalizeH5RuntimeMimeType(value: unknown) {
  return typeof value === "string"
    ? (value.split(";", 1)[0]?.trim().toLowerCase() ?? "")
    : "";
}

export function isH5RuntimeSourceId(
  value: unknown,
): value is H5RuntimeSourceId {
  return H5_RUNTIME_SOURCE_IDS.some((candidate) => candidate === value);
}

export function isTrustedH5RuntimeSource(
  asset: Pick<H5RuntimeAsset, "packageName" | "version">,
  source: H5RuntimeSource,
) {
  try {
    const url = new URL(source.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== H5_RUNTIME_SOURCE_HOSTS[source.id] ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return false;
    }
    const packageName = asset.packageName;
    const version = asset.version;
    if (source.id === "npmmirror") {
      return url.pathname.startsWith(
        `/${encodeURIComponent(packageName)}/${version}/files/`,
      );
    }
    if (source.id === "jsdelivr") {
      return url.pathname.startsWith(`/npm/${packageName}@${version}/`);
    }
    if (source.id === "unpkg") {
      return url.pathname.startsWith(`/${packageName}@${version}/`);
    }
    if (source.id === "bootcdn") {
      return url.pathname.startsWith(`/ajax/libs/${packageName}/${version}/`);
    }
    return url.pathname.startsWith(`/${packageName}/${version}/`);
  } catch {
    return false;
  }
}

function source(
  id: H5RuntimeSourceId,
  region: H5RuntimeSource["region"],
  url: string,
): H5RuntimeSource {
  return Object.freeze({ id, region, url });
}

function npmSources(packageName: string, version: string, filePath: string) {
  return Object.freeze([
    source(
      "npmmirror",
      "mainland",
      `https://registry.npmmirror.com/${encodeURIComponent(packageName)}/${version}/files/${filePath}`,
    ),
    source(
      "jsdelivr",
      "global",
      `https://cdn.jsdelivr.net/npm/${packageName}@${version}/${filePath}`,
    ),
    source(
      "unpkg",
      "global",
      `https://unpkg.com/${packageName}@${version}/${filePath}`,
    ),
  ]);
}

export const H5_RUNTIME_ASSETS = Object.freeze({
  preact: Object.freeze({
    id: "preact",
    packageName: "preact",
    version: "10.27.2",
    sources: npmSources("preact", "10.27.2", "dist/preact.umd.js"),
    sha256: "c4f1db5a7db8fdc142158e13687c24a4376cbd8eafdbc5b924da0f5b048aacf9",
    byteLength: 11_363,
    extension: "js",
    allowedMimeTypes: JAVASCRIPT_MIME_TYPES,
    license: "MIT",
    licenseUrl: "https://github.com/preactjs/preact/blob/10.27.2/LICENSE",
  }),
  preactHooks: Object.freeze({
    id: "preact-hooks",
    packageName: "preact",
    version: "10.27.2",
    sources: npmSources("preact", "10.27.2", "hooks/dist/hooks.umd.js"),
    sha256: "c2a0121123419a0788e7a3e0adde79f9f9dc9d455c918abbfe6f74651b4be054",
    byteLength: 3_906,
    extension: "js",
    allowedMimeTypes: JAVASCRIPT_MIME_TYPES,
    license: "MIT",
    licenseUrl: "https://github.com/preactjs/preact/blob/10.27.2/LICENSE",
  }),
  htm: Object.freeze({
    id: "htm",
    packageName: "htm",
    version: "3.1.1",
    sources: npmSources("htm", "3.1.1", "dist/htm.umd.js"),
    sha256: "7a31776e04bd4afde0d4308177d26f377716fcf7e4bd70be590746d6aa594f08",
    byteLength: 1_364,
    extension: "js",
    allowedMimeTypes: JAVASCRIPT_MIME_TYPES,
    license: "Apache-2.0",
    licenseUrl: "https://github.com/developit/htm/blob/3.1.1/LICENSE",
  }),
  echarts: Object.freeze({
    id: "echarts",
    packageName: "echarts",
    version: "5.6.0",
    sources: npmSources("echarts", "5.6.0", "dist/echarts.min.js"),
    sha256: "bf4a223524e40b77c304bec67e1222cf551f14880cf42c69dc046558e11c07b1",
    byteLength: 1_034_102,
    extension: "js",
    allowedMimeTypes: JAVASCRIPT_MIME_TYPES,
    license: "Apache-2.0",
    licenseUrl: "https://github.com/apache/echarts/blob/5.6.0/LICENSE",
  }),
  phaser: Object.freeze({
    id: "phaser",
    packageName: "phaser",
    version: "3.90.0",
    sources: Object.freeze([
      source(
        "bootcdn",
        "mainland",
        "https://cdn.bootcdn.net/ajax/libs/phaser/3.90.0/phaser.min.js",
      ),
      source(
        "staticfile",
        "mainland",
        "https://cdn.staticfile.net/phaser/3.90.0/phaser.min.js",
      ),
      source(
        "jsdelivr",
        "global",
        "https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js",
      ),
      source(
        "unpkg",
        "global",
        "https://unpkg.com/phaser@3.90.0/dist/phaser.min.js",
      ),
    ]),
    sha256: "e92ddef111ba42e92d316979c732311757093688ea1810591cb7aa2858eba7a7",
    byteLength: 1_196_122,
    extension: "js",
    allowedMimeTypes: JAVASCRIPT_MIME_TYPES,
    license: "MIT",
    licenseUrl: "https://github.com/phaserjs/phaser/blob/v3.90.0/license.txt",
  }),
} satisfies Record<string, H5RuntimeAsset>);

const PROFILE_ASSETS: Readonly<
  Record<ProjectH5Profile, readonly H5RuntimeAsset[]>
> = Object.freeze({
  vanilla: Object.freeze([]),
  "preact-htm": Object.freeze([
    H5_RUNTIME_ASSETS.preact,
    H5_RUNTIME_ASSETS.preactHooks,
    H5_RUNTIME_ASSETS.htm,
  ]),
  phaser: Object.freeze([H5_RUNTIME_ASSETS.phaser]),
});

const ADDON_ASSETS: Readonly<
  Record<ProjectH5Addon, readonly H5RuntimeAsset[]>
> = Object.freeze({
  echarts: Object.freeze([H5_RUNTIME_ASSETS.echarts]),
});

export function h5RuntimeCacheFileName(asset: H5RuntimeAsset) {
  return `${asset.sha256}.${asset.extension}`;
}

export function h5RuntimeAssetsForManifest(manifest: ProjectH5Manifest) {
  const byHash = new Map<string, H5RuntimeAsset>();
  for (const asset of PROFILE_ASSETS[manifest.profile]) {
    byHash.set(asset.sha256, asset);
  }
  for (const addon of manifest.addons) {
    for (const asset of ADDON_ASSETS[addon]) {
      byHash.set(asset.sha256, asset);
    }
  }
  return Object.freeze([...byHash.values()]);
}

function runtimeUrl(basePath: string, asset: H5RuntimeAsset) {
  if (!/^\/(?:[a-f0-9]{32}\/)?runtime\/$/u.test(basePath)) {
    throw new Error("H5 运行时地址无效。");
  }
  return `${basePath}${h5RuntimeCacheFileName(asset)}`;
}

function scriptTag(basePath: string, asset: H5RuntimeAsset, defer = false) {
  return `<script data-boltpocket-runtime="${asset.id}"${defer ? " defer" : ""} src="${runtimeUrl(basePath, asset)}"></script>`;
}

export type H5RuntimeHtmlInjection = Readonly<{
  headStart: string;
  headEnd: string;
}>;

export function h5RuntimeHtmlInjection(
  manifest: ProjectH5Manifest,
  basePath: string,
): H5RuntimeHtmlInjection {
  const headStart: string[] = [];
  const headEnd: string[] = [];
  if (manifest.profile === "preact-htm") {
    headStart.push(scriptTag(basePath, H5_RUNTIME_ASSETS.preact));
    headStart.push(scriptTag(basePath, H5_RUNTIME_ASSETS.preactHooks));
    headStart.push(scriptTag(basePath, H5_RUNTIME_ASSETS.htm));
  } else if (manifest.profile === "phaser") {
    headStart.push(scriptTag(basePath, H5_RUNTIME_ASSETS.phaser));
  }
  if (manifest.addons.includes("echarts")) {
    headStart.push(scriptTag(basePath, H5_RUNTIME_ASSETS.echarts));
  }
  return Object.freeze({
    headStart: headStart.join(""),
    headEnd: headEnd.join(""),
  });
}
