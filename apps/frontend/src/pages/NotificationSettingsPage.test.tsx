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
        browserSupport="supported"
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );

    expect(html).toContain("Varsler er aktivert");
    expect(html).toContain("Dette kan gi varsel");
    expect(html).toContain("Liv og helse");
    expect(html).toContain("Stengte hovedårer");
    expect(html).toContain("Vær og naturfare");
    expect(html).toContain("Kildegrunnlag må være tydelig");
    expect(html).toContain("Leveringsklarhet");
    expect(html).toContain("Serverkanal");
    expect(html).toContain("Nettleser");
    expect(html).toContain("Åpen fane");
    expect(html).toContain("Bakgrunnsvarsler");
    expect(html).toContain("Koblet");
    expect(html).toContain("Varselprofil");
    expect(html).toContain("Hva vil du bli varslet om?");
    expect(html).toContain("Kritisk + varsel");
    expect(html).toContain("Bare kritisk");
    expect(html).toContain("Alle typer");
    expect(html).toContain("1 aktive");
    expect(html).toContain("Sist sendt");
    expect(html).not.toContain("https://push");
    expect(html).not.toContain("hashed-endpoint");
  });

  it("renders server-disabled state honestly", () => {
    const html = renderToStaticMarkup(
      <NotificationSettingsDashboard
        settings={{ configured: false, subscriptions: [] }}
        browserSupport="supported"
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );

    expect(html).toContain("Web Push er ikke konfigurert på serveren");
    expect(html).toContain("Ikke konfigurert");
    expect(html).toContain("Serveren mangler Web Push-nøkler");
    expect(html).toContain("Ingen nettlesere er koblet");
  });

  it("separates open-tab visibility from blocked browser background push", () => {
    const html = renderToStaticMarkup(
      <NotificationSettingsDashboard
        settings={{ configured: true, publicKey: "key", subscriptions: [] }}
        browserSupport="permission_denied"
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );

    expect(html).toContain("Åpen fane");
    expect(html).toContain("Alltid synlig");
    expect(html).toContain("Bakgrunnsvarsler");
    expect(html).toContain("Ikke klar");
    expect(html).toContain("Varsler er blokkert i nettleserinnstillingene");
  });

  it("renders a chosen critical traffic-only profile", () => {
    const html = renderToStaticMarkup(
      <NotificationSettingsDashboard
        settings={configuredSettings}
        browserSupport="supported"
        profile={{ minSeverity: "critical", kinds: ["traffic_disruption"] }}
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );

    expect(html).toContain("Bare kritisk");
    expect(html).toContain("Stengte hovedårer");
    expect(html).toContain("Minste nivå: Varsel");
    expect(html).not.toContain("hashed-endpoint");
  });
});
