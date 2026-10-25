/** Keep legacy performance links working without replacing the product home. */
export function redirectLocalBenchmarkSystemPath(path: string): string {
  let url: URL;
  try {
    url = new URL(path, "boltpocket:///");
  } catch {
    return path;
  }
  if (url.protocol !== "boltpocket:") return path;
  const route = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/gu, "");
  if (route !== "" && route !== "local-benchmark") return path;

  const modes = ["demo", "bench", "probe"].filter((key) =>
    url.searchParams.has(key),
  );
  if (modes.length !== 1) return path;
  const mode = modes[0]!;
  const values = url.searchParams.getAll(mode);
  if (values.length !== 1) return path;
  const value = values[0]!;
  if (mode === "probe") {
    if (
      value !== "short" &&
      value !== "decode" &&
      !(/^long-(?:0|[1-9]\d*)$/u.test(value) && Number(value.slice(5)) <= 2048)
    ) {
      return path;
    }
  } else if (value !== "1") return path;

  const query = new URLSearchParams({ [mode]: value });
  if (url.searchParams.get("cache") === "off") query.set("cache", "off");
  return `/local-benchmark?${query.toString()}`;
}
