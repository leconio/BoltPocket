import ExpoModulesCore
import Foundation
import StoreKit

private let storefrontChangedEvent = "onStorefrontChange"

public final class BoltPocketStorefrontRegionModule: Module {
  private var updatesTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("BoltPocketStorefrontRegion")

    Events(storefrontChangedEvent)

    AsyncFunction("currentCountryCode") { () async -> String? in
      #if targetEnvironment(simulator)
      if let override = ProcessInfo.processInfo.environment["BOLTPOCKET_TEST_STOREFRONT_COUNTRY_CODE"] {
        return override
      }
      #endif
      return await Storefront.current?.countryCode
    }

    OnStartObserving(storefrontChangedEvent) {
      self.startObservingStorefrontUpdates()
    }

    OnStopObserving(storefrontChangedEvent) {
      self.stopObservingStorefrontUpdates()
    }

    OnDestroy {
      self.stopObservingStorefrontUpdates()
    }
  }

  private func startObservingStorefrontUpdates() {
    stopObservingStorefrontUpdates()
    updatesTask = Task { [weak self] in
      for await storefront in Storefront.updates {
        guard !Task.isCancelled else { return }
        self?.sendEvent(storefrontChangedEvent, [
          "countryCode": storefront.countryCode,
        ])
      }
    }
  }

  private func stopObservingStorefrontUpdates() {
    updatesTask?.cancel()
    updatesTask = nil
  }
}
