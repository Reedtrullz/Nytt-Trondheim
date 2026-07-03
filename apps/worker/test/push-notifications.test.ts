import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NotificationTriggerCandidate } from "@nytt/shared";
import { deliverPushNotifications, loadWebPushConfig } from "../src/push-notifications.js";

const webPushMock = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: webPushMock,
  setVapidDetails: webPushMock.setVapidDetails,
  sendNotification: webPushMock.sendNotification,
}));

const candidate: NotificationTriggerCandidate = {
  id: "notification:situation:road-one",
  kind: "traffic_disruption",
  severity: "critical",
  deliveryState: "candidate_only",
  title: "Steinsprang, vegen er stengt",
  body: "Gangåsvegen: Vegen er stengt.",
  detail: "Kandidat for systemvarsel.",
  score: 0.91,
  confidence: {
    level: "confirmed",
    score: 0.91,
    sourceCount: 2,
    updatedAt: "2026-07-02T09:45:00.000Z",
  },
  generatedAt: "2026-07-02T09:45:00.000Z",
  eventUpdatedAt: "2026-07-02T09:40:00.000Z",
  situationId: "road-one",
  articleIds: ["article-one"],
  sourceIds: ["datex", "adressa"],
  sourceLabels: ["Vegvesen DATEX", "Adresseavisen"],
  matchedKeywords: ["stengt"],
  reasons: ["Har offentlig kildegrunnlag."],
  links: [
    {
      kind: "situation",
      label: "Åpne situasjon",
      href: "/situasjoner/road-one",
      situationId: "road-one",
    },
  ],
  publicSurface: {
    state: "visible",
    label: "Synlig på Bypuls",
    detail: "Sjekk rute nå · Oppdatert nå",
    reason: "Samme offentlige varselregel treffer City Pulse-datasettet.",
  },
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    activePushSubscriptions: vi.fn().mockResolvedValue([
      {
        id: "subscription-one",
        userId: "viewer-one",
        role: "viewer",
        endpoint: "https://push.example.test/send/secret",
        keys: {
          p256dh: "p256dh-key-material-that-is-long-enough",
          auth: "auth-key-long-enough",
        },
        minSeverity: "warning",
        kinds: [],
      },
    ]),
    claimPushDelivery: vi.fn().mockResolvedValue({ id: "claim-one" }),
    markPushDeliverySent: vi.fn().mockResolvedValue(undefined),
    markPushDeliveryFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("push notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps delivery disabled when VAPID keys are missing", async () => {
    const repo = repository();

    const metrics = await deliverPushNotifications([candidate], repo, undefined);

    expect(metrics).toMatchObject({ configured: false, sent: 0, skipped: 1 });
    expect(repo.activePushSubscriptions).not.toHaveBeenCalled();
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("claims and sends matching critical candidates once", async () => {
    const repo = repository();

    const metrics = await deliverPushNotifications([candidate], repo, {
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:test@example.test",
    });

    expect(metrics).toMatchObject({
      configured: true,
      candidates: 1,
      subscriptions: 1,
      claimed: 1,
      sent: 1,
      failed: 0,
    });
    expect(webPushMock.setVapidDetails).toHaveBeenCalledWith(
      "mailto:test@example.test",
      "public-key",
      "private-key",
    );
    expect(webPushMock.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example.test/send/secret" }),
      expect.stringContaining("Steinsprang"),
      expect.objectContaining({ TTL: 600, urgency: "high" }),
    );
    expect(repo.claimPushDelivery).toHaveBeenCalledWith(
      candidate,
      expect.objectContaining({ id: "subscription-one" }),
    );
    expect(repo.markPushDeliverySent).toHaveBeenCalledWith("claim-one", "subscription-one");
  });

  it("does not send when the idempotent delivery claim already exists", async () => {
    const repo = repository({ claimPushDelivery: vi.fn().mockResolvedValue(undefined) });

    const metrics = await deliverPushNotifications([candidate], repo, {
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:test@example.test",
    });

    expect(metrics).toMatchObject({ claimed: 0, sent: 0, skipped: 1 });
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("does not claim deliveries for subscriptions that filter out the candidate kind", async () => {
    const repo = repository({
      activePushSubscriptions: vi.fn().mockResolvedValue([
        {
          id: "subscription-one",
          userId: "viewer-one",
          role: "viewer",
          endpoint: "https://push.example.test/send/secret",
          keys: {
            p256dh: "p256dh-key-material-that-is-long-enough",
            auth: "auth-key-long-enough",
          },
          minSeverity: "watch",
          kinds: ["weather_hazard"],
        },
      ]),
    });

    const metrics = await deliverPushNotifications([candidate], repo, {
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:test@example.test",
    });

    expect(metrics).toMatchObject({ claimed: 0, sent: 0, skipped: 1 });
    expect(repo.claimPushDelivery).not.toHaveBeenCalled();
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("does not claim or send watch candidates below the high-impact dispatch floor", async () => {
    const repo = repository({
      activePushSubscriptions: vi.fn().mockResolvedValue([
        {
          id: "subscription-one",
          userId: "viewer-one",
          role: "viewer",
          endpoint: "https://push.example.test/send/secret",
          keys: {
            p256dh: "p256dh-key-material-that-is-long-enough",
            auth: "auth-key-long-enough",
          },
          minSeverity: "watch",
          kinds: [],
        },
      ]),
    });
    const watchCandidate: NotificationTriggerCandidate = {
      ...candidate,
      id: "notification:situation:watch-one",
      severity: "watch",
      score: 0.6,
      confidence: {
        level: "uncertain",
        score: 0.6,
        sourceCount: 1,
        updatedAt: "2026-07-02T09:45:00.000Z",
      },
    };

    const metrics = await deliverPushNotifications([watchCandidate], repo, {
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:test@example.test",
    });

    expect(metrics).toMatchObject({ claimed: 0, sent: 0, skipped: 1 });
    expect(repo.claimPushDelivery).not.toHaveBeenCalled();
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("keeps command-center-only candidates away from viewer subscriptions", async () => {
    const commandCenterCandidate: NotificationTriggerCandidate = {
      ...candidate,
      id: "notification:spatial:delay-one",
      publicSurface: {
        state: "hidden",
        label: "Kun Command Center",
        detail: "Dette er et romlig operatørsignal og vises ikke direkte på City Pulse.",
        reason:
          "Telemetriavvik krever manuell kontroll mot trafikkart, nyheter og offisielle hendelser før offentlig varsel.",
      },
    };
    const repo = repository({
      activePushSubscriptions: vi.fn().mockResolvedValue([
        {
          id: "subscription-viewer",
          userId: "viewer-one",
          role: "viewer",
          endpoint: "https://push.example.test/send/viewer",
          keys: {
            p256dh: "p256dh-key-material-that-is-long-enough",
            auth: "auth-key-long-enough",
          },
          minSeverity: "warning",
          kinds: [],
        },
        {
          id: "subscription-owner",
          userId: "owner-one",
          role: "owner",
          endpoint: "https://push.example.test/send/owner",
          keys: {
            p256dh: "p256dh-key-material-that-is-long-enough",
            auth: "auth-key-long-enough",
          },
          minSeverity: "warning",
          kinds: [],
        },
      ]),
    });

    const metrics = await deliverPushNotifications([commandCenterCandidate], repo, {
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:test@example.test",
    });

    expect(metrics).toMatchObject({ subscriptions: 2, claimed: 1, sent: 1, skipped: 1 });
    expect(repo.claimPushDelivery).toHaveBeenCalledOnce();
    expect(repo.claimPushDelivery).toHaveBeenCalledWith(
      commandCenterCandidate,
      expect.objectContaining({ id: "subscription-owner", role: "owner" }),
    );
    expect(webPushMock.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example.test/send/owner" }),
      expect.any(String),
      expect.objectContaining({ TTL: 600 }),
    );
  });

  it("loads VAPID config only when public and private keys exist", () => {
    expect(loadWebPushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: "public" })).toBeUndefined();
    expect(
      loadWebPushConfig({
        WEB_PUSH_VAPID_PUBLIC_KEY: "public",
        WEB_PUSH_VAPID_PRIVATE_KEY: "private",
        WEB_PUSH_SUBJECT: "mailto:ops@example.test",
      }),
    ).toEqual({
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:ops@example.test",
    });
  });
});
