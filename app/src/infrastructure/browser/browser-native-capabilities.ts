import type { BrowserSettings } from "./browser-settings-repository";
import type { BrowserBarcodeFormat } from "./browser-native-web-api-model.ts";

export type BrowserNativeBridgeSettings = Readonly<{
  capabilityConsent?: boolean;
  location: boolean;
  clipboardText: boolean;
  permissions: boolean;
  sharing: boolean;
  screenOrientation: boolean;
  printing: boolean;
  barcodeFormats: readonly BrowserBarcodeFormat[];
}>;

const DEFAULT_NATIVE_BRIDGE_SETTINGS: BrowserNativeBridgeSettings =
  Object.freeze({
    capabilityConsent: false,
    location: false,
    clipboardText: false,
    permissions: false,
    sharing: false,
    screenOrientation: false,
    printing: false,
    barcodeFormats: Object.freeze([]),
  });

export function shouldEnableBrowserNativeBridge(
  platform: string,
  _projectPreview: boolean,
) {
  return platform === "android" || platform === "ios";
}

function serialized(settings: BrowserSettings) {
  return JSON.stringify(settings);
}

export function createBrowserCapabilityUpdateScript(settings: BrowserSettings) {
  return `
    (() => {
      window.__boltpocketNativeCapabilities = ${serialized(settings)};
      const refresh = window.__boltpocketRefreshPermissionStates;
      if (typeof refresh === "function") void refresh();
    })();
    true;
  `;
}

export function createBrowserPageLifecycleScript(active: boolean) {
  return `
    (() => {
      const update = window.__boltpocketSetPageActive;
      if (typeof update === "function") update(${active ? "true" : "false"});
    })();
    true;
  `;
}

export function createBrowserCapabilityGuardScript(
  settings: BrowserSettings,
  nativeBridge: BrowserNativeBridgeSettings = DEFAULT_NATIVE_BRIDGE_SETTINGS,
  nativeBridgeToken: string | null = null,
  initiallyActive = true,
) {
  return `
    (() => {
      window.__boltpocketNativeCapabilities = ${serialized(settings)};
      window.__boltpocketNativeBridgeSettings = ${JSON.stringify(nativeBridge)};
      if (window.__boltpocketNativeCapabilityGuardInstalled) return;
      window.__boltpocketNativeCapabilityGuardInstalled = true;

      const protect = (install) => {
        try { install(); } catch (_) {}
      };
      const replaceMethod = (target, name, replacement) => {
        try {
          target[name] = replacement;
          if (target[name] === replacement) return;
        } catch (_) {}
        try {
          Object.defineProperty(target, name, {
            configurable: true,
            value: replacement,
            writable: true,
          });
        } catch (_) {}
      };
      const permissionError = () => {
        if (typeof DOMException === "function") {
          return new DOMException("Permission denied", "NotAllowedError");
        }
        const error = new Error("Permission denied");
        error.name = "NotAllowedError";
        return error;
      };
      const denied = () => Promise.reject(permissionError());
      const nativePostMessage = typeof window.ReactNativeWebView?.postMessage === "function"
        ? window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView)
        : null;
      const nativeRequestToken = ${JSON.stringify(nativeBridgeToken)};
      const nativeRequests = new Map();
      let nativeRequestSequence = 0;
      const nativeError = (value) => {
        const name = value && typeof value.name === "string"
          ? value.name.slice(0, 80)
          : "UnknownError";
        const message = value && typeof value.message === "string"
          ? value.message.slice(0, 240)
          : "Native operation failed.";
        if (typeof DOMException === "function") {
          try { return new DOMException(message, name); } catch (_) {}
        }
        const error = new Error(message);
        error.name = name;
        return error;
      };
      const requestNative = (operation, payload = {}, timeout = 65000) =>
        new Promise((resolve, reject) => {
          if (!nativePostMessage || !nativeRequestToken) {
            reject(nativeError({
              name: "NotSupportedError",
              message: "Native browser bridge is unavailable.",
            }));
            return;
          }
          nativeRequestSequence = (nativeRequestSequence % 2147483646) + 1;
          const requestId = "native-request-" + Date.now().toString(36) + "-" + nativeRequestSequence.toString(36);
          const timer = window.setTimeout(() => {
            nativeRequests.delete(requestId);
            reject(nativeError({
              name: "TimeoutError",
              message: "Native operation timed out.",
            }));
          }, timeout);
          nativeRequests.set(requestId, { resolve, reject, timer });
          try {
            nativePostMessage(JSON.stringify({
              channel: "boltpocket-browser-v1",
              type: "native-api-request",
              bridgeToken: nativeRequestToken,
              requestId,
              operation,
              ...payload,
            }));
          } catch (error) {
            window.clearTimeout(timer);
            nativeRequests.delete(requestId);
            reject(nativeError(error));
          }
        });
      const authorizeCapability = (capability) => {
        const bridge = window.__boltpocketNativeBridgeSettings || {};
        if (!bridge.capabilityConsent) return Promise.resolve();
        return requestNative("capability-authorize", { capability }, 65000).then((allowed) => {
          if (allowed === true) {
            window.__boltpocketSessionCapabilityGrants[capability] = true;
            window.__boltpocketSyncMediaCapabilityControls?.();
            return;
          }
          throw permissionError();
        });
      };
      window.__boltpocketResolveNativeRequest = (requestId, response) => {
        const pending = nativeRequests.get(requestId);
        if (!pending) return;
        nativeRequests.delete(requestId);
        window.clearTimeout(pending.timer);
        if (response && response.ok === true) pending.resolve(response.result);
        else pending.reject(nativeError(response?.error));
      };
      const normalizeLocationOptions = (value) => {
        const options = value && typeof value === "object" ? value : {};
        const numberOr = (candidate, fallback) => {
          try {
            const result = Number(candidate);
            return Number.isNaN(result) ? fallback : result;
          } catch (_) {
            return fallback;
          }
        };
        const rawTimeout = numberOr(options.timeout, 30000);
        const timeout = Number.isFinite(rawTimeout)
          ? Math.max(0, Math.min(60000, Math.floor(rawTimeout)))
          : 60000;
        const rawMaximumAge = numberOr(options.maximumAge, 0);
        const maximumAge = rawMaximumAge === Infinity
          ? -1
          : Math.max(0, Math.min(86400000, Math.floor(rawMaximumAge)));
        return {
          enableHighAccuracy: options.enableHighAccuracy === true,
          timeout,
          maximumAge,
        };
      };
      const geolocationError = (error) => {
        const code = error?.name === "NotAllowedError"
          ? 1
          : error?.name === "TimeoutError"
            ? 3
            : 2;
        return Object.freeze({
          code,
          message: error?.message || "Location data is unavailable.",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      };
      const locationWatches = new Map();
      const activeMediaStreams = new Set();
      const activeWakeLocks = new Set();
      window.__boltpocketSessionCapabilityGrants = Object.create(null);
      const syncMediaCapabilityControls = () => protect(() => {
        const grants = window.__boltpocketSessionCapabilityGrants || {};
        for (const mediaElement of document.querySelectorAll("video, audio")) {
          if (mediaElement instanceof HTMLVideoElement) {
            mediaElement.disablePictureInPicture = grants.pictureInPicture !== true;
            if (grants.fullscreenMedia === true) {
              mediaElement.controlsList?.remove?.("nofullscreen");
            } else {
              mediaElement.setAttribute("playsinline", "");
              mediaElement.controlsList?.add?.("nofullscreen");
            }
          }
          mediaElement.disableRemotePlayback = grants.airPlay !== true;
          if (grants.airPlay === true) {
            mediaElement.controlsList?.remove?.("noremoteplayback");
          } else {
            mediaElement.controlsList?.add?.("noremoteplayback");
          }
        }
      });
      window.__boltpocketSyncMediaCapabilityControls = syncMediaCapabilityControls;
      const initiallyPageActive = ${initiallyActive ? "true" : "false"};
      let locationWatchSequence = 0;
      window.__boltpocketDeliverLocationWatch = (watchId, event) => {
        const watch = locationWatches.get(watchId);
        if (!watch) return;
        if (event && event.ok === true) {
          if (typeof watch.success === "function") watch.success(event.position);
          return;
        }
        if (typeof watch.failure === "function") {
          watch.failure(geolocationError(event?.error));
        }
      };
      const hasTransientUserActivation = () => {
        const activation = navigator.userActivation;
        return !activation || activation.isActive === true;
      };
      const isTopLevel = () => {
        try { return window.top === window; } catch (_) { return false; }
      };
      const lifecycleStyleId = "boltpocket-inactive-page-style";
      const syncInactiveVisualStyle = () => protect(() => {
        const existing = document.getElementById(lifecycleStyleId);
        if (window.__boltpocketPageActive !== false) {
          if (existing) existing.remove();
          return;
        }
        if (existing) return;
        const style = document.createElement("style");
        style.id = lifecycleStyleId;
        style.textContent = "*,*::before,*::after{animation-play-state:paused!important}";
        (document.head || document.documentElement)?.appendChild(style);
      });
      window.__boltpocketPageActive = true;
      window.__boltpocketSetPageActive = (active) => {
        const next = active === true;
        if (window.__boltpocketPageActive === next) return;
        window.__boltpocketPageActive = next;
        if (!next) {
          window.__boltpocketMotionConsentActive = false;
          window.__boltpocketSessionCapabilityGrants = Object.create(null);
          protect(() => {
            for (const mediaElement of document.querySelectorAll("audio, video")) {
              if (typeof mediaElement.pause === "function") mediaElement.pause();
            }
          });
          syncMediaCapabilityControls();
          for (const stream of [...activeMediaStreams]) {
            activeMediaStreams.delete(stream);
            protect(() => {
              for (const track of stream.getTracks()) track.stop();
            });
          }
          for (const watchId of [...locationWatches.keys()]) {
            locationWatches.delete(watchId);
            requestNative("location-watch-stop", { watchId }, 15000).catch(() => {});
          }
          for (const sentinel of [...activeWakeLocks]) {
            activeWakeLocks.delete(sentinel);
            protect(() => sentinel.release());
          }
          protect(() => navigator.vibrate?.(0));
          protect(() => {
            if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
              void document.exitFullscreen().catch(() => {});
            }
          });
          protect(() => {
            if (document.pictureInPictureElement && typeof document.exitPictureInPicture === "function") {
              void document.exitPictureInPicture().catch(() => {});
            }
          });
        }
        syncInactiveVisualStyle();
        protect(() => window.dispatchEvent(new CustomEvent("boltpocketvisibilitychange", {
          detail: Object.freeze({ active: next }),
        })));
      };
      protect(() => document.addEventListener("DOMContentLoaded", syncInactiveVisualStyle));
      protect(() => document.addEventListener("DOMContentLoaded", () => {
        syncMediaCapabilityControls();
        const observer = new MutationObserver(syncMediaCapabilityControls);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }));
      protect(() => document.addEventListener("play", (event) => {
        if (window.__boltpocketPageActive !== false) return;
        const mediaElement = event.target;
        if (mediaElement && typeof mediaElement.pause === "function") mediaElement.pause();
      }, true));
      window.__boltpocketSetPageActive(initiallyPageActive);

      protect(() => {
        const permissions = navigator.permissions;
        const originalQuery = permissions && typeof permissions.query === "function"
          ? permissions.query.bind(permissions)
          : null;
        const supported = new Set([
          "geolocation",
          "camera",
          "microphone",
          "clipboard-read",
          "clipboard-write",
        ]);
        const capabilityFor = (name) => ({
          geolocation: "location",
          camera: "camera",
          microphone: "microphone",
          "clipboard-read": "clipboardRead",
          "clipboard-write": "clipboardWrite",
        })[name];
        const statuses = new Map();
        const statusFor = (name, initialState) => {
          const existing = statuses.get(name);
          if (existing) {
            existing.__update(initialState);
            return existing;
          }
          let state = initialState;
          const listeners = new Set();
          const status = {
            onchange: null,
            get state() { return state; },
            addEventListener(type, listener) {
              if (type === "change" && typeof listener === "function") listeners.add(listener);
            },
            removeEventListener(type, listener) {
              if (type === "change") listeners.delete(listener);
            },
            dispatchEvent(event) {
              if (!event || event.type !== "change") return true;
              for (const listener of [...listeners]) {
                try { listener.call(status, event); } catch (_) {}
              }
              if (typeof status.onchange === "function") {
                try { status.onchange.call(status, event); } catch (_) {}
              }
              return !event.defaultPrevented;
            },
            __update(nextState) {
              if (nextState === state) return;
              state = nextState;
              const event = typeof Event === "function" ? new Event("change") : { type: "change" };
              status.dispatchEvent(event);
            },
          };
          statuses.set(name, status);
          return status;
        };
        const queryState = (name) => {
          const capability = capabilityFor(name);
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (capability && !capabilities[capability]) return Promise.resolve("denied");
          const bridge = window.__boltpocketNativeBridgeSettings || {};
          if (bridge.permissions) {
            return requestNative("permission-query", { permission: name }, 15000);
          }
          if (originalQuery) {
            return originalQuery({ name }).then((status) => status.state);
          }
          return Promise.reject(nativeError({
            name: "NotSupportedError",
            message: "Permissions API is unavailable.",
          }));
        };
        const query = (descriptor) => {
          const name = descriptor && descriptor.name;
          if (!supported.has(name)) {
            return originalQuery
              ? originalQuery(descriptor)
              : Promise.reject(nativeError({
                  name: "NotSupportedError",
                  message: "Permission name is not supported.",
                }));
          }
          return queryState(name).then((state) => statusFor(name, state));
        };
        window.__boltpocketRefreshPermissionStates = () => Promise.all(
          [...statuses.keys()].map((name) =>
            queryState(name).then(
              (state) => statusFor(name, state),
              () => undefined,
            ),
          ),
        );
        if (permissions) {
          replaceMethod(permissions, "query", query);
          return;
        }
        try {
          Object.defineProperty(navigator, "permissions", {
            configurable: true,
            value: Object.freeze({ query }),
          });
        } catch (_) {}
      });

      protect(() => {
        const media = navigator.mediaDevices;
        if (!media || typeof media.getUserMedia !== "function") return;
        const getUserMedia = media.getUserMedia.bind(media);
        replaceMethod(media, "getUserMedia", (constraints) => {
          if (window.__boltpocketPageActive === false) return denied();
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (constraints && typeof constraints === "object") {
            if (constraints.video && !capabilities.camera) return denied();
            if (constraints.audio && !capabilities.microphone) return denied();
          }
          const requested = [];
          if (constraints && typeof constraints === "object") {
            if (constraints.video) requested.push("camera");
            if (constraints.audio) requested.push("microphone");
          }
          return requested.reduce(
            (pending, capability) => pending.then(() => authorizeCapability(capability)),
            Promise.resolve(),
          ).then(() => getUserMedia(constraints)).then((stream) => {
            if (window.__boltpocketPageActive === false) {
              for (const track of stream.getTracks()) track.stop();
              throw permissionError();
            }
            activeMediaStreams.add(stream);
            for (const track of stream.getTracks()) {
              track.addEventListener("ended", () => {
                if (stream.getTracks().every((candidate) => candidate.readyState === "ended")) {
                  activeMediaStreams.delete(stream);
                }
              }, { once: true });
            }
            return stream;
          });
        });
      });

      protect(() => {
        const geolocation = navigator.geolocation;
        if (!geolocation) return;
        const deniedPosition = (failure) => {
          if (typeof failure === "function") {
            failure({ code: 1, message: "Permission denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
          }
        };
        if (typeof geolocation.getCurrentPosition === "function") {
          const getCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
          replaceMethod(geolocation, "getCurrentPosition", (success, failure, options) => {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            if (window.__boltpocketPageActive === false || !capabilities.location) {
              return deniedPosition(failure);
            }
            const bridge = window.__boltpocketNativeBridgeSettings || {};
            if (bridge.location) {
              requestNative("location-current", {
                options: normalizeLocationOptions(options),
              }).then(
                (position) => {
                  if (typeof success === "function") success(position);
                },
                (error) => {
                  if (typeof failure === "function") failure(geolocationError(error));
                },
              );
              return;
            }
            return getCurrentPosition(success, failure, options);
          });
        }
        if (typeof geolocation.watchPosition === "function") {
          const watchPosition = geolocation.watchPosition.bind(geolocation);
          replaceMethod(geolocation, "watchPosition", (success, failure, options) => {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            if (window.__boltpocketPageActive === false || !capabilities.location) {
              deniedPosition(failure);
              return 0;
            }
            const bridge = window.__boltpocketNativeBridgeSettings || {};
            if (bridge.location) {
              locationWatchSequence = (locationWatchSequence % 2147483646) + 1;
              const watchId = locationWatchSequence;
              locationWatches.set(watchId, { success, failure });
              requestNative("location-watch-start", {
                watchId,
                options: normalizeLocationOptions(options),
              }).catch((error) => {
                const watch = locationWatches.get(watchId);
                if (!watch) return;
                locationWatches.delete(watchId);
                if (typeof watch.failure === "function") {
                  watch.failure(geolocationError(error));
                }
              });
              return watchId;
            }
            return watchPosition(success, failure, options);
          });
        }
        if (typeof geolocation.clearWatch === "function") {
          const clearWatch = geolocation.clearWatch.bind(geolocation);
          replaceMethod(geolocation, "clearWatch", (watchId) => {
            const bridge = window.__boltpocketNativeBridgeSettings || {};
            if (!bridge.location) return clearWatch(watchId);
            if (!Number.isInteger(watchId) || watchId < 1) return;
            locationWatches.delete(watchId);
            requestNative("location-watch-stop", { watchId }, 15000).catch(() => {});
          });
        }
      });

      protect(() => {
        const clipboard = navigator.clipboard;
        if (clipboard) {
          for (const name of ["read", "readText"]) {
            const read = clipboard[name];
            if (typeof read !== "function") continue;
            const bound = read.bind(clipboard);
            replaceMethod(clipboard, name, (...args) => {
              const capabilities = window.__boltpocketNativeCapabilities || {};
              if (!capabilities.clipboardRead) return denied();
              const bridge = window.__boltpocketNativeBridgeSettings || {};
              if (name === "readText" && bridge.clipboardText) {
                return hasTransientUserActivation()
                  ? requestNative("clipboard-read-text", {}, 15000)
                  : denied();
              }
              return authorizeCapability("clipboardRead").then(() => bound(...args));
            });
          }
          for (const name of ["write", "writeText"]) {
            const write = clipboard[name];
            if (typeof write !== "function") continue;
            const bound = write.bind(clipboard);
            replaceMethod(clipboard, name, (...args) => {
              const capabilities = window.__boltpocketNativeCapabilities || {};
              if (!capabilities.clipboardWrite) return denied();
              const bridge = window.__boltpocketNativeBridgeSettings || {};
              if (name === "writeText" && bridge.clipboardText) {
                const text = args[0];
                if (typeof text !== "string" || text.length > 16000) {
                  return Promise.reject(nativeError({
                    name: "DataError",
                    message: "Clipboard text is too large for this page.",
                  }));
                }
                return hasTransientUserActivation()
                  ? requestNative("clipboard-write-text", { text }, 15000).then(() => undefined)
                  : denied();
              }
              return authorizeCapability("clipboardWrite").then(() => bound(...args));
            });
          }
        }
        if (typeof document.execCommand !== "function") return;
        const execCommand = document.execCommand.bind(document);
        replaceMethod(document, "execCommand", (command, ...args) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          const bridge = window.__boltpocketNativeBridgeSettings || {};
          const normalized = String(command || "").toLowerCase();
          if (normalized === "paste" && !capabilities.clipboardRead) return false;
          if ((normalized === "copy" || normalized === "cut") && !capabilities.clipboardWrite) return false;
          // Legacy synchronous clipboard commands cannot wait for the host's
          // content-bound consent. Project mini apps must use the asynchronous
          // Clipboard API, which is brokered per operation.
          if (bridge.capabilityConsent && ["copy", "cut", "paste"].includes(normalized)) return false;
          return execCommand(command, ...args);
        });
      });

      protect(() => {
        const motionEventNames = new Set([
          "devicemotion",
          "deviceorientation",
          "deviceorientationabsolute",
        ]);
        const addEventListener = window.addEventListener.bind(window);
        const blocker = (event) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (capabilities.motionSensors && window.__boltpocketMotionConsentActive === true) return;
          event.stopImmediatePropagation();
        };
        for (const name of motionEventNames) {
          addEventListener(name, blocker, true);
        }
        replaceMethod(window, "addEventListener", (name, listener, options) => {
          if (!motionEventNames.has(name) || listener === blocker) {
            return addEventListener(name, listener, options);
          }
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (!capabilities.motionSensors) return;
          void authorizeCapability("motionSensors").then(() => {
            window.__boltpocketMotionConsentActive = true;
            addEventListener(name, listener, options);
          }).catch(() => {});
        });
        for (const constructorName of ["DeviceMotionEvent", "DeviceOrientationEvent"]) {
          const constructor = window[constructorName];
          if (!constructor || typeof constructor.requestPermission !== "function") continue;
          const requestPermission = constructor.requestPermission.bind(constructor);
          replaceMethod(constructor, "requestPermission", (...args) => {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            return capabilities.motionSensors
              ? authorizeCapability("motionSensors").then(() => {
                  window.__boltpocketMotionConsentActive = true;
                  return requestPermission(...args);
                })
              : denied();
          });
        }
      });

      protect(() => {
        if (typeof navigator.vibrate !== "function") return;
        const vibrate = navigator.vibrate.bind(navigator);
        replaceMethod(navigator, "vibrate", (...args) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (!capabilities.vibration) return false;
          void authorizeCapability("vibration").then(() => vibrate(...args)).catch(() => {});
          return true;
        });
      });

      protect(() => {
        const wakeLock = navigator.wakeLock;
        if (!wakeLock || typeof wakeLock.request !== "function") return;
        const request = wakeLock.request.bind(wakeLock);
        replaceMethod(wakeLock, "request", (...args) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          return capabilities.screenWakeLock
            ? authorizeCapability("screenWakeLock").then(() => request(...args)).then((sentinel) => {
                activeWakeLocks.add(sentinel);
                sentinel.addEventListener?.("release", () => activeWakeLocks.delete(sentinel), { once: true });
                return sentinel;
              })
            : denied();
        });
      });

      protect(() => {
        const fileInput = (target) => {
          if (!(target instanceof Element)) return null;
          const input = target.closest('input[type="file"]');
          if (input) return input;
          const label = target.closest("label");
          return label && label.control instanceof HTMLInputElement && label.control.type === "file"
            ? label.control
            : null;
        };
        if (typeof HTMLInputElement === "undefined") return;
        const click = HTMLInputElement.prototype.click;
        const showPicker = HTMLInputElement.prototype.showPicker;
        const consentBypass = new WeakSet();
        const consentRequired = () =>
          window.__boltpocketNativeBridgeSettings?.capabilityConsent === true;
        const openAfterConsent = (input, method) => {
          void authorizeCapability("fileSelection")
            .then(() => {
              if (window.__boltpocketPageActive === false) return;
              if (method === click) consentBypass.add(input);
              method.call(input);
            })
            .catch(() => {});
        };
        document.addEventListener("click", (event) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          const input = fileInput(event.target);
          if (!input) return;
          if (!capabilities.fileSelection) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          if (!consentRequired() || consentBypass.has(input)) {
            consentBypass.delete(input);
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.isTrusted !== true || !hasTransientUserActivation()) return;
          openAfterConsent(input, click);
        }, true);
        replaceMethod(HTMLInputElement.prototype, "click", function () {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (this.type === "file" && !capabilities.fileSelection) return;
          if (this.type === "file" && consentRequired()) {
            if (consentBypass.has(this)) {
              consentBypass.delete(this);
              return click.call(this);
            }
            if (!hasTransientUserActivation()) return;
            openAfterConsent(this, click);
            return;
          }
          return click.call(this);
        });
        if (typeof showPicker === "function") {
          replaceMethod(HTMLInputElement.prototype, "showPicker", function () {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            if (this.type === "file" && !capabilities.fileSelection) return;
            if (this.type === "file" && consentRequired()) {
              if (consentBypass.has(this)) {
                consentBypass.delete(this);
                return showPicker.call(this);
              }
              if (!hasTransientUserActivation()) return;
              openAfterConsent(this, showPicker);
              return;
            }
            return showPicker.call(this);
          });
        }
      });

      protect(() => {
        if (typeof window.open !== "function") return;
        const open = window.open.bind(window);
        replaceMethod(window, "open", (...args) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          return capabilities.popups ? open(...args) : null;
        });
      });
      protect(() => {
        const originalShare = typeof navigator.share === "function"
          ? navigator.share.bind(navigator)
          : null;
        const originalCanShare = typeof navigator.canShare === "function"
          ? navigator.canShare.bind(navigator)
          : null;
        const bridge = window.__boltpocketNativeBridgeSettings || {};
        if (!originalShare && !bridge.sharing) return;
        const validShareData = (data) => {
          if (!data || typeof data !== "object") return false;
          if (data.title !== undefined && (typeof data.title !== "string" || data.title.length > 240)) return false;
          if (data.text !== undefined && (typeof data.text !== "string" || data.text.length > 16000)) return false;
          if (data.url !== undefined && (typeof data.url !== "string" || data.url.length > 2048)) return false;
          if (data.files !== undefined) {
            if (!Array.isArray(data.files) || data.files.length !== 1) return false;
            const file = data.files[0];
            if (typeof File === "undefined" || !(file instanceof File) || file.size > 2097152) return false;
            if (data.text || data.url) return false;
          }
          return Boolean(data.text || data.url || (data.files && data.files.length));
        };
        const canShare = (data) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (!capabilities.sharing || !validShareData(data)) return false;
          return originalCanShare ? originalCanShare(data) : bridge.sharing === true;
        };
        const fileAsBase64 = (file) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(nativeError({ name: "DataError", message: "Shared file could not be read." }));
          reader.onload = () => {
            const value = typeof reader.result === "string" ? reader.result : "";
            const comma = value.indexOf(",");
            if (comma < 0) {
              reject(nativeError({ name: "DataError", message: "Shared file could not be read." }));
              return;
            }
            resolve(value.slice(comma + 1));
          };
          reader.readAsDataURL(file);
        });
        const share = async (data) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (!capabilities.sharing) return denied();
          if (!isTopLevel() || !hasTransientUserActivation()) return denied();
          if (!validShareData(data)) {
            return Promise.reject(nativeError({ name: "TypeError", message: "Share data is invalid." }));
          }
          if (originalShare) {
            await authorizeCapability("sharing");
            return originalShare(data);
          }
          let url;
          if (data.url) {
            try { url = new URL(data.url, location.href).href; }
            catch (_) { return Promise.reject(nativeError({ name: "TypeError", message: "Share URL is invalid." })); }
          }
          const file = data.files && data.files[0];
          return requestNative("share", {
            data: {
              ...(data.title ? { title: data.title } : {}),
              ...(data.text ? { text: data.text } : {}),
              ...(url ? { url } : {}),
              ...(file ? {
                file: {
                  name: file.name || "shared-file",
                  type: file.type || "application/octet-stream",
                  dataBase64: await fileAsBase64(file),
                },
              } : {}),
            },
          }, 65000).then(() => undefined);
        };
        replaceMethod(navigator, "share", share);
        replaceMethod(navigator, "canShare", canShare);
      });
      protect(() => {
        if (typeof Element === "undefined") return;
        for (const name of ["requestFullscreen", "webkitRequestFullscreen"]) {
          const enterFullscreen = Element.prototype[name];
          if (typeof enterFullscreen !== "function") continue;
          replaceMethod(Element.prototype, name, function (...args) {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            return capabilities.fullscreenMedia
              ? authorizeCapability("fullscreenMedia").then(() => enterFullscreen.apply(this, args))
              : denied();
          });
        }
      });
      protect(() => {
        if (typeof HTMLVideoElement === "undefined") return;
        const pictureInPicture = HTMLVideoElement.prototype.requestPictureInPicture;
        if (typeof pictureInPicture === "function") {
          replaceMethod(HTMLVideoElement.prototype, "requestPictureInPicture", function (...args) {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            return capabilities.pictureInPicture
              ? authorizeCapability("pictureInPicture").then(() => pictureInPicture.apply(this, args))
              : denied();
          });
        }
        const showPlaybackTarget = HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker;
        if (typeof showPlaybackTarget === "function") {
          replaceMethod(HTMLVideoElement.prototype, "webkitShowPlaybackTargetPicker", function (...args) {
            const capabilities = window.__boltpocketNativeCapabilities || {};
            if (!capabilities.airPlay) return;
            void authorizeCapability("airPlay")
              .then(() => showPlaybackTarget.apply(this, args))
              .catch(() => {});
          });
        }
      });
      protect(() => {
        if (typeof screen === "undefined") return;
        const bridge = window.__boltpocketNativeBridgeSettings || {};
        let orientation = screen.orientation;
        if (!orientation && bridge.screenOrientation) {
          const listeners = new Set();
          orientation = {
            angle: 0,
            onchange: null,
            type: window.innerWidth > window.innerHeight ? "landscape-primary" : "portrait-primary",
            addEventListener(type, listener) {
              if (type === "change" && typeof listener === "function") listeners.add(listener);
            },
            removeEventListener(type, listener) {
              if (type === "change") listeners.delete(listener);
            },
            dispatchEvent(event) {
              if (!event || event.type !== "change") return true;
              for (const listener of [...listeners]) {
                try { listener.call(orientation, event); } catch (_) {}
              }
              if (typeof orientation.onchange === "function") {
                try { orientation.onchange.call(orientation, event); } catch (_) {}
              }
              return !event.defaultPrevented;
            },
          };
          try {
            Object.defineProperty(screen, "orientation", {
              configurable: true,
              value: orientation,
            });
          } catch (_) { return; }
        }
        if (!orientation) return;
        const originalLock = typeof orientation.lock === "function"
          ? orientation.lock.bind(orientation)
          : null;
        const originalUnlock = typeof orientation.unlock === "function"
          ? orientation.unlock.bind(orientation)
          : null;
        const supportedLocks = new Set([
          "any", "natural", "landscape", "portrait",
          "portrait-primary", "portrait-secondary",
          "landscape-primary", "landscape-secondary",
        ]);
        const updateFallback = (lock) => {
          if (originalLock || !orientation) return;
          const next = lock && lock.startsWith("landscape")
            ? (lock === "landscape-secondary" ? "landscape-secondary" : "landscape-primary")
            : (lock === "portrait-secondary" ? "portrait-secondary" : "portrait-primary");
          orientation.type = next;
          orientation.angle = next === "landscape-primary" ? 90 : next === "landscape-secondary" ? 270 : 0;
          const event = typeof Event === "function" ? new Event("change") : { type: "change" };
          orientation.dispatchEvent?.(event);
        };
        replaceMethod(orientation, "lock", (lock) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (!capabilities.screenOrientation || !supportedLocks.has(lock)) return denied();
          if (!hasTransientUserActivation()) return denied();
          if (originalLock) {
            return authorizeCapability("screenOrientation").then(() => originalLock(lock));
          }
          if (!bridge.screenOrientation) {
            return Promise.reject(nativeError({ name: "NotSupportedError", message: "Screen orientation is unavailable." }));
          }
          return requestNative("orientation-lock", { lock }, 15000).then(() => updateFallback(lock));
        });
        replaceMethod(orientation, "unlock", () => {
          if (originalUnlock) return originalUnlock();
          if (!bridge.screenOrientation) return;
          void requestNative("orientation-unlock", {}, 15000).then(
            () => updateFallback(window.innerWidth > window.innerHeight ? "landscape" : "portrait"),
            () => undefined,
          );
        });
      });
      protect(() => {
        const bridge = window.__boltpocketNativeBridgeSettings || {};
        if (!bridge.printing) return;
        const doctypeText = () => {
          const value = document.doctype;
          return value ? "<!DOCTYPE " + value.name + ">" : "<!doctype html>";
        };
        const printableHtml = () => {
          const root = document.documentElement?.outerHTML || "";
          const escapedBase = String(location.href)
            .replace(/&/gu, "&amp;")
            .replace(/</gu, "&lt;")
            .replace(/>/gu, "&gt;")
            .replace(/"/gu, "&quot;");
          const withBase = /<head(?:\s[^>]*)?>/iu.test(root)
            ? root.replace(/<head(\s[^>]*)?>/iu, (match) => match + '<base href="' + escapedBase + '">')
            : root;
          return doctypeText() + withBase;
        };
        replaceMethod(window, "print", () => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          if (!capabilities.printing || !isTopLevel() || !hasTransientUserActivation()) return;
          try { window.dispatchEvent(new Event("beforeprint")); } catch (_) {}
          let html;
          try { html = printableHtml(); } catch (_) { html = ""; }
          if (!html || html.length > 512000) {
            try { window.dispatchEvent(new Event("afterprint")); } catch (_) {}
            return;
          }
          void requestNative("print-html", { html }, 65000).finally(() => {
            try { window.dispatchEvent(new Event("afterprint")); } catch (_) {}
          });
        });
      });
      protect(() => {
        const bridge = window.__boltpocketNativeBridgeSettings || {};
        const supportedFormats = Array.isArray(bridge.barcodeFormats)
          ? [...bridge.barcodeFormats]
          : [];
        const NativeBarcodeDetector = window.BarcodeDetector;
        if (supportedFormats.length === 0 && typeof NativeBarcodeDetector === "function") {
          const detect = NativeBarcodeDetector.prototype?.detect;
          if (typeof detect === "function") {
            replaceMethod(NativeBarcodeDetector.prototype, "detect", function (...args) {
              const current = window.__boltpocketNativeCapabilities || {};
              return current.barcodeDetection
                ? authorizeCapability("barcodeDetection").then(() => detect.apply(this, args))
                : denied();
            });
          }
          return;
        }
        if (supportedFormats.length === 0) return;
        const imageForBlob = async (blob) => {
          if (typeof createImageBitmap === "function") return createImageBitmap(blob);
          return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => {
              URL.revokeObjectURL(url);
              resolve(image);
            };
            image.onerror = () => {
              URL.revokeObjectURL(url);
              reject(nativeError({ name: "InvalidStateError", message: "Image could not be decoded." }));
            };
            image.src = url;
          });
        };
        const dimensions = (source) => {
          if (typeof ImageData !== "undefined" && source instanceof ImageData) {
            return { width: source.width, height: source.height };
          }
          return {
            width: Number(source.videoWidth || source.naturalWidth || source.width || 0),
            height: Number(source.videoHeight || source.naturalHeight || source.height || 0),
          };
        };
        const imageDataUrl = async (source) => {
          if (!source) throw nativeError({ name: "TypeError", message: "Barcode source is required." });
          let drawable = source;
          let closeDrawable = false;
          if (typeof Blob !== "undefined" && source instanceof Blob) {
            drawable = await imageForBlob(source);
            closeDrawable = drawable !== source && typeof drawable.close === "function";
          }
          const size = dimensions(drawable);
          if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1) {
            if (closeDrawable) drawable.close();
            throw nativeError({ name: "InvalidStateError", message: "Barcode source has no image data." });
          }
          const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(size.width * scale));
          canvas.height = Math.max(1, Math.round(size.height * scale));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw nativeError({ name: "NotSupportedError", message: "Canvas is unavailable." });
          if (typeof ImageData !== "undefined" && drawable instanceof ImageData) {
            const sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = drawable.width;
            sourceCanvas.height = drawable.height;
            sourceCanvas.getContext("2d")?.putImageData(drawable, 0, 0);
            context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
          } else {
            context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
          }
          if (closeDrawable) drawable.close();
          const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
          if (dataUrl.length > 2100000) {
            throw nativeError({ name: "DataError", message: "Barcode image is too large." });
          }
          return dataUrl;
        };
        class BarcodeDetectorFallback {
          static getSupportedFormats() {
            return Promise.resolve([...supportedFormats]);
          }
          constructor(options = {}) {
            const formats = options.formats === undefined ? supportedFormats : options.formats;
            if (!Array.isArray(formats) || formats.length < 1 || new Set(formats).size !== formats.length) {
              throw nativeError({ name: "TypeError", message: "Barcode formats are invalid." });
            }
            if (formats.some((format) => !supportedFormats.includes(format))) {
              throw nativeError({ name: "NotSupportedError", message: "Barcode format is unavailable." });
            }
            this.formats = [...formats];
          }
          async detect(source) {
            const current = window.__boltpocketNativeCapabilities || {};
            if (!current.barcodeDetection) return denied();
            const dataUrl = await imageDataUrl(source);
            return requestNative("barcode-detect", {
              dataUrl,
              formats: this.formats,
            }, 65000);
          }
        }
        try {
          Object.defineProperty(window, "BarcodeDetector", {
            configurable: true,
            value: BarcodeDetectorFallback,
            writable: true,
          });
        } catch (_) {}
      });
      protect(() => {
        if (typeof navigator.requestMediaKeySystemAccess !== "function") return;
        const requestMediaKeySystemAccess = navigator.requestMediaKeySystemAccess.bind(navigator);
        replaceMethod(navigator, "requestMediaKeySystemAccess", (...args) => {
          const capabilities = window.__boltpocketNativeCapabilities || {};
          return capabilities.protectedMedia
            ? authorizeCapability("protectedMedia").then(() => requestMediaKeySystemAccess(...args))
            : denied();
        });
      });
    })();
    true;
  `;
}
