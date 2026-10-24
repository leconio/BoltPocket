import { enAuthMessages } from "./locales/en/auth.ts";
import { enBrowserMessages } from "./locales/en/browser.ts";
import { enChatMessages } from "./locales/en/chat.ts";
import { enChangeMessages } from "./locales/en/changes.ts";
import { enCommonMessages } from "./locales/en/common.ts";
import { enConnectionMessages } from "./locales/en/connections.ts";
import { enHomeMessages } from "./locales/en/home.ts";
import { enLibraryMessages } from "./locales/en/library.ts";
import { enMarketMessages } from "./locales/en/market.ts";
import { enProjectMessages } from "./locales/en/projects.ts";
import { enPrivacyMessages } from "./locales/en/privacy.ts";
import { enRuntimeMessages } from "./locales/en/runtime.ts";
import { enSettingsMessages } from "./locales/en/settings.ts";
import { enSecurityMessages } from "./locales/en/security.ts";
import {
  generatedGlobalSkillMessagesByLocale,
  type GeneratedGlobalSkillMessageKey,
} from "../domain/global-skills.generated.ts";
import { zhCNAuthMessages, type AuthMessageKey } from "./locales/zh-CN/auth.ts";
import {
  zhCNBrowserMessages,
  type BrowserMessageKey,
} from "./locales/zh-CN/browser.ts";
import { zhCNChatMessages, type ChatMessageKey } from "./locales/zh-CN/chat.ts";
import {
  zhCNChangeMessages,
  type ChangeMessageKey,
} from "./locales/zh-CN/changes.ts";
import {
  zhCNCommonMessages,
  type CommonMessageKey,
} from "./locales/zh-CN/common.ts";
import {
  zhCNConnectionMessages,
  type ConnectionMessageKey,
} from "./locales/zh-CN/connections.ts";
import { zhCNHomeMessages, type HomeMessageKey } from "./locales/zh-CN/home.ts";
import {
  zhCNLibraryMessages,
  type LibraryMessageKey,
} from "./locales/zh-CN/library.ts";
import {
  zhCNMarketMessages,
  type MarketMessageKey,
} from "./locales/zh-CN/market.ts";
import {
  zhCNProjectMessages,
  type ProjectMessageKey,
} from "./locales/zh-CN/projects.ts";
import {
  zhCNPrivacyMessages,
  type PrivacyMessageKey,
} from "./locales/zh-CN/privacy.ts";
import {
  zhCNRuntimeMessages,
  type RuntimeMessageKey,
} from "./locales/zh-CN/runtime.ts";
import {
  zhCNSettingsMessages,
  type SettingsMessageKey,
} from "./locales/zh-CN/settings.ts";
import {
  zhCNSecurityMessages,
  type SecurityMessageKey,
} from "./locales/zh-CN/security.ts";
import type { AppLocale } from "./translate.ts";

export type MessageKey =
  | AuthMessageKey
  | BrowserMessageKey
  | ChatMessageKey
  | ChangeMessageKey
  | CommonMessageKey
  | ConnectionMessageKey
  | HomeMessageKey
  | LibraryMessageKey
  | MarketMessageKey
  | ProjectMessageKey
  | PrivacyMessageKey
  | RuntimeMessageKey
  | SecurityMessageKey
  | SettingsMessageKey
  | GeneratedGlobalSkillMessageKey;
export type MessageValues = Readonly<Record<string, string | number>>;
export type MessageReference = Readonly<{
  key: MessageKey;
  values?: MessageValues;
}>;

const catalogs: Readonly<Record<AppLocale, Record<MessageKey, string>>> = {
  en: {
    ...enAuthMessages,
    ...enBrowserMessages,
    ...enChatMessages,
    ...enChangeMessages,
    ...enCommonMessages,
    ...enConnectionMessages,
    ...enHomeMessages,
    ...enLibraryMessages,
    ...enMarketMessages,
    ...enProjectMessages,
    ...enPrivacyMessages,
    ...enRuntimeMessages,
    ...enSettingsMessages,
    ...enSecurityMessages,
    ...generatedGlobalSkillMessagesByLocale.en,
  },
  "zh-CN": {
    ...zhCNAuthMessages,
    ...zhCNBrowserMessages,
    ...zhCNChatMessages,
    ...zhCNChangeMessages,
    ...zhCNCommonMessages,
    ...zhCNConnectionMessages,
    ...zhCNHomeMessages,
    ...zhCNLibraryMessages,
    ...zhCNMarketMessages,
    ...zhCNProjectMessages,
    ...zhCNPrivacyMessages,
    ...zhCNRuntimeMessages,
    ...zhCNSettingsMessages,
    ...zhCNSecurityMessages,
    ...generatedGlobalSkillMessagesByLocale["zh-CN"],
  },
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

export function translateMessage(
  key: MessageKey,
  locale: AppLocale,
  values: MessageValues = {},
) {
  return catalogs[locale][key].replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function messagePlaceholders(template: string) {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

export const messageCatalogs = catalogs;

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && Object.hasOwn(catalogs.en, value);
}

export function resolveMessageReference(
  reference: MessageReference | undefined,
  fallback: string,
  translate: (key: MessageKey, values?: MessageValues) => string,
) {
  return reference ? translate(reference.key, reference.values) : fallback;
}
