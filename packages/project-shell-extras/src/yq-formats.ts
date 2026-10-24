/* SPDX-License-Identifier: Apache-2.0 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import * as ini from "ini";
import Papa from "papaparse";
import * as TOML from "smol-toml";
import YAML from "yaml";

import { byteLength } from "./bytes.ts";
import { assertByteLimit } from "./limits.ts";
import { sanitizeStructuredData } from "./safe-data.ts";
import type { ProjectShellExtraLimits } from "./types.ts";

export type StructuredFormat = "yaml" | "json" | "xml" | "ini" | "csv" | "toml";

export type YqFormatOptions = {
  inputFormat: StructuredFormat;
  outputFormat: StructuredFormat;
  raw: boolean;
  compact: boolean;
  pretty: boolean;
  indent: number;
  xmlAttributePrefix: string;
  xmlContentName: string;
  csvDelimiter: string;
  csvHeader: boolean;
};

const formats = new Set<StructuredFormat>([
  "yaml",
  "json",
  "xml",
  "ini",
  "csv",
  "toml",
]);

export function isStructuredFormat(
  value: string | undefined,
): value is StructuredFormat {
  return value !== undefined && formats.has(value as StructuredFormat);
}

export function detectStructuredFormat(path: string): StructuredFormat | null {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "yml" || extension === "yaml") return "yaml";
  if (extension === "json") return "json";
  if (extension === "xml") return "xml";
  if (extension === "ini") return "ini";
  if (extension === "csv" || extension === "tsv") return "csv";
  if (extension === "toml") return "toml";
  return null;
}

export function parseStructuredInput(
  input: string,
  options: YqFormatOptions,
  limits: ProjectShellExtraLimits,
): unknown {
  assertByteLimit("yq input", byteLength(input), limits.maxInputBytes);
  const trimmed = input.trim();
  if (!trimmed) return null;
  let value: unknown;
  switch (options.inputFormat) {
    case "yaml":
      value = YAML.parse(trimmed, { maxAliasCount: 100, schema: "core" });
      break;
    case "json":
      value = JSON.parse(trimmed);
      break;
    case "xml":
      rejectDoctype(trimmed);
      value = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlContentName,
        parseAttributeValue: false,
        parseTagValue: false,
        trimValues: true,
        processEntities: false,
      }).parse(trimmed);
      break;
    case "ini":
      rejectPrototypeKeysInIni(trimmed);
      value = ini.parse(trimmed);
      break;
    case "csv": {
      const result = Papa.parse(trimmed, {
        delimiter: options.csvDelimiter || undefined,
        header: options.csvHeader,
        dynamicTyping: true,
        skipEmptyLines: true,
      });
      const fatal = result.errors.find(
        (error) => error.code !== "UndetectableDelimiter",
      );
      if (fatal) throw new Error(fatal.message || "invalid CSV");
      value = result.data;
      break;
    }
    case "toml":
      value = TOML.parse(trimmed);
      break;
  }
  return sanitizeStructuredData(value, limits);
}

export function parseYamlDocuments(
  input: string,
  limits: ProjectShellExtraLimits,
): unknown[] {
  assertByteLimit("yq input", byteLength(input), limits.maxInputBytes);
  const documents = YAML.parseAllDocuments(input, { schema: "core" });
  if (documents.length > limits.maxStructuredNodes)
    throw new Error("too many YAML documents");
  return documents.map((document) => {
    if (document.errors.length) throw document.errors[0];
    return sanitizeStructuredData(
      document.toJS({ maxAliasCount: 100 }),
      limits,
    );
  });
}

export function extractFrontMatter(
  input: string,
  limits: ProjectShellExtraLimits,
): unknown | null {
  const trimmed = input.trimStart();
  for (const marker of ["---", "+++", "{{{"] as const) {
    if (!trimmed.startsWith(marker)) continue;
    const closing = marker === "{{{" ? "}}}" : marker;
    const end = trimmed.indexOf(`\n${closing}`, marker.length);
    if (end < 0) return null;
    const body = trimmed.slice(marker.length, end);
    const value =
      marker === "---"
        ? YAML.parse(body, { maxAliasCount: 100, schema: "core" })
        : marker === "+++"
          ? TOML.parse(body)
          : JSON.parse(body);
    return sanitizeStructuredData(value, limits);
  }
  return null;
}

export function formatStructuredOutput(
  value: unknown,
  options: YqFormatOptions,
  limits: ProjectShellExtraLimits,
): string {
  const safe = sanitizeStructuredData(value, limits);
  assertSerializationCanFit(safe, options, limits.maxOutputBytes);
  let result: string;
  switch (options.outputFormat) {
    case "json":
      if (options.raw && typeof safe === "string") result = safe;
      else
        result = JSON.stringify(
          safe,
          null,
          options.compact ? 0 : options.indent,
        );
      break;
    case "yaml":
      result = YAML.stringify(safe, { indent: options.indent }).trimEnd();
      break;
    case "xml":
      result = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlContentName,
        format: options.pretty || !options.compact,
        indentBy: " ".repeat(options.indent),
      }).build(safe);
      break;
    case "ini":
      result = isRecord(safe) ? ini.stringify(safe) : "";
      break;
    case "csv":
      result = Papa.unparse(Array.isArray(safe) ? safe : [safe], {
        delimiter: options.csvDelimiter || ",",
      });
      break;
    case "toml":
      result = isRecord(safe) ? TOML.stringify(safe) : "";
      break;
  }
  assertByteLimit("yq output", byteLength(result), limits.maxOutputBytes);
  return result;
}

function assertSerializationCanFit(
  value: unknown,
  options: YqFormatOptions,
  maximum: number,
): void {
  const json = JSON.stringify(value);
  const base = byteLength(json);
  const factor =
    options.outputFormat === "yaml" ||
    options.outputFormat === "toml" ||
    options.outputFormat === "xml"
      ? 8
      : 4;
  if (base > Math.floor(maximum / factor)) {
    throw new Error(
      `yq output: conservative expansion limit exceeded (${maximum})`,
    );
  }
}

function rejectDoctype(input: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(input))
    throw new Error("XML declarations with entities are unsupported");
}

function rejectPrototypeKeysInIni(input: string): void {
  for (const line of input.split(/\r?\n/)) {
    const candidate = line
      .trim()
      .replace(/^\[|\]$/g, "")
      .split(/[.=]/)[0]
      ?.trim();
    if (
      candidate === "__proto__" ||
      candidate === "constructor" ||
      candidate === "prototype"
    ) {
      throw new Error(`unsafe INI key '${candidate}'`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
