import { useEffect, useState } from "react";
import type { PushNotificationSettings } from "@nytt/shared";
import { api, ApiError } from "../api.js";
import { pushBrowserSupport, subscribeBrowserToPush } from "../pushNotifications.js";

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function supportText() {
  switch (pushBrowserSupport()) {
    case "supported":
      return "Denne nettleseren kan motta Web Push-varsler.";
    case "insecure":
      return "Varsler krever HTTPS eller localhost.";
    case "permission_denied":
      return "Varsler er blokkert i nettleseren. Endre nettleserinnstillingene for å abonnere.";
    case "unsupported":
    default:
      return "Denne nettleseren støtter ikke Web Push-varsler.";
  }
}

export function NotificationSettingsDashboard({
  settings,
  busy = false,
  error,
  onSubscribe,
  onUnsubscribe,
}: {
  settings: PushNotificationSettings;
  busy?: boolean;
  error?: string;
  onSubscribe: () => void;
  onUnsubscribe: (id: string) => void;
}) {
  const activeSubscriptions = settings.subscriptions.filter((subscription) => subscription.enabled);
  const canSubscribe = settings.configured && pushBrowserSupport() === "supported";
  return (
    <main className="notification-settings-page">
      <header className="page-heading">
        <p className="label">Personlige varsler</p>
        <h1>Varsler</h1>
        <p>
          Få nettleservarsel for høyeffekt-hendelser som Nytt allerede har markert med høy
          alvorlighet og tydelig kildegrunnlag.
        </p>
      </header>

      <section className="notification-settings-card">
        <div>
          <p className="label">Status</p>
          <h2>{activeSubscriptions.length ? "Varsler er aktivert" : "Varsler er ikke aktivert"}</h2>
          <p>{settings.configured ? supportText() : "Web Push er ikke konfigurert på serveren."}</p>
          <p className="muted">
            V1 sender bare kritiske og tydelige varselkandidater. Sportsnyheter, kulturstoff og
            vanlige overskrifter varsles ikke.
          </p>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={!canSubscribe || busy}
          onClick={onSubscribe}
        >
          {busy
            ? "Jobber..."
            : activeSubscriptions.length
              ? "Oppdater abonnement"
              : "Aktiver varsler"}
        </button>
      </section>

      {error ? (
        <section className="inline-error" role="alert">
          {error}
        </section>
      ) : null}

      <section className="notification-settings-list" aria-labelledby="notification-subscriptions">
        <div className="section-heading-row">
          <div>
            <p className="label">Denne kontoen</p>
            <h2 id="notification-subscriptions">Abonnementer</h2>
          </div>
          <span>{activeSubscriptions.length} aktive</span>
        </div>
        {settings.subscriptions.length ? (
          <div className="notification-subscription-list">
            {settings.subscriptions.map((subscription) => (
              <article key={subscription.id} className="notification-subscription-row">
                <div>
                  <strong>{subscription.enabled ? "Aktivt abonnement" : "Deaktivert"}</strong>
                  <p>
                    Minste nivå: {subscription.minSeverity === "critical" ? "Kritisk" : "Varsel"} ·
                    Sist sett {time(subscription.lastSeenAt)}
                  </p>
                  <small>
                    {subscription.lastSuccessAt
                      ? `Sist sendt ${time(subscription.lastSuccessAt)}`
                      : "Ingen leverte varsler registrert ennå."}
                  </small>
                </div>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy || !subscription.enabled}
                  onClick={() => onUnsubscribe(subscription.id)}
                >
                  Slå av
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Ingen nettlesere er koblet til denne kontoen. Aktiver varsler på mobilen eller maskinen
            du vil bruke.
          </p>
        )}
      </section>
    </main>
  );
}

export function NotificationSettingsPage() {
  const [settings, setSettings] = useState<PushNotificationSettings>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setSettings(await api.notificationSettings());
  }

  useEffect(() => {
    let ignore = false;
    api
      .notificationSettings()
      .then((next) => {
        if (!ignore) setSettings(next);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function subscribe() {
    if (!settings?.publicKey) return;
    setBusy(true);
    setError(undefined);
    try {
      const input = await subscribeBrowserToPush(settings.publicKey, "warning");
      await api.subscribeToNotifications(input);
      await refresh();
    } catch (reason) {
      const message =
        reason instanceof ApiError || reason instanceof Error
          ? reason.message
          : "Kunne ikke aktivere varsler.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      await api.unsubscribeFromNotifications(id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kunne ikke slå av varsler.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return <main className="notification-settings-page">Henter varselinnstillinger...</main>;
  }
  return (
    <NotificationSettingsDashboard
      settings={settings}
      busy={busy}
      error={error}
      onSubscribe={() => void subscribe()}
      onUnsubscribe={(id) => void unsubscribe(id)}
    />
  );
}
