import assert from "node:assert/strict";
import test from "node:test";

import { loadComplianceConfig } from "@/config/compliance";

import { complianceDocument } from "./compliance-documents.ts";

test("privacy text is generated from the same operator and model release config", () => {
  const config = loadComplianceConfig({
    distributionRegion: "china-mainland",
    operatorName: "测试运营主体（仅单元测试）",
    operatorAddress: "测试地址",
    supportEmail: "privacy@test.invalid",
    privacyPolicyUrl: "https://legal.test.invalid/privacy",
    termsUrl: "https://legal.test.invalid/terms",
    appFilingNumber: "test-filing",
    registeredAiServices: [
      {
        providerId: "test-provider",
        providerName: "测试模型服务",
        baseUrl: "https://ai.test.invalid/v1",
        modelId: "test-model",
        modelName: "测试模型",
        recipientName: "测试接收方",
        recipientLocation: "中国大陆",
        filingNumber: "test-ai-filing",
      },
    ],
  });

  const privacy = complianceDocument("privacy", config).markdown;
  assert.match(privacy, /测试运营主体/u);
  assert.match(privacy, /测试接收方/u);
  assert.match(privacy, /test-ai-filing/u);
  assert.match(privacy, /撤回全部 AI 数据授权/u);
  assert.doesNotMatch(privacy, /【待填写/u);
});

test("global legal documents contain no mainland release placeholders", () => {
  const config = loadComplianceConfig({
    distributionRegion: "global",
    operatorName: "Verified Operator",
    operatorAddress: "Shenzhen, China",
    supportEmail: "support@boltpocket.example",
    privacyPolicyUrl: "https://boltpocket.example/legal/privacy",
    termsUrl: "https://boltpocket.example/legal/terms",
    firstPartyApiUrl: "https://boltpocket.example",
  });
  for (const id of [
    "privacy",
    "terms",
    "ai-rules",
    "third-parties",
    "personal-information",
    "permissions",
  ] as const) {
    for (const locale of ["en", "zh-CN"] as const) {
      assert.doesNotMatch(
        complianceDocument(id, config, locale).markdown,
        /To be completed|待填写/iu,
      );
    }
  }
  assert.doesNotMatch(
    complianceDocument("privacy", config, "en").markdown,
    /before the main application mounts/iu,
  );
  assert.doesNotMatch(
    complianceDocument("privacy", config, "zh-CN").markdown,
    /进入主界面前提供/u,
  );
});

test("the incomplete mainland profile stays visibly blocked as a draft", () => {
  const privacy = complianceDocument(
    "privacy",
    loadComplianceConfig({ distributionRegion: "china-mainland" }),
  ).markdown;
  assert.match(privacy, /【待填写：服务商、模型名称/u);
  assert.match(privacy, /不得作为中国大陆正式发布版本/u);
});

test("legal documents provide a complete English variant", () => {
  const config = loadComplianceConfig({
    operatorName: "Example Operator",
    operatorAddress: "Example Address",
    supportEmail: "privacy@test.invalid",
  });
  const privacy = complianceDocument("privacy", config, "en");
  const terms = complianceDocument("terms", config, "en");
  const aiRules = complianceDocument("ai-rules", config, "en");
  const thirdParties = complianceDocument("third-parties", config, "en");
  const personalInformation = complianceDocument(
    "personal-information",
    config,
    "en",
  );
  const permissions = complianceDocument("permissions", config, "en");
  assert.equal(privacy.title, "Privacy policy");
  assert.match(privacy.markdown, /Example Operator/u);
  assert.match(privacy.markdown, /withdraw all AI data consent/iu);
  assert.equal(terms.title, "Terms of service");
  assert.match(aiRules.markdown, /Content labels/u);
  assert.match(thirdParties.markdown, /System permissions/u);
  assert.match(personalInformation.markdown, /On-device information/u);
  assert.match(permissions.markdown, /no advertising identifier/iu);
  assert.doesNotMatch(
    [privacy, terms, aiRules, thirdParties, personalInformation, permissions]
      .map((document) => document.markdown)
      .join("\n"),
    /[\u3400-\u9fff]/u,
  );
});

test("mainland documents disclose the startup gate, adulthood, and exact lists", () => {
  const config = loadComplianceConfig({ distributionRegion: "china-mainland" });
  const privacy = complianceDocument("privacy", config).markdown;
  const terms = complianceDocument("terms", config).markdown;
  const personalInformation = complianceDocument(
    "personal-information",
    config,
  ).markdown;
  const permissions = complianceDocument("permissions", config).markdown;

  assert.match(privacy, /登录恢复、Agent、WebView/u);
  assert.match(privacy, /完整文档摘要/u);
  assert.match(terms, /已满 18 周岁/u);
  assert.match(personalInformation, /成年资格确认/u);
  assert.match(personalInformation, /最长 30 天/u);
  assert.match(permissions, /不会在启动时批量申请/u);
  assert.match(permissions, /不接入广告或行为分析 SDK/u);
});
