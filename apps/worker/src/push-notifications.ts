import webPush, { type PushSubscription } from "web-push";
import {
  notificationTriggerCandidateCanDispatch,
  notificationSubscriptionMatchesCandidate,
  type NotificationTriggerCandidate,
} from "@nytt/shared";
import type { PushDeliveryTarget, WorkerRepository } from "./repository.js";

interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushDeliveryMetrics {
  configured: boolean;
  candidates: number;
  subscriptions: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

export function loadWebPushConfig(env: NodeJS.ProcessEnv = process.env): WebPushConfig | undefined {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = env.WEB_PUSH_SUBJECT?.trim() || "mailto:admin@nytt-trondheim.local";
  if (!publicKey || !privateKey) return undefined;
  return { publicKey, privateKey, subject };
}

function targetUrl(candidate: NotificationTriggerCandidate): string {
  return candidate.links[0]?.href ?? "/";
}

function pushPayload(candidate: NotificationTriggerCandidate) {
  return {
    title: candidate.title,
    body: candidate.body,
    tag: candidate.id,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: {
      triggerId: candidate.id,
      severity: candidate.severity,
      kind: candidate.kind,
      url: targetUrl(candidate),
    },
  };
}

function disabledSubscriptionStatusCode(error: unknown): boolean {
  const statusCode =
    typeof error === "object" && error && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : undefined;
  return statusCode === 404 || statusCode === 410;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function canDeliverToSubscription(
  candidate: NotificationTriggerCandidate,
  subscription: PushDeliveryTarget,
) {
  const publicSurfaceState = candidate.publicSurface?.state;
  if (publicSurfaceState && publicSurfaceState !== "visible" && subscription.role !== "owner") {
    return false;
  }
  if (!publicSurfaceState && subscription.role !== "owner") return false;
  return notificationSubscriptionMatchesCandidate(subscription, candidate);
}

export async function deliverPushNotifications(
  candidates: NotificationTriggerCandidate[],
  repository: Pick<
    WorkerRepository,
    | "activePushSubscriptions"
    | "claimPushDelivery"
    | "markPushDeliverySent"
    | "markPushDeliveryFailed"
  >,
  config = loadWebPushConfig(),
): Promise<PushDeliveryMetrics> {
  const metrics: PushDeliveryMetrics = {
    configured: Boolean(config),
    candidates: candidates.length,
    subscriptions: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  if (!config || candidates.length === 0) {
    metrics.skipped = candidates.length;
    return metrics;
  }

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const subscriptions = await repository.activePushSubscriptions();
  metrics.subscriptions = subscriptions.length;
  if (subscriptions.length === 0) {
    metrics.skipped = candidates.length;
    return metrics;
  }

  for (const candidate of candidates) {
    if (!notificationTriggerCandidateCanDispatch(candidate)) {
      metrics.skipped += subscriptions.length;
      continue;
    }
    for (const subscription of subscriptions) {
      if (!canDeliverToSubscription(candidate, subscription)) {
        metrics.skipped += 1;
        continue;
      }
      const claim = await repository.claimPushDelivery(candidate, subscription);
      if (!claim) {
        metrics.skipped += 1;
        continue;
      }
      metrics.claimed += 1;
      try {
        const pushSubscription: PushSubscription = {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        };
        await webPush.sendNotification(pushSubscription, JSON.stringify(pushPayload(candidate)), {
          TTL: 10 * 60,
          urgency: candidate.severity === "critical" ? "high" : "normal",
        });
        await repository.markPushDeliverySent(claim.id, subscription.id);
        metrics.sent += 1;
      } catch (error) {
        await repository.markPushDeliveryFailed(
          claim.id,
          subscription.id,
          errorMessage(error),
          disabledSubscriptionStatusCode(error),
        );
        metrics.failed += 1;
      }
    }
  }
  return metrics;
}
