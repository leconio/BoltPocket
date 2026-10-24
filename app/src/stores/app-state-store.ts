import type { AppState } from "@/domain/app-state";
import { initialAppState } from "@/domain/app-state";
import { createStore, type StoreApi } from "zustand/vanilla";

export type AppStateStore = StoreApi<AppState>;

export function createAppStateStore(
  initialState: AppState = initialAppState,
): AppStateStore {
  return createStore<AppState>()(() => initialState);
}

export function replaceAppState(store: AppStateStore, nextState: AppState) {
  if (Object.is(store.getState(), nextState)) return false;
  store.setState(nextState, true);
  return true;
}

export function createAppStateFieldsSelector<
  const Keys extends readonly (keyof AppState)[],
>(...keys: Keys) {
  type Selection = Pick<AppState, Keys[number]>;
  let selection: Selection | undefined;

  return (state: AppState): Selection => {
    const current = selection;
    if (
      current &&
      keys.every((key) => Object.is(current[key as Keys[number]], state[key]))
    ) {
      return current;
    }
    selection = Object.fromEntries(
      keys.map((key) => [key, state[key]]),
    ) as Selection;
    return selection;
  };
}

/**
 * Adapts a Zustand vanilla store to React's snapshot contract while retaining
 * the last selector result when its values are equal. This lets compound
 * selectors use repository-owned equality without publishing whole AppState
 * snapshots through Context.
 */
export function createAppStateSelection<Selection>(
  store: AppStateStore,
  selector: (state: AppState) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean,
) {
  let initialized = false;
  let selection: Selection;

  return {
    subscribe: store.subscribe,
    getSnapshot() {
      const next = selector(store.getState());
      if (!initialized || !isEqual(selection, next)) {
        initialized = true;
        selection = next;
      }
      return selection;
    },
  };
}
