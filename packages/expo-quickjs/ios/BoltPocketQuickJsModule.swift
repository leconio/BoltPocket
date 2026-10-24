import ExpoModulesCore
import Foundation

public final class BoltPocketQuickJsModule: Module {
  private let executionQueue = DispatchQueue(
    label: "dev.boltpocket.app.quickjs.execution",
    qos: .userInitiated
  )

  public func definition() -> ModuleDefinition {
    Name("BoltPocketQuickJs")

    AsyncFunction("execute") {
      (
        executionId: Int,
        code: String,
        filename: String,
        inputJson: String?,
        timeoutMs: Int,
        memoryLimitBytes: Int,
        stackLimitBytes: Int,
        maxOutputBytes: Int
      ) -> [String: Any] in
      BoltPocketQuickJsBridge.execute(
        code,
        executionId: executionId,
        filename: filename,
        inputJson: inputJson,
        timeoutMs: timeoutMs,
        memoryLimitBytes: memoryLimitBytes,
        stackLimitBytes: stackLimitBytes,
        maxOutputBytes: maxOutputBytes
      )
    }.runOnQueue(executionQueue)

    Function("cancel") { (executionId: Int) in
      BoltPocketQuickJsBridge.cancel(executionId)
    }
  }
}
