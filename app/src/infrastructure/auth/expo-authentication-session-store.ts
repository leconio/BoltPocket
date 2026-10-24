import * as SecureStore from "expo-secure-store";

import type {
  AuthenticatedAdminRole,
  AuthenticatedProfile,
} from "@/application/ports/authentication";
import type { DistributionRegion } from "@/config/distribution";
import {
  AuthenticationError,
  type AuthenticationSessionStore,
  type StoredAuthenticationSession,
} from "@/infrastructure/auth/casdoor-authentication";

const SESSION_KEY = "boltpocket.authentication.session.v1";
const SUBJECT_KEY = "boltpocket.authentication.bound-subject.v1";
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class ExpoAuthenticationSessionStore implements AuthenticationSessionStore {
  readonly #sessionKey: string;
  readonly #subjectKey: string;

  constructor(region: DistributionRegion = "global") {
    // Preserve existing global sessions while strictly isolating Mainland
    // credentials from the global Casdoor deployment.
    this.#sessionKey =
      region === "global" ? SESSION_KEY : `${SESSION_KEY}.${region}`;
    this.#subjectKey =
      region === "global" ? SUBJECT_KEY : `${SUBJECT_KEY}.${region}`;
  }

  async load(): Promise<StoredAuthenticationSession | null> {
    const value = await SecureStore.getItemAsync(
      this.#sessionKey,
      secureStoreOptions,
    );
    if (!value) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      await this.clear();
      return null;
    }
    if (!isStoredSession(parsed)) {
      await this.clear();
      return null;
    }
    // Sessions written before Casdoor role projection did not contain
    // `adminRole`; preserve them as ordinary users until profile refresh.
    return {
      ...parsed,
      profile: {
        ...parsed.profile,
        adminRole: parsed.profile.adminRole ?? null,
      },
    };
  }

  async save(session: StoredAuthenticationSession): Promise<void> {
    await SecureStore.setItemAsync(
      this.#sessionKey,
      JSON.stringify(session),
      secureStoreOptions,
    );
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(this.#sessionKey, secureStoreOptions);
  }

  async assertSubjectAllowed(subject: string): Promise<void> {
    const boundSubject = await SecureStore.getItemAsync(
      this.#subjectKey,
      secureStoreOptions,
    );
    if (boundSubject && boundSubject !== subject) {
      throw new AuthenticationError("account_mismatch");
    }
    if (!boundSubject) {
      await SecureStore.setItemAsync(
        this.#subjectKey,
        subject,
        secureStoreOptions,
      );
    }
  }
}

function isStoredSession(value: unknown): value is StoredAuthenticationSession {
  if (!isRecord(value) || value.version !== 1) return false;
  return (
    token(value.accessToken) &&
    (value.refreshToken === "" || token(value.refreshToken)) &&
    typeof value.accessExpiresAt === "number" &&
    Number.isSafeInteger(value.accessExpiresAt) &&
    isProfile(value.profile)
  );
}

function isProfile(value: unknown): value is AuthenticatedProfile {
  return (
    isRecord(value) &&
    stringBetween(value.subject, 1, 200) &&
    stringBetween(value.username, 1, 255) &&
    stringBetween(value.displayName, 1, 255) &&
    (value.avatarUrl === null || stringBetween(value.avatarUrl, 1, 2_048)) &&
    (value.email === null || stringBetween(value.email, 3, 320)) &&
    (value.adminRole === undefined || isAuthenticatedAdminRole(value.adminRole))
  );
}

function isAuthenticatedAdminRole(
  value: unknown,
): value is AuthenticatedAdminRole {
  return value === "viewer" || value === "reviewer" || value === "admin";
}

function token(value: unknown): value is string {
  return stringBetween(value, 16, 16 * 1024);
}

function stringBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
