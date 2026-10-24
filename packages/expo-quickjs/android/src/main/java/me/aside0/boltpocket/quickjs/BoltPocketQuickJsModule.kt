package dev.boltpocket.app.quickjs

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel

private object BoltPocketQuickJsNative {
  init {
    System.loadLibrary("boltpocket-quickjs")
  }

  external fun executeNative(
    executionId: Int,
    code: String,
    filename: String,
    inputJson: String?,
    timeoutMs: Int,
    memoryLimitBytes: Int,
    stackLimitBytes: Int,
    maxOutputBytes: Int
  ): Map<String, Any?>

  external fun cancelNative(executionId: Int)
}

class BoltPocketQuickJsModule : Module() {
  private val dispatcher = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "boltpocket-quickjs").apply { isDaemon = true }
  }.asCoroutineDispatcher()
  private val executionScope = CoroutineScope(SupervisorJob() + dispatcher)

  override fun definition() = ModuleDefinition {
    Name("BoltPocketQuickJs")

    AsyncFunction("execute") {
        executionId: Int,
        code: String,
        filename: String,
        inputJson: String?,
        timeoutMs: Int,
        memoryLimitBytes: Int,
        stackLimitBytes: Int,
        maxOutputBytes: Int ->
      BoltPocketQuickJsNative.executeNative(
        executionId,
        code,
        filename,
        inputJson,
        timeoutMs,
        memoryLimitBytes,
        stackLimitBytes,
        maxOutputBytes
      )
    }.runOnQueue(executionScope)

    Function("cancel") { executionId: Int ->
      BoltPocketQuickJsNative.cancelNative(executionId)
    }

    OnDestroy {
      executionScope.cancel()
      dispatcher.close()
    }
  }
}
