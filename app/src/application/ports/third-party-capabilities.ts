export type ThirdPartyCapabilityKind = "skill" | "mcp";
export type ThirdPartyMcpAuthentication = "none" | "oauth";
export type ThirdPartyCapabilityAssessmentStatus =
  "compatible" | "limited" | "incompatible";

export type ThirdPartyCapabilityRuntimeProfile =
  | Readonly<{
      bundleInstallation: "complete-or-reject";
      inspection: "static-document-analysis";
      instructionsExecuted: false;
      javascript: Readonly<{
        engine: "quickjs";
        maxCodeBytes: number;
        maxExecutionMs: number;
        maxFiles: number;
        maxInputBytes: number;
        maxMemoryBytes: number;
        maxOutputBytes: number;
        mode: "bounded-read-only";
        network: false;
        modules: false;
        persistence: false;
        projectFiles: "explicit-read-only";
        tool: "js_exec";
        writes: false;
      }>;
      kind: "skill";
      maxBundleBytes: number;
      maxBundleFiles: number;
      supportingFilesInstalled: true;
      unsupportedRuntimes: readonly ["node", "python"];
    }>
  | Readonly<{
      businessToolsCalled: false;
      inspection: "handshake-ping-tools-list";
      kind: "mcp";
      supportedTransport: "streamable-http";
      unsupportedTransports: readonly ["stdio", "legacy-sse", "websocket"];
    }>;

export type ThirdPartyCapabilityCheck = Readonly<{
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
}>;

export type ThirdPartyCapabilityRisk = Readonly<{
  id: string;
  label: string;
  severity: "low" | "medium" | "high";
}>;

export type ThirdPartyCapabilityAssessment = Readonly<{
  assessmentId: string;
  reportFormat: "boltpocket-capability-diagnostic/v1";
  kind: ThirdPartyCapabilityKind;
  name: string;
  sourceUrl: string;
  fingerprint: string;
  projectId: string;
  status: ThirdPartyCapabilityAssessmentStatus;
  installable: boolean;
  checks: readonly ThirdPartyCapabilityCheck[];
  risks: readonly ThirdPartyCapabilityRisk[];
  runtime: ThirdPartyCapabilityRuntimeProfile;
  package?: Readonly<{
    binaryFileCount: number;
    complete: true;
    executableFileCount: number;
    fileCount: number;
    sha256: string;
    textFileCount: number;
    totalBytes: number;
  }>;
  plannedInstall: Readonly<{
    target: "global-mcp" | "project-skills";
    enabled: boolean;
    authentication?: ThirdPartyMcpAuthentication;
    allToolCallsRequireApproval?: boolean;
  }>;
  expiresAt: string;
  confirmationRequired: boolean;
  confirmationCarriedForward?: true;
  nextStep: string;
  suggestedAuthentication?: ThirdPartyMcpAuthentication;
  discoveredTools?: readonly string[];
}>;

export type AssessThirdPartyCapabilityInput = Readonly<{
  authentication?: ThirdPartyMcpAuthentication;
  conversationId: string;
  kind: ThirdPartyCapabilityKind;
  name?: string;
  projectId: string;
  projectName: string;
  runId: string;
  url: string;
}>;

export type InstallThirdPartyCapabilityInput = Readonly<{
  assessmentId: string;
  conversationId: string;
  latestUserPrompt: string;
  projectId: string;
  runId: string;
}>;

export type ThirdPartyCapabilityInstallResult = Readonly<{
  assessmentId: string;
  enabled: boolean;
  installed: true;
  itemId: string;
  kind: ThirdPartyCapabilityKind;
  list: "global-mcp" | "project-skills";
  name: string;
  receiptId?: string;
  updateTracking?: "saved" | "unavailable";
}>;

export interface AgentThirdPartyCapabilityPort {
  hasAssessmentAwaitingConfirmation(
    input: Readonly<{
      conversationId: string;
      projectId: string;
    }>,
  ): boolean;
  assess(
    input: AssessThirdPartyCapabilityInput,
    signal?: AbortSignal,
  ): Promise<ThirdPartyCapabilityAssessment>;
  install(
    input: InstallThirdPartyCapabilityInput,
    signal?: AbortSignal,
  ): Promise<ThirdPartyCapabilityInstallResult>;
}
