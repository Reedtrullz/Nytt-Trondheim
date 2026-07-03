import { useEffect, useState } from "react";
import {
  publicNotificationTriggerGuidance,
  type NotificationTriggerKind,
  type NotificationTriggerSeverity,
  type PushNotificationSettings,
} from "@nytt/shared";
import { api, ApiError } from "../api.js";
import {
  pushBrowserSupport,
  subscribeBrowserToPush,
  type PushBrowserSupport,
} from "../pushNotifications.js";

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

type NotificationReadinessState = "ready" | "warning" | "blocked" | "info";
type NotificationProfile = {
  minSeverity: NotificationTriggerSeverity;
  kinds: NotificationTriggerKind[];
};

interface NotificationReadinessItem {
  key: string;
  title: string;
  status: string;
  detail: string;
  state: NotificationReadinessState;
}

function supportText(support: PushBrowserSupport) {
  switch (support) {
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

function browserReadiness(support: PushBrowserSupport): NotificationReadinessItem {
  switch (support) {
    case "supported":
      return {
        key: "browser",
        title: "Nettleser",
        status: "Kan abonnere",
        detail: "Denne enheten kan be om bakgrunnsvarsler når du aktiverer dem.",
        state: "ready",
      };
    case "insecure":
      return {
        key: "browser",
        title: "Nettleser",
        status: "Krever HTTPS",
        detail: "Bakgrunnsvarsler virker bare over HTTPS eller lokal utvikling.",
        state: "blocked",
      };
    case "permission_denied":
      return {
        key: "browser",
        title: "Nettleser",
        status: "Blokkert",
        detail: "Varsler er blokkert i nettleserinnstillingene for denne siden.",
        state: "blocked",
      };
    case "unsupported":
    default:
      return {
        key: "browser",
        title: "Nettleser",
        status: "Ikke støttet",
        detail: "Denne nettleseren mangler Web Push, service worker eller varselstøtte.",
        state: "blocked",
      };
  }
}

function notificationReadinessItems(
  settings: PushNotificationSettings,
  support: PushBrowserSupport,
): NotificationReadinessItem[] {
  const activeSubscriptions = settings.subscriptions.filter((subscription) => subscription.enabled);
  const canUseBrowserPush = support === "supported";
  const backgroundState: NotificationReadinessItem =
    !settings.configured || !canUseBrowserPush
      ? {
          key: "background",
          title: "Bakgrunnsvarsler",
          status: "Ikke klar",
          detail: !settings.configured
            ? "Serveren mangler Web Push-nøkler, så automatiske varsler sendes ikke."
            : "Denne nettleseren kan ikke holde et aktivt bakgrunnsabonnement akkurat nå.",
          state: "blocked",
        }
      : activeSubscriptions.length
        ? {
            key: "background",
            title: "Bakgrunnsvarsler",
            status: "Koblet",
            detail: `${activeSubscriptions.length} aktiv${
              activeSubscriptions.length === 1 ? "t" : "e"
            } nettleserabonnement er registrert på kontoen.`,
            state: "ready",
          }
        : {
            key: "background",
            title: "Bakgrunnsvarsler",
            status: "Ikke koblet",
            detail: "Aktiver varsler på denne enheten for å motta dem uten å ha siden åpen.",
            state: "warning",
          };

  return [
    {
      key: "server",
      title: "Serverkanal",
      status: settings.configured ? "Klar" : "Ikke konfigurert",
      detail: settings.configured
        ? "Nytt kan sende Web Push når en kandidat matcher abonnementet ditt."
        : "Automatiske bakgrunnsvarsler er deaktivert til servernøklene er satt opp.",
      state: settings.configured ? "ready" : "blocked",
    },
    browserReadiness(support),
    {
      key: "open-tab",
      title: "Åpen fane",
      status: "Alltid synlig",
      detail:
        "Forsiden viser høyeffektsaker når siden er åpen. Dette er ikke det samme som bakgrunnsvarsler.",
      state: "info",
    },
    backgroundState,
  ];
}

function severityLabel(severity: NotificationTriggerSeverity) {
  switch (severity) {
    case "critical":
      return "Kritisk";
    case "warning":
      return "Varsel";
    case "watch":
      return "Følg med";
  }
}

const defaultNotificationProfile: NotificationProfile = { minSeverity: "warning", kinds: [] };

const profileSeverityOptions: Array<{
  value: NotificationTriggerSeverity;
  label: string;
  detail: string;
}> = [
  {
    value: "warning",
    label: "Kritisk + varsel",
    detail: "Fanger stengte veier, redning, naturfare og viktige bortfall.",
  },
  {
    value: "critical",
    label: "Bare kritisk",
    detail: "Brukes for de mest alvorlige sakene med høy kilde- og effektvurdering.",
  },
];

function profileFromSettings(settings: PushNotificationSettings): NotificationProfile {
  const active = settings.subscriptions.find((subscription) => subscription.enabled);
  if (!active) return defaultNotificationProfile;
  return {
    minSeverity: active.minSeverity,
    kinds: active.kinds,
  };
}

function kindTitle(kind: NotificationTriggerKind): string {
  return publicNotificationTriggerGuidance.find((item) => item.kind === kind)?.title ?? kind;
}

function kindSummary(kinds: NotificationTriggerKind[]): string {
  return kinds.length ? kinds.map(kindTitle).join(", ") : "Alle typer";
}

function toggleKind(kinds: NotificationTriggerKind[], kind: NotificationTriggerKind) {
  return kinds.includes(kind) ? kinds.filter((entry) => entry !== kind) : [...kinds, kind];
}

export function NotificationSettingsDashboard({
  settings,
  busy = false,
  error,
  onSubscribe,
  onUnsubscribe,
  profile = defaultNotificationProfile,
  onProfileChange,
  browserSupport,
}: {
  settings: PushNotificationSettings;
  busy?: boolean;
  error?: string;
  onSubscribe: (profile: NotificationProfile) => void;
  onUnsubscribe: (id: string) => void;
  profile?: NotificationProfile;
  onProfileChange?: (profile: NotificationProfile) => void;
  browserSupport?: PushBrowserSupport;
}) {
  const activeSubscriptions = settings.subscriptions.filter((subscription) => subscription.enabled);
  const support = browserSupport ?? pushBrowserSupport();
  const canSubscribe = settings.configured && support === "supported";
  const readiness = notificationReadinessItems(settings, support);
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
          <p>
            {settings.configured
              ? supportText(support)
              : "Web Push er ikke konfigurert på serveren."}
          </p>
          <p className="muted">
            V1 sender bare kritiske og tydelige varselkandidater. Sportsnyheter, kulturstoff og
            vanlige overskrifter varsles ikke.
          </p>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={!canSubscribe || busy}
          onClick={() => onSubscribe(profile)}
        >
          {busy
            ? "Jobber..."
            : activeSubscriptions.length
              ? "Oppdater varselprofil"
              : "Aktiver valgt profil"}
        </button>
      </section>

      {error ? (
        <section className="inline-error" role="alert">
          {error}
        </section>
      ) : null}

      <section className="notification-readiness" aria-labelledby="notification-readiness">
        <div className="section-heading-row">
          <div>
            <p className="label">Leveringsklarhet</p>
            <h2 id="notification-readiness">Hva virker hvor?</h2>
          </div>
          <span>{activeSubscriptions.length} aktive nettlesere</span>
        </div>
        <div className="notification-readiness-grid">
          {readiness.map((item) => (
            <article
              className={`notification-readiness-item ${item.state}`}
              data-readiness-key={item.key}
              key={item.key}
            >
              <span>{item.title}</span>
              <strong>{item.status}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="notification-profile" aria-labelledby="notification-profile">
        <div className="section-heading-row">
          <div>
            <p className="label">Varselprofil</p>
            <h2 id="notification-profile">Hva vil du bli varslet om?</h2>
          </div>
          <span>{kindSummary(profile.kinds)}</span>
        </div>
        <div className="notification-profile-grid">
          <fieldset className="notification-profile-fieldset">
            <legend>Alvorlighet</legend>
            <div className="notification-profile-segments">
              {profileSeverityOptions.map((option) => (
                <button
                  aria-pressed={profile.minSeverity === option.value}
                  className={profile.minSeverity === option.value ? "selected" : undefined}
                  disabled={busy}
                  key={option.value}
                  onClick={() =>
                    onProfileChange?.({
                      ...profile,
                      minSeverity: option.value,
                    })
                  }
                  type="button"
                >
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="notification-profile-fieldset">
            <legend>Typer</legend>
            <div className="notification-profile-kind-grid">
              <button
                aria-pressed={profile.kinds.length === 0}
                className={profile.kinds.length === 0 ? "selected" : undefined}
                disabled={busy}
                onClick={() => onProfileChange?.({ ...profile, kinds: [] })}
                type="button"
              >
                Alle typer
              </button>
              {publicNotificationTriggerGuidance.map((item) => (
                <button
                  aria-pressed={profile.kinds.includes(item.kind)}
                  className={profile.kinds.includes(item.kind) ? "selected" : undefined}
                  disabled={busy}
                  key={item.kind}
                  onClick={() =>
                    onProfileChange?.({
                      ...profile,
                      kinds: toggleKind(profile.kinds, item.kind),
                    })
                  }
                  type="button"
                >
                  {item.title}
                </button>
              ))}
            </div>
            <p>Tomt typevalg betyr at alle høyeffektstyper kan varsles.</p>
          </fieldset>
        </div>
      </section>

      <section className="notification-trigger-guidance" aria-labelledby="notification-guidance">
        <div className="section-heading-row">
          <div>
            <p className="label">Utløserlogikk</p>
            <h2 id="notification-guidance">Dette kan gi varsel</h2>
          </div>
          <span>Kildegrunnlag må være tydelig</span>
        </div>
        <div className="notification-trigger-guidance-grid">
          {publicNotificationTriggerGuidance.map((item) => (
            <article key={item.kind}>
              <span>{severityLabel(item.severity)}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <small>{item.examples.join(" · ")}</small>
            </article>
          ))}
        </div>
      </section>

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
                    {kindSummary(subscription.kinds)} · Sist sett {time(subscription.lastSeenAt)}
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
  const [profile, setProfile] = useState<NotificationProfile>(defaultNotificationProfile);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const next = await api.notificationSettings();
    setSettings(next);
    setProfile(profileFromSettings(next));
  }

  useEffect(() => {
    let ignore = false;
    api
      .notificationSettings()
      .then((next) => {
        if (!ignore) {
          setSettings(next);
          setProfile(profileFromSettings(next));
        }
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function subscribe(nextProfile: NotificationProfile) {
    if (!settings?.publicKey) return;
    setBusy(true);
    setError(undefined);
    try {
      const input = await subscribeBrowserToPush(
        settings.publicKey,
        nextProfile.minSeverity,
        nextProfile.kinds,
      );
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
      profile={profile}
      onProfileChange={setProfile}
      onSubscribe={(nextProfile) => void subscribe(nextProfile)}
      onUnsubscribe={(id) => void unsubscribe(id)}
    />
  );
}
