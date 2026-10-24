export function getProviderEnvValue(
  name: string,
  env?: Record<string, string>,
) {
  return (
    env?.[name] ??
    (typeof process === "undefined" ? undefined : process.env[name])
  );
}
