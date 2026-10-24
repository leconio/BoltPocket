import { parseNotionPageId } from "@boltpocket/connector-notion";
import { parseGoogleSpreadsheetLink } from "@boltpocket/connector-google-sheets";
import { parseGooglePresentationId } from "@boltpocket/connector-google-slides";

import { parseGoogleDocumentId } from "./google-docs-document";

export type SupportedDocumentLink = {
  provider: "google-docs" | "google-sheets" | "google-slides" | "notion";
  url: string;
};

const URL = /https:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[),.;!?，。；！？）】》」』]+$/u;

export function findSupportedDocumentLinks(
  text: string,
  maximum = 4,
): SupportedDocumentLink[] {
  const found: SupportedDocumentLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    let provider: SupportedDocumentLink["provider"] | null = null;
    const parsers: readonly [
      SupportedDocumentLink["provider"],
      (value: string) => unknown,
    ][] = [
      ["google-docs", parseGoogleDocumentId],
      ["google-sheets", parseGoogleSpreadsheetLink],
      ["google-slides", parseGooglePresentationId],
      ["notion", parseNotionPageId],
    ];
    for (const [candidate, parse] of parsers) {
      try {
        parse(url);
        provider = candidate;
        break;
      } catch {
        // Try the next provider parser.
      }
    }
    if (!provider) continue;
    const key = `${provider}\0${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ provider, url });
    if (found.length >= maximum) break;
  }
  return found;
}
