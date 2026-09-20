import { useSyncExternalStore } from "react";
import { authEnabled } from "./client";
import { readLocalSession, subscribeLocalSession, type LocalSession } from "./local-credentials";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
};

/**
 * Stable fallback user when auth is disabled (`VITE_AUTH_ENABLED=false`).
 */
export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
};

export type CurrentUserState = {
  user: AppUser | null;
  isPending: boolean;
};

/** Cached so useSyncExternalStore getSnapshot is referentially stable. */
let cachedSession: LocalSession | null | undefined;
let cachedUser: AppUser | null = null;

function localSessionToUser(): AppUser | null {
  const session = readLocalSession();
  if (session === cachedSession) return cachedUser;
  if (
    session &&
    cachedSession &&
    session.userId === cachedSession.userId &&
    session.displayName === cachedSession.displayName &&
    session.signedInAt === cachedSession.signedInAt
  ) {
    return cachedUser;
  }
  cachedSession = session;
  if (!session) {
    cachedUser = null;
    return null;
  }
  cachedUser = {
    id: session.userId,
    displayName: session.displayName,
    primaryEmail: null,
    profileImageUrl: null,
    isDevFallback: false,
  };
  return cachedUser;
}

/**
 * When auth is enabled, uses local User ID + password session (sessionStorage).
 * When auth is disabled, returns the dev user.
 *
 * Always calls the same hooks (no conditional returns before hooks).
 */
export function useCurrentUserState(): CurrentUserState {
  const sessionUser = useSyncExternalStore(
    subscribeLocalSession,
    localSessionToUser,
    () => null,
  );

  if (!authEnabled) return { user: DEV_USER, isPending: false };
  return { user: sessionUser, isPending: false };
}

export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
