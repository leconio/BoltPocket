import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractBoundedZipArchive } from "@boltpocket/project-shell-extras/zip";
import { zipSync } from "fflate";
import { format } from "prettier";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const archivePath = join(appRoot, "assets", "h5-resources-v1.zip");
const generatedPath = join(
  appRoot,
  "src",
  "domain",
  "builtin-project-resources.generated.ts",
);

const SOURCE_LIMITS = Object.freeze({
  maxArchiveBytes: 4 * 1024 * 1024,
  maxEntries: 2_000,
  maxEntryBytes: 2 * 1024 * 1024,
  maxExtractedBytes: 8 * 1024 * 1024,
  maxPathBytes: 512,
});

const BUNDLE_LIMITS = Object.freeze({
  maxArchiveBytes: 4 * 1024 * 1024,
  maxEntries: 256,
  maxEntryBytes: 2 * 1024 * 1024,
  maxExtractedBytes: 8 * 1024 * 1024,
  maxPathBytes: 512,
});

type Source = Readonly<{
  url: string;
  sha256: string;
}>;

type ResourceFile = Readonly<{
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}>;

type Pack = Readonly<{
  id: "bootstrap-icons" | "kenney-ui" | "kenney-1bit";
  name: string;
  description: string;
  version: string;
  license: "MIT" | "CC0-1.0";
  homepage: string;
  files: readonly ResourceFile[];
  symbols?: readonly string[];
}>;

const KENNEY_UI_SOURCE: Source = Object.freeze({
  url: "https://kenney.nl/media/pages/assets/ui-pack/f651646eab-1718203990/kenney_ui-pack.zip",
  sha256: "a8a14a234911eb648c062622915c93e79e94e97cb7f9f375a70f6617f1174318",
});

const KENNEY_ONE_BIT_SOURCE: Source = Object.freeze({
  url: "https://kenney.nl/media/pages/assets/1-bit-pack/aa867a1f37-1677578516/kenney_1-bit-pack.zip",
  sha256: "129a0e74e1dc9091a769d5118be5c88780484c7a3771ee33ac9ef0df02583a9a",
});

const BOOTSTRAP_FILES = Object.freeze([
  {
    path: "bootstrap-icons.min.css",
    sha256: "a5d6387a32ca3baec4d02336b5b3edab50c9dd518355576a011ea3dd9c1d884e",
    mimeType: "text/css",
    urls: [
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css",
      "https://unpkg.com/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css",
    ],
  },
  {
    path: "fonts/bootstrap-icons.woff2",
    sha256: "6c75710364a1ca5604267716f6d28997b26319fdb078cf11e0b42ab66ff2ea61",
    mimeType: "font/woff2",
    urls: [
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/fonts/bootstrap-icons.woff2",
      "https://unpkg.com/bootstrap-icons@1.13.1/font/fonts/bootstrap-icons.woff2",
    ],
  },
  {
    path: "bootstrap-icons.json",
    sha256: "1c9de1e3aaaa1bba5967bac7eada79475082dd86b4a41955e58d3c2569b23cf0",
    mimeType: "application/json",
    urls: [
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.json",
      "https://unpkg.com/bootstrap-icons@1.13.1/font/bootstrap-icons.json",
    ],
  },
  {
    path: "LICENSE",
    sha256: "0fb3e11bd57e896c5a512afd64864d28a37de45d19835016c87ca1ad19ead969",
    mimeType: "text/plain",
    urls: [
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/LICENSE",
      "https://unpkg.com/bootstrap-icons@1.13.1/LICENSE",
    ],
  },
] as const);

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchVerified(sources: readonly Source[]) {
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: { "Accept-Encoding": "identity" },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (digest(bytes) !== source.sha256) {
        throw new Error("SHA-256 mismatch");
      }
      return bytes;
    } catch (error) {
      failures.push(
        `${source.url}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }
  throw new Error(
    `Unable to acquire a verified resource:\n${failures.join("\n")}`,
  );
}

function pngDimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error("Invalid PNG resource");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function mimeType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".tmx") || lower.endsWith(".tsx")) {
    return "application/xml";
  }
  return "text/plain";
}

function resourceFile(path: string, bytes: Uint8Array): ResourceFile {
  const type = mimeType(path);
  return Object.freeze({
    path,
    bytes,
    mimeType: type,
    ...(type === "image/png" ? pngDimensions(bytes) : {}),
  });
}

function archiveEntries(source: Uint8Array) {
  return new Map(
    extractBoundedZipArchive(source, SOURCE_LIMITS).map((entry) => [
      entry.name,
      entry.data,
    ]),
  );
}

function requiredEntry(entries: ReadonlyMap<string, Uint8Array>, path: string) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Required source resource is missing: ${path}`);
  return bytes;
}

async function bootstrapIconsPack(): Promise<Pack> {
  const files: ResourceFile[] = [];
  for (const file of BOOTSTRAP_FILES) {
    const bytes = await fetchVerified(
      file.urls.map((url) => ({ url, sha256: file.sha256 })),
    );
    files.push(
      Object.freeze({ path: file.path, bytes, mimeType: file.mimeType }),
    );
  }
  const index = files.find((file) => file.path === "bootstrap-icons.json")!;
  const parsed: unknown = JSON.parse(new TextDecoder().decode(index.bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bootstrap Icons index is invalid");
  }
  const symbols = Object.keys(parsed).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  assert.equal(symbols.length, 2_078);
  return Object.freeze({
    id: "bootstrap-icons",
    name: "Bootstrap Icons",
    description: "网页字体图标",
    version: "1.13.1",
    license: "MIT",
    homepage: "https://icons.getbootstrap.com/",
    files,
    symbols,
  });
}

async function kenneyUiPack(): Promise<Pack> {
  const source = await fetchVerified([KENNEY_UI_SOURCE]);
  const entries = archiveEntries(source);
  const mapped: [string, string][] = [];
  for (const path of entries.keys()) {
    const blue = /^PNG\/Blue\/Default\/(.+\.png)$/u.exec(path);
    const extra = /^PNG\/Extra\/Default\/(.+\.png)$/u.exec(path);
    if (blue) mapped.push([path, `png/blue/${blue[1]}`]);
    if (extra) mapped.push([path, `png/extra/${extra[1]}`]);
  }
  mapped.push(
    ["Font/Kenney Future.ttf", "fonts/kenney-future.ttf"],
    ["Font/Kenney Future Narrow.ttf", "fonts/kenney-future-narrow.ttf"],
    ["License.txt", "LICENSE.txt"],
  );
  const files = mapped
    .map(([sourcePath, targetPath]) =>
      resourceFile(targetPath, requiredEntry(entries, sourcePath)),
    )
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  assert.equal(files.length, 109);
  return Object.freeze({
    id: "kenney-ui",
    name: "Kenney UI Pack",
    description: "游戏界面精灵与字体",
    version: "2.0",
    license: "CC0-1.0",
    homepage: "https://kenney.nl/assets/ui-pack",
    files,
  });
}

async function kenneyOneBitPack(): Promise<Pack> {
  const source = await fetchVerified([KENNEY_ONE_BIT_SOURCE]);
  const entries = archiveEntries(source);
  const mapped: [string, string][] = [];
  for (const path of entries.keys()) {
    const tilesheet = /^Tilesheet\/(.+\.png)$/u.exec(path);
    const tilemap = /^Tilemap\/(.+\.(?:png|tmx|tsx))$/u.exec(path);
    if (tilesheet) mapped.push([path, `tilesheets/${tilesheet[1]}`]);
    if (tilemap) mapped.push([path, `tilemaps/${tilemap[1]}`]);
  }
  mapped.push(
    ["Tilesheet.txt", "TILESHEET.txt"],
    ["License.txt", "LICENSE.txt"],
  );
  const files = mapped
    .map(([sourcePath, targetPath]) =>
      resourceFile(targetPath, requiredEntry(entries, sourcePath)),
    )
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  assert.equal(files.length, 16);
  return Object.freeze({
    id: "kenney-1bit",
    name: "Kenney 1-Bit Pack",
    description: "16px 游戏精灵表与示例地图",
    version: "1.2",
    license: "CC0-1.0",
    homepage: "https://kenney.nl/assets/1-bit-pack",
    files,
  });
}

function serializableFile(file: ResourceFile) {
  return {
    path: file.path,
    byteLength: file.bytes.byteLength,
    sha256: digest(file.bytes),
    mimeType: file.mimeType,
    ...(file.width ? { width: file.width } : {}),
    ...(file.height ? { height: file.height } : {}),
  };
}

function packCatalog(pack: Pack) {
  return {
    schema: 1,
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    license: pack.license,
    homepage: pack.homepage,
    files: pack.files.map(serializableFile),
    ...(pack.symbols ? { symbols: pack.symbols } : {}),
  };
}

async function createBundle() {
  const packs = await Promise.all([
    bootstrapIconsPack(),
    kenneyUiPack(),
    kenneyOneBitPack(),
  ]);
  const archiveFiles: Record<string, Uint8Array> = {};
  const generatedPacks = packs.map((pack) => {
    const catalogBytes = new TextEncoder().encode(
      `${JSON.stringify(packCatalog(pack), null, 2)}\n`,
    );
    const files = [
      ...pack.files.map(serializableFile),
      serializableFile(resourceFile("catalog.json", catalogBytes)),
    ].sort((left, right) => left.path.localeCompare(right.path, "en"));
    for (const file of pack.files) {
      archiveFiles[`${pack.id}/${file.path}`] = file.bytes;
    }
    archiveFiles[`${pack.id}/catalog.json`] = catalogBytes;
    return {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      version: pack.version,
      license: pack.license,
      homepage: pack.homepage,
      files,
      ...(pack.symbols ? { symbols: pack.symbols } : {}),
    };
  });
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(archiveFiles)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([path, bytes]) => [
          path,
          [bytes, { level: 9, mtime: new Date(2020, 0, 1) }],
        ]),
    ),
  );
  assert.ok(archive.byteLength <= BUNDLE_LIMITS.maxArchiveBytes);
  const extracted = extractBoundedZipArchive(archive, BUNDLE_LIMITS);
  assert.equal(extracted.length, Object.keys(archiveFiles).length);
  for (const entry of extracted) {
    assert.equal(digest(entry.data), digest(archiveFiles[entry.name]!));
  }
  return { archive, generatedPacks };
}

async function generatedSource(
  archive: Uint8Array,
  packs: Awaited<ReturnType<typeof createBundle>>["generatedPacks"],
) {
  return format(
    [
      "// Generated by app/scripts/build-h5-resource-bundle.ts. Do not edit by hand.",
      `export const H5_RESOURCE_BUNDLE = ${JSON.stringify(
        {
          schema: 1,
          assetFileName: "h5-resources-v1.zip",
          byteLength: archive.byteLength,
          sha256: digest(archive),
          limits: BUNDLE_LIMITS,
        },
        null,
        2,
      )} as const;`,
      `export const BUILT_IN_H5_RESOURCE_PACKS = ${JSON.stringify(
        packs,
        null,
        2,
      )} as const;`,
      "",
    ].join("\n"),
    { parser: "typescript" },
  );
}

async function main() {
  if (process.argv.includes("--check")) {
    const { BUILT_IN_H5_RESOURCE_PACKS, H5_RESOURCE_BUNDLE } =
      await import("../src/domain/builtin-project-resources.generated.ts");
    const archive = new Uint8Array(readFileSync(archivePath));
    assert.equal(archive.byteLength, H5_RESOURCE_BUNDLE.byteLength);
    assert.equal(digest(archive), H5_RESOURCE_BUNDLE.sha256);
    const entries = extractBoundedZipArchive(
      archive,
      H5_RESOURCE_BUNDLE.limits,
    );
    const expected = new Map<string, { byteLength: number; sha256: string }>();
    for (const pack of BUILT_IN_H5_RESOURCE_PACKS) {
      for (const file of pack.files) {
        expected.set(`${pack.id}/${file.path}`, file);
      }
    }
    assert.equal(entries.length, expected.size);
    for (const entry of entries) {
      const file = expected.get(entry.name);
      assert.ok(file, entry.name);
      assert.equal(entry.data.byteLength, file.byteLength, entry.name);
      assert.equal(digest(entry.data), file.sha256, entry.name);
      expected.delete(entry.name);
    }
    assert.equal(expected.size, 0);
    console.log(
      JSON.stringify({
        type: "h5-resource-offline-bundle",
        passed: true,
        packCount: BUILT_IN_H5_RESOURCE_PACKS.length,
        fileCount: entries.length,
      }),
    );
    return;
  }
  const { archive, generatedPacks } = await createBundle();
  const source = await generatedSource(archive, generatedPacks);
  mkdirSync(dirname(archivePath), { recursive: true });
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(archivePath, archive);
  writeFileSync(generatedPath, source);
  console.log(
    JSON.stringify({
      type: "h5-resource-offline-bundle",
      written: true,
      byteLength: archive.byteLength,
      sha256: digest(archive),
      packCount: generatedPacks.length,
      fileCount: generatedPacks.reduce(
        (total, pack) => total + pack.files.length,
        0,
      ),
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
