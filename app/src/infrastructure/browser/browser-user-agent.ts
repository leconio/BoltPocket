export function createIosSafariUserAgent(platformVersion: string | number) {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?/u.exec(
    String(platformVersion),
  );
  const major = match?.[1] ?? "17";
  const osVersion = [major, match?.[2] ?? "0", match?.[3]]
    .filter((part): part is string => Boolean(part))
    .join("_");
  return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${major}.0 Mobile/15E148 Safari/604.1`;
}
