import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  isLocalePreference,
  localizedErrorMessage,
  resolveLocalePreference,
  resolveSupportedLocale,
} from "./translate.ts";

const HAN = /[\u3400-\u9fff]/u;

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (!/\.tsx?$/u.test(entry.name) || entry.name.includes(".test.")) {
      return [];
    }
    return [target];
  });
}

function sourceLanguageLiterals(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const literals: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node)) &&
      HAN.test(node.text)
    ) {
      literals.push(node.text.replace(/\s+/gu, " ").trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals.filter(Boolean);
}

test("supported locale and stored preference validation are deterministic", () => {
  assert.equal(resolveSupportedLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(resolveSupportedLocale("en-GB"), "en");
  assert.equal(resolveSupportedLocale("fr-FR"), "en");
  assert.equal(resolveLocalePreference("system", "zh-HK"), "zh-CN");
  assert.equal(resolveLocalePreference("en", "zh-CN"), "en");
  assert.equal(isLocalePreference("system"), true);
  assert.equal(isLocalePreference("fr"), false);
});

test("page and shared presentation copy is expressed through explicit keys", () => {
  const roots = ["src/app", "src/components", "src/features", "src/providers"];
  const offenders = roots.flatMap((root) =>
    sourceFiles(path.resolve(root)).flatMap((file) =>
      sourceLanguageLiterals(file).map((literal) => `${file}: ${literal}`),
    ),
  );
  assert.deepEqual(offenders, []);
});

test("native primitives and locale helpers contain no automatic translation", () => {
  const localeSource = readFileSync(
    path.resolve("src/i18n/translate.ts"),
    "utf8",
  );
  const presentationSource = [
    "src/app",
    "src/components",
    "src/features",
    "src/providers",
  ]
    .flatMap((root) => sourceFiles(path.resolve(root)))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  assert.equal(existsSync(path.resolve("src/i18n/react-native.tsx")), false);
  assert.doesNotMatch(presentationSource, /@\/i18n\/react-native/u);
  assert.doesNotMatch(
    localeSource,
    /translateText|ENGLISH_COPY|templateRules/u,
  );
  assert.doesNotMatch(
    presentationSource,
    /GOOGLE DRIVE|Chat Completions|Responses API|>\s*Spawn\s*</u,
  );
});

test("the native project and localized display names use the current brand", () => {
  const config = readFileSync(path.resolve("app.json"), "utf8");
  const english = readFileSync(path.resolve("locales/en.json"), "utf8");
  const chinese = readFileSync(path.resolve("locales/zh-CN.json"), "utf8");
  const appConfig = JSON.parse(config) as {
    expo?: { name?: string };
  };
  const englishLocale = JSON.parse(english) as {
    ios?: { CFBundleDisplayName?: string };
    android?: { app_name?: string };
  };
  const chineseLocale = JSON.parse(chinese) as {
    ios?: { CFBundleDisplayName?: string };
    android?: { app_name?: string };
  };

  assert.doesNotMatch(config, HAN);
  assert.doesNotMatch(english, HAN);
  assert.match(chinese, HAN);
  assert.equal(appConfig.expo?.name, "BoltPocket");
  assert.equal(englishLocale.ios?.CFBundleDisplayName, "BoltPocket");
  assert.equal(englishLocale.android?.app_name, "BoltPocket");
  assert.equal(chineseLocale.ios?.CFBundleDisplayName, "BoltPocket");
  assert.equal(chineseLocale.android?.app_name, "BoltPocket");
});

test("implementation errors use the page fallback without guessing a translation", () => {
  assert.equal(
    localizedErrorMessage(
      new Error("内部实现错误。"),
      "Try again later.",
      "en",
    ),
    "Try again later.",
  );
  assert.equal(
    localizedErrorMessage(
      new Error("Upstream unavailable"),
      "Try again later.",
      "en",
    ),
    "Upstream unavailable",
  );
  assert.equal(
    localizedErrorMessage(new Error("内部实现错误。"), "请稍后重试。", "zh-CN"),
    "请稍后重试。",
  );
});
