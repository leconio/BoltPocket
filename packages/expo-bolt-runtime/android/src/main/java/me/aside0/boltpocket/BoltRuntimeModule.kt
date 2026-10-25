package dev.boltpocket.app

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

class BoltNative(private val event: (String) -> Unit) {
  init { System.loadLibrary("boltexpo") }
  external fun load(path: String, gpu: Int, threads: Int)
  external fun generate(payload: String, max: Int, tag: String)
  external fun cancel()
  external fun probe(options: String)
  fun onNativeEvent(json: String) { event(json) }
}

class BoltRuntimeModule : Module() {
  private val downloadRoute = DownloadRoute()
  private val artifacts by lazy {
    ModelArtifacts(File(requireNotNull(appContext.reactContext).filesDir, "models"))
  }
  private fun configureVulkan() {
    val intent = appContext.currentActivity?.intent
    val traceLabel = intent?.getStringExtra("boltTraceLabel")
    if (traceLabel != null && traceLabel.matches(Regex("[a-z0-9-]{1,48}"))) {
      val ctx = requireNotNull(appContext.reactContext)
      val directory = File(ctx.getExternalFilesDir(null), "trace-$traceLabel")
      require(!directory.exists()) { "Trace directory already exists" }
      require(directory.mkdirs()) { "Could not create trace directory" }
      android.system.Os.setenv("BOLT_TRACE_DIR", directory.absolutePath, true)
    } else android.system.Os.unsetenv("BOLT_TRACE_DIR")
    // Named diagnostic switches only; read before Vulkan device initialization.
    val flags = mapOf(
      "boltVkSerial" to "GGML_VK_SERIALIZE_SUBMISSIONS",
      "boltVkNoFusion" to "GGML_VK_DISABLE_FUSION",
      "boltVkNoOptimize" to "GGML_VK_DISABLE_GRAPH_OPTIMIZE",
      "boltVkNoAsync" to "GGML_VK_DISABLE_ASYNC",
      "boltVkNoF16" to "GGML_VK_DISABLE_F16",
      "boltVkNoMmvq" to "GGML_VK_DISABLE_MMVQ",
      "boltNoFlashAttention" to "BOLT_NO_FLASH_ATTN",
      "boltClNoFusion" to "GGML_OPENCL_DISABLE_FUSION"
    )
    flags.forEach { (extra, name) ->
      if (intent?.getBooleanExtra(extra, false) == true) android.system.Os.setenv(name, "1", true)
      else android.system.Os.unsetenv(name)
    }
    if (intent?.getBooleanExtra("boltClNoXmem", false) == true) android.system.Os.setenv("GGML_OPENCL_ADRENO_XMEM_GEMM", "0", true)
    else android.system.Os.unsetenv("GGML_OPENCL_ADRENO_XMEM_GEMM")
    if (intent?.getBooleanExtra("boltClQ4Tiled", false) == true) android.system.Os.setenv("GGML_OPENCL_Q4K_GEMV_TILED", "1", true)
    else if (intent?.getBooleanExtra("boltClNoQ4Tiled", false) == true) android.system.Os.setenv("GGML_OPENCL_Q4K_GEMV_TILED", "0", true)
    else android.system.Os.unsetenv("GGML_OPENCL_Q4K_GEMV_TILED")
    val maxNodes = intent?.getIntExtra("boltVkMaxNodes", 0) ?: 0
    if (maxNodes in 1..1000) android.system.Os.setenv("GGML_VK_MAX_NODES_PER_SUBMIT", maxNodes.toString(), true)
    else android.system.Os.unsetenv("GGML_VK_MAX_NODES_PER_SUBMIT")
    val ubatch = intent?.getIntExtra("boltUbatch", 0) ?: 0
    if (ubatch in 1..256) android.system.Os.setenv("BOLT_UBATCH", ubatch.toString(), true)
    else android.system.Os.unsetenv("BOLT_UBATCH")
  }
  private val bridge by lazy { BoltNative { raw ->
    val obj = JSONObject(raw)
    val type = obj.optString("type")
    if (type == "loaded" || type == "done") {
      // VmRSS excludes Android GPU allocations. Sample total PSS separately
      // so the UI does not present only the small CPU mapping as total RAM.
      try {
        val memory = android.os.Debug.MemoryInfo()
        android.os.Debug.getMemoryInfo(memory)
        obj.put("android_pss_mib", memory.totalPss / 1024.0)
        memory.getMemoryStat("summary.graphics")?.toDoubleOrNull()?.let {
          obj.put("android_graphics_pss_mib", it / 1024.0)
        }
      } catch (_: RuntimeException) { /* Keep inference usable if accounting is unavailable. */ }
    }
    val enriched = obj.toString()
    if (type != "token") record(enriched)
    sendEvent("onNativeEvent", mapOf("json" to enriched))
  } }
  private fun record(raw: String) {
    val ctx = appContext.reactContext ?: return
    val obj = JSONObject(raw)
    obj.remove("text"); obj.remove("prompt"); obj.remove("messages"); obj.remove("tool_calls")
    File(ctx.getExternalFilesDir(null), "bolt-metrics.ndjson").appendText(obj.toString() + "\n")
  }
  override fun definition() = ModuleDefinition {
    Name("BoltRuntime")
    Events("onNativeEvent")
    AsyncFunction("prepareModelFile") {
      val ctx = requireNotNull(appContext.reactContext)
      val file = File(ctx.getExternalFilesDir(null), "model.gguf")
      if (!file.exists()) file.createNewFile()
      file.absolutePath
    }
    AsyncFunction("load") { gpu: Int ->
      configureVulkan()
      val ctx = requireNotNull(appContext.reactContext)
      val kernelCache = File(ctx.cacheDir, "opencl-kernels").apply { mkdirs() }
      android.system.Os.setenv("GGML_OPENCL_KERNEL_CACHE_DIR", kernelCache.absolutePath, true)
      val prefixCache = File(ctx.noBackupFilesDir, "llama-prefix-cache").apply { mkdirs() }
      android.system.Os.setenv("BOLT_PREFIX_CACHE_DIR", prefixCache.absolutePath, true)
      android.system.Os.setenv("BOLT_CACHE_DEVICE_ID", android.os.Build.FINGERPRINT, true)
      val layers = appContext.currentActivity?.intent?.getIntExtra("boltGpuLayers", gpu) ?: gpu
      bridge.load(File(ctx.getExternalFilesDir(null), "model.gguf").absolutePath, layers, 6)
    }
    AsyncFunction("modelArtifactInfo") { spec: String -> artifacts.info(spec) }
    AsyncFunction("beginModelDownloadRoute") {
      val intent = appContext.currentActivity?.intent
      val host = intent?.getStringExtra("boltDownloadProxyHost")
      if (host != null && intent != null) {
        record(downloadRoute.begin(host, intent.getIntExtra("boltDownloadProxyPort", 0),
          intent.getStringExtra("boltDownloadProxyCountry") ?: ""))
      }
    }
    AsyncFunction("endModelDownloadRoute") { downloadRoute.end() }
    AsyncFunction("commitModelArtifact") { spec: String -> artifacts.commit(spec) }
    AsyncFunction("loadModelArtifact") { spec: String, gpu: Int ->
      val path = artifacts.verifiedPath(spec)
      configureVulkan()
      val ctx = requireNotNull(appContext.reactContext)
      val kernelCache = File(ctx.cacheDir, "opencl-kernels").apply { mkdirs() }
      android.system.Os.setenv("GGML_OPENCL_KERNEL_CACHE_DIR", kernelCache.absolutePath, true)
      val prefixCache = File(ctx.noBackupFilesDir, "llama-prefix-cache").apply { mkdirs() }
      android.system.Os.setenv("BOLT_PREFIX_CACHE_DIR", prefixCache.absolutePath, true)
      android.system.Os.setenv("BOLT_CACHE_DEVICE_ID", android.os.Build.FINGERPRINT, true)
      bridge.load(path, gpu, 6)
    }
    AsyncFunction("generate") { payload: String, max: Int, tag: String -> bridge.generate(payload, max, tag) }
    AsyncFunction("probe") { options: String ->
      configureVulkan()
      val ctx = requireNotNull(appContext.reactContext)
      val kernelCache = File(ctx.cacheDir, "opencl-kernels").apply { mkdirs() }
      android.system.Os.setenv("GGML_OPENCL_KERNEL_CACHE_DIR", kernelCache.absolutePath, true)
      bridge.probe(options)
    }
    Function("cancel") { bridge.cancel() }
    Function("record") { raw: String -> record(raw) }
  }
}
