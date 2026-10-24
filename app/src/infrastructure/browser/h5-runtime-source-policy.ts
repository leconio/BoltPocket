import type {
  H5RuntimeAsset,
  H5RuntimeSource,
  H5RuntimeSourceId,
} from "./h5-runtime-registry";

// Maintainer-only bundle generation policy. The installed mobile runtime never
// imports this module or downloads executable framework code.
export function orderedH5RuntimeSources(
  asset: H5RuntimeAsset,
  preferredSourceId?: H5RuntimeSourceId,
) {
  const preferred = asset.sources.find(
    (source) => source.id === preferredSourceId,
  );
  if (!preferred) return asset.sources;
  return Object.freeze([
    preferred,
    ...asset.sources.filter((source) => source !== preferred),
  ]);
}

export async function resolveH5RuntimeSource<T>(
  asset: H5RuntimeAsset,
  preferredSourceId: H5RuntimeSourceId | undefined,
  attempt: (source: H5RuntimeSource) => Promise<T>,
): Promise<Readonly<{ source: H5RuntimeSource; value: T }>> {
  for (const source of orderedH5RuntimeSources(asset, preferredSourceId)) {
    try {
      return Object.freeze({ source, value: await attempt(source) });
    } catch {
      // A failed request, MIME rejection, or integrity mismatch is scoped to
      // this fixed source. The next app-shipped source still has to pass the
      // exact same byte-length and SHA-256 checks in the caller.
    }
  }
  throw new Error("H5 离线包构建源均不可用。");
}
