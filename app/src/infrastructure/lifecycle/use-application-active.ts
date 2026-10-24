import { useSyncExternalStore } from "react";
import { AppState, type NativeEventSubscription } from "react-native";

let applicationActive = AppState.currentState === "active";
let nativeSubscription: NativeEventSubscription | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!nativeSubscription) {
    applicationActive = AppState.currentState === "active";
    nativeSubscription = AppState.addEventListener("change", (nextState) => {
      const nextActive = nextState === "active";
      if (applicationActive === nextActive) return;
      applicationActive = nextActive;
      for (const currentListener of listeners) currentListener();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size !== 0) return;
    nativeSubscription?.remove();
    nativeSubscription = null;
  };
}

function getSnapshot() {
  return applicationActive;
}

/** Shares one native AppState listener across every lightweight consumer. */
export function useApplicationActive() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
