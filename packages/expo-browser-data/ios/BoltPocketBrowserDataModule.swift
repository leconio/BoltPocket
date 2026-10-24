import ExpoModulesCore
import Foundation
import WebKit

private final class BrowserDataClearException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Unable to clear browser website data: \(param)"
  }
}

public final class BoltPocketBrowserDataModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BoltPocketBrowserData")

    AsyncFunction("clear") { (promise: Promise) in
      DispatchQueue.main.async {
        URLCache.shared.removeAllCachedResponses()
        HTTPCookieStorage.shared.cookies?.forEach {
          HTTPCookieStorage.shared.deleteCookie($0)
        }
        WKWebsiteDataStore.default().removeData(
          ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
          modifiedSince: .distantPast
        ) {
          promise.resolve(nil)
        }
      }
    }
  }
}
