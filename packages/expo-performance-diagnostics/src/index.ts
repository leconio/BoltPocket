import { requireOptionalNativeModule } from "expo-modules-core";

export type AgentRunPerformanceOutcome = "completed" | "failed" | "cancelled";

export type AgentRunPerformanceMetrics = {
  outcome: AgentRunPerformanceOutcome;
  modelDeltaCount: number;
  modelDeltaCharacters: number;
  uiFlushCount: number;
  toolEventCount: number;
};

export type SystemPerformanceState = {
  thermalState: "nominal" | "fair" | "serious" | "critical" | "unknown";
  lowPowerMode: boolean;
};

type NativePerformanceDiagnostics = {
  beginAgentRun(intervalId: string): void;
  endAgentRun(
    intervalId: string,
    outcome: AgentRunPerformanceOutcome,
    modelDeltaCount: number,
    modelDeltaCharacters: number,
    uiFlushCount: number,
    toolEventCount: number,
  ): void;
  recordStorageWrite(
    durationMs: number,
    bytes: number,
    succeeded: boolean,
  ): void;
  systemState(): SystemPerformanceState;
};

const nativeModule = requireOptionalNativeModule<NativePerformanceDiagnostics>(
  "BoltPocketPerformanceDiagnostics",
);

export function beginAgentPerformanceInterval(intervalId: string) {
  nativeModule?.beginAgentRun(intervalId);
}

export function endAgentPerformanceInterval(
  intervalId: string,
  metrics: AgentRunPerformanceMetrics,
) {
  nativeModule?.endAgentRun(
    intervalId,
    metrics.outcome,
    metrics.modelDeltaCount,
    metrics.modelDeltaCharacters,
    metrics.uiFlushCount,
    metrics.toolEventCount,
  );
}

export function recordEncryptedStorageWrite(input: {
  durationMs: number;
  bytes: number;
  succeeded: boolean;
}) {
  nativeModule?.recordStorageWrite(
    input.durationMs,
    input.bytes,
    input.succeeded,
  );
}

export function getSystemPerformanceState(): SystemPerformanceState | null {
  return nativeModule?.systemState() ?? null;
}
