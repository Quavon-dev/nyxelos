import { getDb } from "@nyxel/db";
import webpush from "web-push";

/** Web Push (VAPID) — lets the server notify a user's installed PWA (phone
 * or desktop) even when the tab/app is closed. Falls back to a
 * process-lifetime key pair when VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY aren't
 * set, so it works out of the box in dev — but every restart invalidates
 * existing subscriptions, so production installs should set both env vars
 * to the same generated pair (see the console warning below). */
function loadVapidKeys(): { publicKey: string; privateKey: string } {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate };
  }
  const generated = webpush.generateVAPIDKeys();
  console.warn(
    "[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — generated a temporary key pair for this " +
      "process. Push subscriptions will break on restart. Set these env vars to persist:\n" +
      `VAPID_PUBLIC_KEY=${generated.publicKey}\nVAPID_PRIVATE_KEY=${generated.privateKey}`,
  );
  return generated;
}

const vapidKeys = loadVapidKeys();

webpush.setVapidDetails(
  process.env.VAPID_CONTACT_EMAIL ?? "mailto:admin@nyxel.local",
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

export type PushPayload = {
  title: string;
  body: string;
  /** App-relative path to open/focus when the notification is clicked. */
  url?: string;
  tag?: string;
};

/** Sends a push notification to every device a user has subscribed from.
 * Silently drops subscriptions the push service reports as gone (404/410)
 * instead of retrying — those endpoints are dead until the device
 * resubscribes. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const db = getDb();
  const subscriptions = await db.listPushSubscriptionsByUser(userId);
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.deletePushSubscriptionByEndpoint(sub.endpoint);
        } else {
          console.error(`[push] failed to notify ${sub.endpoint}:`, error);
        }
      }
    }),
  );
}

/** Notifies the owner of a workspace — the one user every self-hosted
 * workspace belongs to (see workspace.userId). */
export async function notifyWorkspaceOwner(
  workspaceId: string,
  payload: PushPayload,
): Promise<void> {
  const workspace = await getDb().getWorkspace(workspaceId);
  if (!workspace) return;
  await sendPushToUser(workspace.userId, payload);
}
