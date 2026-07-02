import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PushNotificationSettings } from "@nytt/shared";
import { NotificationSettingsDashboard } from "./NotificationSettingsPage.js";

const configuredSettings: PushNotificationSettings = {
  configured: true,
  publicKey: "test-public-vapid-key",
  subscriptions: [
    {
      id: "subscription-one",
      endpointHash: "hashed-endpoint",
      enabled: true,
      minSeverity: "warning",
      kinds: [],
      createdAt: "2026-07-02T09:00:00.000Z",
      updatedAt: "2026-07-02T09:05:00.000Z",
      lastSeenAt: "2026-07-02T09:05:00.000Z",
      lastSuccessAt: "2026-07-02T09:10:00.000Z",
      failureCount: 0,
    },
  ],
};

describe("NotificationSettingsDashboard", () => {
  it("renders active subscription state without exposing raw endpoints", () => {
    const html = renderToStaticMarkup(
      <NotificationSettingsDashboard
        settings={configuredSettings}
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );

    expect(html).toContain("Varsler er aktivert");
    expect(html).toContain("1 aktive");
    expect(html).toContain("Sist sendt");
    expect(html).not.toContain("https://push");
    expect(html).not.toContain("hashed-endpoint");
  });

  it("renders server-disabled state honestly", () => {
    const html = renderToStaticMarkup(
      <NotificationSettingsDashboard
        settings={{ configured: false, subscriptions: [] }}
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );

    expect(html).toContain("Web Push er ikke konfigurert på serveren");
    expect(html).toContain("Ingen nettlesere er koblet");
  });
});
