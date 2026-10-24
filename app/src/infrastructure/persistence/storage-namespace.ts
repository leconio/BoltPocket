const STORAGE_NAMESPACE = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function namespacedStorageKey(key: string, namespace?: string): string {
  if (!namespace) return key;
  if (!STORAGE_NAMESPACE.test(namespace)) {
    throw new Error("Invalid storage namespace.");
  }
  return `${key}.${namespace}`;
}
