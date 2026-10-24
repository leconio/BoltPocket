import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { AuthenticatedProfile } from "@/application/ports/authentication";
import {
  type AuthenticationErrorCode,
  isAuthenticationError,
} from "@/infrastructure/auth/casdoor-authentication";
import { useRuntimeServices } from "@/providers/runtime-services-provider";

export type AuthenticationStatus = "loading" | "signed-in" | "signed-out";

export type AuthenticationState = Readonly<{
  status: AuthenticationStatus;
  profile: AuthenticatedProfile | null;
  initializationError: AuthenticationErrorCode | null;
}>;

type AuthenticationActions = Readonly<{
  signIn(): Promise<AuthenticatedProfile | null>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  refreshProfile(): Promise<void>;
}>;

const AuthenticationStoreContext =
  createContext<StoreApi<AuthenticationState> | null>(null);
const AuthenticationActionsContext =
  createContext<AuthenticationActions | null>(null);

function createAuthenticationStore() {
  return createStore<AuthenticationState>()(() => ({
    status: "loading",
    profile: null,
    initializationError: null,
  }));
}

export function AuthenticationProvider({ children }: PropsWithChildren) {
  const { accountDeletion, authentication: service } = useRuntimeServices();
  const [store] = useState(createAuthenticationStore);

  useEffect(() => {
    let active = true;
    const stopSessionExpiryListener = service.onSessionExpired(() => {
      if (!active) return;
      store.setState({
        profile: null,
        status: "signed-out",
        initializationError: "session_expired",
      });
    });
    void service.restore().then(
      (restored) => {
        if (!active) return;
        store.setState({
          profile: restored,
          status: restored ? "signed-in" : "signed-out",
          initializationError: null,
        });
      },
      (error: unknown) => {
        if (!active) return;
        store.setState({
          profile: null,
          status: "signed-out",
          initializationError: isAuthenticationError(error)
            ? error.code
            : "server",
        });
      },
    );
    return () => {
      active = false;
      stopSessionExpiryListener();
    };
  }, [service, store]);

  const signIn = useCallback(async () => {
    const signedIn = await service.signIn();
    if (!signedIn) return null;
    store.setState({
      profile: signedIn,
      status: "signed-in",
      initializationError: null,
    });
    return signedIn;
  }, [service, store]);

  const signOut = useCallback(async () => {
    await service.signOut();
    store.setState({
      profile: null,
      status: "signed-out",
      initializationError: null,
    });
  }, [service, store]);

  const refreshProfile = useCallback(async () => {
    const refreshed = await service.refreshProfile();
    store.setState({ profile: refreshed });
  }, [service, store]);

  const deleteAccount = useCallback(async () => {
    await accountDeletion.deleteAccount();
    store.setState({
      profile: null,
      status: "signed-out",
      initializationError: null,
    });
  }, [accountDeletion, store]);

  const actions = useMemo<AuthenticationActions>(
    () => ({
      signIn,
      signOut,
      deleteAccount,
      refreshProfile,
    }),
    [deleteAccount, refreshProfile, signIn, signOut],
  );

  return (
    <AuthenticationActionsContext.Provider value={actions}>
      <AuthenticationStoreContext.Provider value={store}>
        {children}
      </AuthenticationStoreContext.Provider>
    </AuthenticationActionsContext.Provider>
  );
}

export function useAuthenticationState<Selection>(
  selector: (state: AuthenticationState) => Selection,
) {
  const store = useContext(AuthenticationStoreContext);
  if (!store) {
    throw new Error(
      "useAuthenticationState must be used inside AuthenticationProvider",
    );
  }
  return useStore(store, selector);
}

export function useAuthenticationActions() {
  const actions = useContext(AuthenticationActionsContext);
  if (!actions) {
    throw new Error(
      "useAuthenticationActions must be used inside AuthenticationProvider",
    );
  }
  return actions;
}
