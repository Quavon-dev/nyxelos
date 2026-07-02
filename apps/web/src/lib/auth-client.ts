"use client";

import { createAuthClient } from "better-auth/react";
import { getServerUrl } from "./server-url";

/** Points at the same Nyxel server the tRPC client talks to (lib/server-url.ts) —
 * whichever server the browser is configured for gets both API calls and
 * session cookies. */
export const authClient = createAuthClient({
  baseURL: getServerUrl(),
});

export const { useSession, signIn, signOut } = authClient;
