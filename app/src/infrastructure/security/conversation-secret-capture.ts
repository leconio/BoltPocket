import type {
  CredentialKind,
  CredentialSecret,
} from "@/application/ports/credential-vault";
import { translateMessage } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/translate";

export type ConversationSecretCapture = {
  label: string;
  kind: CredentialKind;
  secret: CredentialSecret;
};

export type ConversationSecretCaptureResult = {
  redactedContent: string;
  captures: ConversationSecretCapture[];
};

type Match = {
  start: number;
  end: number;
  value: string;
  role: "secret" | "ssh-passphrase";
  capture: ConversationSecretCapture | null;
};

const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/gu;
const LABELED_SECRET_PATTERN =
  /(?:私钥口令|key[ _-]?passphrase|passphrase|密码|口令|password|passwd|api[ _-]?key|access[ _-]?token|token|secret|密钥)\s*(?:是|为|[:：=＝])\s*(?:"([^"\n]{4,})"|'([^'\n]{4,})'|([^\s,，;；]{4,}))/giu;
const BEARER_PATTERN = /\bBearer\s+([A-Za-z0-9._~+\/-]{12,}=*)/gu;
const KNOWN_TOKEN_PATTERN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b/gu;

function overlaps(matches: readonly Match[], start: number, end: number) {
  return matches.some((match) => start < match.end && end > match.start);
}

function classification(hint: string, value: string, locale: AppLocale) {
  const normalized = hint.toLowerCase();
  if (/私钥口令|key[ _-]?passphrase|passphrase/u.test(normalized)) {
    return {
      label: translateMessage(
        "runtime.security.capture.label.privateKeyPassphrase",
        locale,
      ),
      kind: "password" as const,
      role: "ssh-passphrase" as const,
    };
  }
  if (
    /api|token|bearer|gh[pousr]_|github_pat_|sk-/u.test(
      `${normalized} ${value}`,
    )
  ) {
    return {
      label: translateMessage(
        "runtime.security.capture.label.apiToken",
        locale,
      ),
      kind: "api-token" as const,
      role: "secret" as const,
    };
  }
  if (/私钥|private key/u.test(normalized)) {
    return {
      label: translateMessage(
        "runtime.security.capture.label.privateKey",
        locale,
      ),
      kind: "ssh" as const,
      role: "secret" as const,
    };
  }
  if (/密码|口令|password|passwd/u.test(normalized)) {
    return {
      label: translateMessage(
        "runtime.security.capture.label.password",
        locale,
      ),
      kind: "password" as const,
      role: "secret" as const,
    };
  }
  return {
    label: translateMessage("runtime.security.capture.label.secret", locale),
    kind: "secret-text" as const,
    role: "secret" as const,
  };
}

function secretFor(kind: CredentialKind, value: string): CredentialSecret {
  if (kind === "password") return { kind, password: value };
  if (kind === "ssh") {
    return {
      kind,
      authentication: "private-key",
      privateKey: value,
    };
  }
  if (kind === "api-token") return { kind, token: value };
  return { kind, value };
}

function primaryValue(secret: CredentialSecret) {
  if (secret.kind === "password") return secret.password;
  if (secret.kind === "ssh") {
    return secret.authentication === "password"
      ? secret.password
      : secret.privateKey;
  }
  if (secret.kind === "api-token") return secret.token;
  return secret.value;
}

function addMatch(
  matches: Match[],
  input: string,
  start: number,
  value: string,
  hint: string,
  locale: AppLocale,
) {
  const end = start + value.length;
  const normalizedHint = hint.toLowerCase();
  if (
    value.length < 4 ||
    value.length > 64 * 1024 ||
    (/api[ _-]?key|token|bearer/u.test(normalizedHint) && value.length < 12) ||
    overlaps(matches, start, end)
  ) {
    return;
  }
  const classified = classification(hint, value, locale);
  matches.push({
    start,
    end,
    value: input.slice(start, end),
    role: classified.role,
    capture: {
      label: classified.label,
      kind: classified.kind,
      secret: secretFor(classified.kind, input.slice(start, end)),
    },
  });
}

function mergeSinglePrivateKeyPassphrase(matches: Match[]) {
  const privateKeys = matches.filter(
    (match) =>
      match.capture?.secret.kind === "ssh" &&
      match.capture.secret.authentication === "private-key",
  );
  const passphrases = matches.filter(
    (match) => match.role === "ssh-passphrase" && match.capture,
  );
  if (privateKeys.length !== 1 || passphrases.length !== 1) return;
  const privateKey = privateKeys[0]?.capture;
  const passphraseMatch = passphrases[0];
  if (
    !privateKey ||
    privateKey.secret.kind !== "ssh" ||
    privateKey.secret.authentication !== "private-key" ||
    !passphraseMatch
  ) {
    return;
  }
  privateKey.secret = {
    ...privateKey.secret,
    passphrase: passphraseMatch.value,
  };
  passphraseMatch.capture = null;
}

export function captureConversationSecrets(
  input: string,
  locale: AppLocale = "zh-CN",
): ConversationSecretCaptureResult {
  const matches: Match[] = [];

  for (const match of input.matchAll(PRIVATE_KEY_PATTERN)) {
    if (match.index === undefined) continue;
    addMatch(matches, input, match.index, match[0], "private key", locale);
  }
  for (const match of input.matchAll(LABELED_SECRET_PATTERN)) {
    if (match.index === undefined) continue;
    const value = match[1] ?? match[2] ?? match[3];
    if (!value) continue;
    const offset = match[0].lastIndexOf(value);
    addMatch(matches, input, match.index + offset, value, match[0], locale);
  }
  for (const match of input.matchAll(BEARER_PATTERN)) {
    if (match.index === undefined || !match[1]) continue;
    addMatch(
      matches,
      input,
      match.index + match[0].lastIndexOf(match[1]),
      match[1],
      "bearer token",
      locale,
    );
  }
  for (const match of input.matchAll(KNOWN_TOKEN_PATTERN)) {
    if (match.index === undefined) continue;
    addMatch(matches, input, match.index, match[0], match[0], locale);
  }

  mergeSinglePrivateKeyPassphrase(matches);
  const unique = new Map<string, ConversationSecretCapture>();
  for (const match of matches) {
    if (!match.capture) continue;
    const key = primaryValue(match.capture.secret);
    if (!unique.has(key)) unique.set(key, match.capture);
  }

  let redactedContent = input;
  for (const match of [...matches].sort(
    (left, right) => right.value.length - left.value.length,
  )) {
    const label =
      match.capture?.label ??
      translateMessage(
        "runtime.security.capture.label.privateKeyPassphrase",
        locale,
      );
    redactedContent = redactedContent
      .split(match.value)
      .join(
        translateMessage("runtime.security.capture.saved", locale, { label }),
      );
  }
  return { redactedContent, captures: [...unique.values()] };
}
