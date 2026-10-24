package dev.boltpocket.app.browserdata

import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class BrowserDataClearException(cause: Throwable? = null) :
  CodedException("Unable to clear browser website data.", cause)

class BoltPocketBrowserDataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BoltPocketBrowserData")

    AsyncFunction("clear") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(BrowserDataClearException())
        return@AsyncFunction
      }

      try {
        WebStorage.getInstance().deleteAllData()
        WebViewDatabase.getInstance(context).apply {
          clearFormData()
          clearHttpAuthUsernamePassword()
        }
        WebView(context).apply {
          clearCache(true)
          clearFormData()
          clearHistory()
          destroy()
        }
        CookieManager.getInstance().removeAllCookies {
          try {
            CookieManager.getInstance().flush()
            promise.resolve(null)
          } catch (error: Throwable) {
            promise.reject(BrowserDataClearException(error))
          }
        }
      } catch (error: Throwable) {
        promise.reject(BrowserDataClearException(error))
      }
    }.runOnQueue(Queues.MAIN)
  }
}
