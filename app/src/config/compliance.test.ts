import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCloudDocumentConnectorsPermitted,
  assertModelPermittedForDistribution,
  assertThirdPartyMcpPermitted,
  chinaReleaseConfigurationIssues,
  cloudDocumentConnectorsEnabled,
  complianceEnvironmentFromProcess,
  DEFAULT_GLOBAL_COMPLIANCE_ENVIRONMENT,
  loadComplianceConfig,
  productionReleaseConfigurationIssues,
  thirdPartyMcpEnabled,
} from "./compliance.ts";

const registry = [
  {
    providerId: "provider-cn",
    providerName: "示例服务",
    baseUrl: "https://ai.example.cn/v1/",
    modelId: "example-model",
    modelName: "示例模型",
    recipientName: "示例科技有限公司",
    recipientLocation: "中国大陆",
    filingNumber: "示例登记号",
  },
];

test("the build environment selects only the checked-in distribution profile", () => {
  const environment = complianceEnvironmentFromProcess({
    EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION: "global",
    UNSUPPORTED_API_OVERRIDE: "https://ignored.example",
    UNSUPPORTED_OPERATOR_OVERRIDE: "Ignored Operator",
  });
  assert.deepEqual(environment, DEFAULT_GLOBAL_COMPLIANCE_ENVIRONMENT);
  assert.deepEqual(productionReleaseConfigurationIssues(environment), []);

  const config = loadComplianceConfig(environment);
  assert.equal(config.distributionRegion, "global");
  assert.equal(config.operatorName, "BoltPocket maintainers");
  assert.equal(config.firstPartyApiUrl, "https://boltpocket-api.example.invalid");
});

test("an unknown distribution region fails before any product configuration loads", () => {
  assert.throws(
    () =>
      complianceEnvironmentFromProcess({
        EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION: "unknown",
      }),
    /automatic, global, or china-mainland/u,
  );
});

test("automatic environment resolution uses the activated runtime region", () => {
  const environment = complianceEnvironmentFromProcess({
    EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION: "automatic",
  });
  assert.equal(environment.distributionRegion, "global");
});

test("China distribution only permits an exact registered mainland model", () => {
  const config = loadComplianceConfig({
    distributionRegion: "china-mainland",
    registeredAiServices: registry,
  });
  assert.equal(
    assertModelPermittedForDistribution(config, {
      baseUrl: "https://ai.example.cn/v1",
      model: "example-model",
    })?.providerName,
    "示例服务",
  );
  assert.throws(
    () =>
      assertModelPermittedForDistribution(config, {
        baseUrl: "https://other.example.com/v1",
        model: "example-model",
      }),
    /仅允许使用已登记/u,
  );
});

test("China distribution rejects model processing outside mainland China", () => {
  const config = loadComplianceConfig({
    distributionRegion: "china-mainland",
    registeredAiServices: registry.map((service) => ({
      ...service,
      recipientLocation: "美国",
    })),
  });
  assert.throws(
    () =>
      assertModelPermittedForDistribution(config, {
        baseUrl: "https://ai.example.cn/v1",
        model: "example-model",
      }),
    /境内处理/u,
  );
  assert.match(
    chinaReleaseConfigurationIssues(config).join("\n"),
    /不允许模型在中国大陆境外处理/u,
  );
});

test("China distribution disables cloud documents and third-party MCP", () => {
  const mainland = loadComplianceConfig({
    distributionRegion: "china-mainland",
  });
  assert.equal(cloudDocumentConnectorsEnabled(mainland), false);
  assert.equal(thirdPartyMcpEnabled(mainland), false);
  assert.throws(
    () => assertCloudDocumentConnectorsPermitted(mainland),
    /暂不提供/u,
  );
  assert.throws(() => assertThirdPartyMcpPermitted(mainland), /暂不提供/u);

  const global = loadComplianceConfig({ distributionRegion: "global" });
  assert.equal(cloudDocumentConnectorsEnabled(global), true);
  assert.equal(thirdPartyMcpEnabled(global), true);
});

test("the checked-in mainland profile stays blocked until operator facts are complete", () => {
  assert.deepEqual(
    chinaReleaseConfigurationIssues(
      loadComplianceConfig({ distributionRegion: "china-mainland" }),
    ),
    [
      "缺少 APP 备案编号",
      "缺少 example.invalid 网站 ICP 备案编号",
      "发行代码缺少已备案/登记的生成式 AI 服务清单",
      "大陆第一方 API、账号与法务页面尚未完成部署验收",
    ],
  );
});

test("release issues still detect explicit missing metadata and placeholders", () => {
  const issues = productionReleaseConfigurationIssues({
    distributionRegion: "china-mainland",
    operatorName: null,
    operatorAddress: null,
    supportEmail: null,
    privacyPolicyUrl: "https://example.com/privacy",
    termsUrl: "https://example.com/terms",
    appFilingNumber: "待填写",
    websiteIcpFilingNumber: "待填写",
    firstPartyServiceLocation: "美国",
    firstPartyApiUrl: "https://boltpocket-3rd-oauth.example.invalid",
    authenticationUrl: "https://auth.example.invalid",
    registeredAiServices: registry,
  });
  assert.match(issues.join("\n"), /占位值/u);
  assert.match(issues.join("\n"), /缺少运营主体/u);
  assert.match(issues.join("\n"), /尚未迁移/u);
});

test("a complete mainland production configuration passes", () => {
  assert.deepEqual(
    productionReleaseConfigurationIssues({
      distributionRegion: "china-mainland",
      operatorName: "上海握中科技有限公司",
      operatorAddress: "上海市浦东新区真实路 1 号",
      supportEmail: "support@boltpocket.cn",
      privacyPolicyUrl: "https://boltpocket.cn/legal/privacy",
      termsUrl: "https://boltpocket.cn/legal/terms",
      appFilingNumber: "沪ICP备12345678号-1A",
      websiteIcpFilingNumber: "沪ICP备12345678号-1",
      firstPartyServiceLocation: "中国大陆",
      firstPartyApiUrl: "https://api.boltpocket.cn",
      authenticationUrl: "https://auth.boltpocket.cn",
      registeredAiServices: [
        {
          providerId: "provider-cn",
          providerName: "境内模型服务",
          baseUrl: "https://api.vendor.cn/v1",
          modelId: "model-v1",
          modelName: "模型 V1",
          recipientName: "境内模型服务有限公司",
          recipientLocation: "中国大陆",
          filingNumber: "网信算备 310000000001",
        },
      ],
      serviceDeploymentVerified: true,
    }),
    [],
  );
});

test("public legal URLs and model registry URLs must be safe HTTPS", () => {
  assert.throws(
    () => loadComplianceConfig({ privacyPolicyUrl: "http://example.com" }),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      loadComplianceConfig({
        registeredAiServices: registry.map((service) => ({
          ...service,
          baseUrl: "https://user:secret@ai.example.cn/v1/",
        })),
      }),
    /安全的 HTTPS/u,
  );
});
