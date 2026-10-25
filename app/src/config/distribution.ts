export type DistributionRegion = "global" | "china-mainland";
export type DistributionMode = "automatic" | DistributionRegion;

export type DistributionAiService = Readonly<{
  providerId: string;
  providerName: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  recipientName: string;
  recipientLocation: string;
  filingNumber: string;
}>;

export type DistributionProfile = Readonly<{
  region: DistributionRegion;
  operatorName: string;
  operatorAddress: string;
  supportEmail: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  appFilingNumber: string | null;
  websiteIcpFilingNumber: string | null;
  registeredAiServices: readonly DistributionAiService[];
  miniAppNetwork: Readonly<{
    policy: "declared" | "registered-only";
    registeredOrigins: readonly string[];
  }>;
  capabilities: Readonly<{
    thirdPartyMcp: boolean;
    generatedImages: boolean;
    generatedVideo: boolean;
  }>;
}>;
const OPERATOR_NAME = "BoltPocket maintainers";
const OPERATOR_ADDRESS = "";
const SUPPORT_EMAIL = "";

/**
 * Public, non-secret product configuration belongs in the signed application.
 * A production iOS build resolves one profile from StoreKit at runtime; local
 * builds may select one explicitly. Neither path may redefine the operator,
 * endpoints, legal copy, feature policy, or model allow-list.
 */
export const GLOBAL_DISTRIBUTION_PROFILE: DistributionProfile = {
  region: "global",
  operatorName: OPERATOR_NAME,
  operatorAddress: OPERATOR_ADDRESS,
  supportEmail: SUPPORT_EMAIL,
  privacyPolicyUrl: "",
  termsUrl: "",
  appFilingNumber: null,
  websiteIcpFilingNumber: null,
  registeredAiServices: [],
  miniAppNetwork: {
    policy: "declared",
    registeredOrigins: [],
  },
  capabilities: {
    thirdPartyMcp: true,
    generatedImages: true,
    generatedVideo: false,
  },
};

/**
 * Mainland distribution remains unavailable for release until operator metadata,
 * filing numbers and each model registration have been verified. Release checks
 * fail closed while those entries remain incomplete.
 */
export const CHINA_MAINLAND_DISTRIBUTION_PROFILE: DistributionProfile = {
  region: "china-mainland",
  operatorName: OPERATOR_NAME,
  operatorAddress: OPERATOR_ADDRESS,
  supportEmail: SUPPORT_EMAIL,
  privacyPolicyUrl: "",
  termsUrl: "",
  appFilingNumber: null,
  websiteIcpFilingNumber: null,
  registeredAiServices: [],
  miniAppNetwork: {
    // Mainland mini apps stay offline until an operator-reviewed recipient is
    // explicitly registered in the signed profile.
    policy: "registered-only",
    registeredOrigins: [],
  },
  capabilities: {
    thirdPartyMcp: false,
    // Generated media remains unavailable until exported files receive the
    // required visible and machine-readable provenance labels.
    generatedImages: false,
    generatedVideo: false,
  },
};

const COMPILED_DISTRIBUTION_REGION =
  process.env.EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION;

let runtimeDistributionRegion: DistributionRegion = "global";

export function parseDistributionRegion(
  value: string | undefined,
): DistributionRegion {
  const normalized = value?.trim() || "global";
  if (normalized !== "global" && normalized !== "china-mainland") {
    throw new Error(
      "EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION must be global or china-mainland.",
    );
  }
  return normalized;
}

export function parseDistributionMode(
  value: string | undefined,
): DistributionMode {
  const normalized = value?.trim() || "automatic";
  if (
    normalized !== "automatic" &&
    normalized !== "global" &&
    normalized !== "china-mainland"
  ) {
    throw new Error(
      "EXPO_PUBLIC_BOLTPOCKET_DISTRIBUTION_REGION must be automatic, global, or china-mainland.",
    );
  }
  return normalized;
}

export function compiledDistributionMode(
  value: string | undefined = COMPILED_DISTRIBUTION_REGION,
) {
  return parseDistributionMode(value);
}

export function activateDistributionRegion(region: DistributionRegion) {
  runtimeDistributionRegion = region;
}

export function activeDistributionRegion() {
  return runtimeDistributionRegion;
}

export function compiledDistributionRegion(
  value: string | undefined = COMPILED_DISTRIBUTION_REGION,
) {
  const mode = parseDistributionMode(value);
  return mode === "automatic" ? activeDistributionRegion() : mode;
}

export function distributionProfile(
  region: DistributionRegion = activeDistributionRegion(),
): DistributionProfile {
  return region === "china-mainland"
    ? CHINA_MAINLAND_DISTRIBUTION_PROFILE
    : GLOBAL_DISTRIBUTION_PROFILE;
}

export function unsupportedMiniAppNetworkOrigins(
  origins: readonly string[],
  region: DistributionRegion = activeDistributionRegion(),
) {
  const policy = distributionProfile(region).miniAppNetwork;
  if (policy.policy === "declared")
    return Object.freeze([]) as readonly string[];
  const registered = new Set(policy.registeredOrigins);
  return Object.freeze(origins.filter((origin) => !registered.has(origin)));
}
