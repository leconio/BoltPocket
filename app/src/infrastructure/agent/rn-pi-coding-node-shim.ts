function unavailable(operation: string): never {
  const error = Object.assign(
    new Error(`Node host operation '${operation}' is unavailable on mobile.`),
    { code: "ENOENT" },
  );
  throw error;
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2 } as const;

export async function access(): Promise<never> {
  return unavailable("access");
}

export function accessSync(): never {
  return unavailable("accessSync");
}

export async function readFile(): Promise<never> {
  return unavailable("readFile");
}

export async function writeFile(): Promise<never> {
  return unavailable("writeFile");
}

export async function mkdir(): Promise<never> {
  return unavailable("mkdir");
}

export async function stat(): Promise<never> {
  return unavailable("stat");
}

export async function readdir(): Promise<never> {
  return unavailable("readdir");
}

export async function realpath(): Promise<never> {
  return unavailable("realpath");
}

export function realpathSync(path: string): string {
  return path;
}

export function existsSync(): false {
  return false;
}

export function createWriteStream(): never {
  return unavailable("createWriteStream");
}

export function spawn(): never {
  return unavailable("spawn");
}

export function spawnSync(): never {
  return unavailable("spawnSync");
}

export function createInterface(): never {
  return unavailable("createInterface");
}

export function randomBytes(): never {
  return unavailable("randomBytes");
}

export function homedir(): string {
  return "/";
}

export function tmpdir(): string {
  return "/tmp";
}

export function platform(): string {
  return "android";
}

export function arch(): string {
  return "arm64";
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${path.startsWith("/") ? "" : "/"}${path}`);
}

export function fileURLToPath(value: string | URL): string {
  const url = typeof value === "string" ? new URL(value) : value;
  if (url.protocol !== "file:") unavailable("fileURLToPath");
  return decodeURIComponent(url.pathname);
}
