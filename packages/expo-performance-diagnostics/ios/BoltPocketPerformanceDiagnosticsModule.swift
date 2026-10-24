import ExpoModulesCore
import Foundation
import os

private let performanceLog = OSLog(
  subsystem: "dev.boltpocket.app",
  // Instruments' standard profiling templates collect this category without
  // requiring a custom trace template.
  category: .pointsOfInterest
)

private func thermalStateName(_ state: ProcessInfo.ThermalState) -> String {
  switch state {
  case .nominal:
    return "nominal"
  case .fair:
    return "fair"
  case .serious:
    return "serious"
  case .critical:
    return "critical"
  @unknown default:
    return "unknown"
  }
}

public final class BoltPocketPerformanceDiagnosticsModule: Module {
  private let lock = NSLock()
  private var intervals: [String: OSSignpostID] = [:]

  public func definition() -> ModuleDefinition {
    Name("BoltPocketPerformanceDiagnostics")

    Function("systemState") {
      [
        "thermalState": thermalStateName(ProcessInfo.processInfo.thermalState),
        "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      ] as [String: Any]
    }

    Function("beginAgentRun") { (intervalId: String) in
      guard !intervalId.isEmpty, intervalId.count <= 120 else { return }
      let signpostId = OSSignpostID(log: performanceLog)
      lock.lock()
      guard intervals.count < 16, intervals[intervalId] == nil else {
        lock.unlock()
        return
      }
      intervals[intervalId] = signpostId
      lock.unlock()
      let process = ProcessInfo.processInfo
      os_signpost(
        .begin,
        log: performanceLog,
        name: "AgentRun",
        signpostID: signpostId,
        "thermal=%{public}@ low_power=%{public}d",
        thermalStateName(process.thermalState) as NSString,
        process.isLowPowerModeEnabled ? 1 : 0
      )
    }

    Function("endAgentRun") {
      (
        intervalId: String,
        outcome: String,
        modelDeltaCount: Int,
        modelDeltaCharacters: Int,
        uiFlushCount: Int,
        toolEventCount: Int
      ) in
      lock.lock()
      let signpostId = intervals.removeValue(forKey: intervalId)
      lock.unlock()
      guard let signpostId else { return }
      let safeOutcome = ["completed", "failed", "cancelled"].contains(outcome)
        ? outcome
        : "failed"
      let process = ProcessInfo.processInfo
      os_signpost(
        .end,
        log: performanceLog,
        name: "AgentRun",
        signpostID: signpostId,
        "outcome=%{public}@ deltas=%{public}d chars=%{public}d ui_flushes=%{public}d tool_events=%{public}d thermal=%{public}@ low_power=%{public}d",
        safeOutcome as NSString,
        max(0, modelDeltaCount),
        max(0, modelDeltaCharacters),
        max(0, uiFlushCount),
        max(0, toolEventCount),
        thermalStateName(process.thermalState) as NSString,
        process.isLowPowerModeEnabled ? 1 : 0
      )
    }

    Function("recordStorageWrite") {
      (durationMs: Double, bytes: Int, succeeded: Bool) in
      os_signpost(
        .event,
        log: performanceLog,
        name: "EncryptedStorageWrite",
        "duration_ms=%{public}.3f bytes=%{public}d succeeded=%{public}d thermal=%{public}@",
        max(0, durationMs),
        max(0, bytes),
        succeeded ? 1 : 0,
        thermalStateName(ProcessInfo.processInfo.thermalState) as NSString
      )
    }
  }
}
