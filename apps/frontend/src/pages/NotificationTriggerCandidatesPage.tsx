import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  NotificationTriggerCandidate,
  NotificationTriggerDeliveryState,
  NotificationTriggerKind,
  NotificationTriggerPage,
  NotificationTriggerQueryInput,
  NotificationTriggerSeverity,
  PushDeliveryPage,
} from "@nytt/shared";
import { api } from "../api.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

interface NotificationTriggerFilters extends NotificationTriggerQueryInput {
  selected?: string;
}

const severityLabels: Record<NotificationTriggerSeverity, string> = {
  critical: "Kritisk",
  warning: "Varsel",
  watch: "Følg med",
};

const kindLabels: Record<NotificationTriggerKind, string> = {
  public_safety: "Sikkerhet",
  traffic_disruption: "Trafikk",
  weather_hazard: "Vær",
  service_disruption: "Driftsbrudd",
};

const deliveryStateLabels: Record<NotificationTriggerDeliveryState, string> = {
  candidate_only: "Ikke sendt",
  not_configured: "Ikke konfigurert",
  no_subscribers: "Ingen abonnent",
  ready: "Klar",
  sent: "Sendt",
  failed: "Feilet",
  suppressed: "Dempet",
};

const severityOptions: Array<{ value: NotificationTriggerSeverity; label: string }> = [
  { value: "critical", label: "Kritisk" },
  { value: "warning", label: "Varsel" },
  { value: "watch", label: "Følg med" },
];

const kindOptions: Array<{ value: NotificationTriggerKind; label: string }> = [
  { value: "public_safety", label: "Sikkerhet" },
  { value: "traffic_disruption", label: "Trafikk" },
  { value: "weather_hazard", label: "Vær" },
  { value: "service_disruption", label: "Driftsbrudd" },
];

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
}

function parseList<T extends string>(value: string | null, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const allowedSet = new Set(allowed);
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is T => allowedSet.has(entry as T));
  return parsed.length ? parsed : undefined;
}

function parseFilters(search: string): NotificationTriggerFilters {
  const parameters = new URLSearchParams(search);
  const severities = parseList(
    parameters.get("severities"),
    severityOptions.map((option) => option.value),
  );
  const kinds = parseList(
    parameters.get("kinds"),
    kindOptions.map((option) => option.value),
  );
  const q = parameters.get("q")?.trim() || undefined;
  const selected = parameters.get("trigger")?.trim() || undefined;
  const parsedLimit = Number(parameters.get("limit"));
  return {
    limit: Number.isFinite(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 30,
    ...(severities ? { severities } : {}),
    ...(kinds ? { kinds } : {}),
    ...(q ? { q } : {}),
    ...(selected ? { selected } : {}),
  };
}

function buildSearch(filters: NotificationTriggerFilters) {
  const parameters = new URLSearchParams();
  if (filters.severities?.length) parameters.set("severities", filters.severities.join(","));
  if (filters.kinds?.length) parameters.set("kinds", filters.kinds.join(","));
  if (filters.q) parameters.set("q", filters.q);
  if (filters.limit) parameters.set("limit", String(filters.limit));
  if (filters.selected) parameters.set("trigger", filters.selected);
  return parameters;
}

function queryFromFilters(filters: NotificationTriggerFilters): NotificationTriggerQueryInput {
  return {
    limit: filters.limit ?? 30,
    ...(filters.severities?.length ? { severities: filters.severities } : {}),
    ...(filters.kinds?.length ? { kinds: filters.kinds } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
}

function toggle<T extends string>(values: T[] | undefined, value: T): T[] | undefined {
  const current = values ?? [];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
  return next.length ? next : undefined;
}

function TriggerDrawer({ candidate }: { candidate?: NotificationTriggerCandidate }) {
  if (!candidate) {
    return (
      <aside className="notification-trigger-drawer">
        <p className="label">Detalj</p>
        <h2>Ingen kandidat valgt</h2>
        <p>Velg en rad for å se terskler, kilder og begrunnelse.</p>
      </aside>
    );
  }

  return (
    <aside className="notification-trigger-drawer" aria-label={`Detaljer for ${candidate.title}`}>
      <p className="label">{kindLabels[candidate.kind]}</p>
      <h2>{candidate.title}</h2>
      <p>{candidate.body}</p>
      <p>{candidate.detail}</p>
      <div className="notification-trigger-badges">
        <span>{severityLabels[candidate.severity]}</span>
        <span>{percent(candidate.score)} score</span>
        <span>{deliveryStateLabels[candidate.deliveryState]}</span>
      </div>
      <dl className="coverage-bundle-facts">
        <div>
          <dt>Sist oppdatert</dt>
          <dd>{time(candidate.eventUpdatedAt)}</dd>
        </div>
        <div>
          <dt>Tillit</dt>
          <dd>
            {candidate.confidence.label ?? candidate.confidence.level}
            {candidate.confidence.score !== undefined
              ? ` · ${percent(candidate.confidence.score)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Kilder</dt>
          <dd>{candidate.sourceLabels.join(", ") || candidate.sourceIds.join(", ")}</dd>
        </div>
        <div>
          <dt>Levering</dt>
          <dd>{deliveryStateLabels[candidate.deliveryState]}</dd>
        </div>
      </dl>
      <section>
        <h3>Hvorfor fanget</h3>
        <ul className="coverage-bundle-signal-list">
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Trefford</h3>
        {candidate.matchedKeywords.length ? (
          <div className="notification-trigger-keywords">
            {candidate.matchedKeywords.map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        ) : (
          <p className="coverage-bundle-empty">Ingen eksplisitte ordtreff.</p>
        )}
      </section>
      <section>
        <h3>Lenker</h3>
        <div className="coverage-bundle-member-list">
          {candidate.links.map((link) => {
            const href = link.kind === "external" ? safeExternalUrl(link.href) : link.href;
            return href ? (
              <a
                href={href}
                key={`${link.kind}:${link.label}`}
                target={link.kind === "external" ? "_blank" : undefined}
                rel={link.kind === "external" ? "noreferrer" : undefined}
              >
                <span>{link.kind === "external" ? "Ekstern" : "Nytt"}</span>
                <strong>{link.label}</strong>
              </a>
            ) : (
              <div className="coverage-bundle-member-linkless" key={`${link.kind}:${link.label}`}>
                <strong>{link.label}</strong>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function DeliveryHistory({ deliveries }: { deliveries?: PushDeliveryPage }) {
  if (!deliveries) return null;
  return (
    <section className="notification-delivery-history" aria-labelledby="notification-deliveries">
      <div className="section-heading-row">
        <div>
          <p className="label">Web Push</p>
          <h2 id="notification-deliveries">Siste leveranser</h2>
        </div>
        <span>
          {deliveries.summary.sent} sendt · {deliveries.summary.failed} feilet
        </span>
      </div>
      {deliveries.items.length ? (
        <div className="notification-delivery-list">
          {deliveries.items.slice(0, 6).map((item) => (
            <article key={item.id} className={`notification-delivery-row ${item.status}`}>
              <span>{item.status}</span>
              <strong>{item.title}</strong>
              <small>
                {severityLabels[item.severity]} · {time(item.sentAt ?? item.createdAt)}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="coverage-bundle-empty">Ingen leveringsforsøk registrert ennå.</p>
      )}
    </section>
  );
}

export function NotificationTriggerCandidatesDashboard({
  page,
  deliveries,
  filters,
  onFiltersChange,
}: {
  page: NotificationTriggerPage;
  deliveries?: PushDeliveryPage;
  filters: NotificationTriggerFilters;
  onFiltersChange: (filters: NotificationTriggerFilters) => void;
}) {
  const selectedCandidate =
    page.items.find((item) => item.id === filters.selected) ?? page.items[0];

  function update(next: Partial<NotificationTriggerFilters>) {
    onFiltersChange({ ...filters, selected: undefined, ...next });
  }

  return (
    <main className="notification-triggers-page">
      <header className="coverage-bundles-hero notification-triggers-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Varselutløsere</h1>
          <p>
            Kandidater for høyeffektsvarsler og siste Web Push-leveranser. Dette er en les-only
            operatørflate; personlige abonnement styres fra Varsler-siden.
          </p>
        </div>
        <div className="coverage-bundles-actions">
          <Link to="/command">Kommandosenter</Link>
          <Link to="/command/tidslinje">Tidslinje</Link>
          <Link to="/command/radata">Rådata</Link>
        </div>
      </header>
      <section className="coverage-bundles-summary notification-triggers-summary">
        <article>
          <strong>{page.summary.total}</strong>
          <span>Kandidater</span>
        </article>
        <article>
          <strong>{page.summary.critical}</strong>
          <span>Kritiske</span>
        </article>
        <article>
          <strong>{page.summary.officialBacked}</strong>
          <span>Offentlig støttet</span>
        </article>
        <article>
          <strong>{page.summary.highConfidence}</strong>
          <span>Høy tillit</span>
        </article>
      </section>
      <DeliveryHistory deliveries={deliveries} />
      <section className="notification-triggers-grid">
        <aside
          className="coverage-bundles-sidebar notification-triggers-sidebar"
          aria-label="Filtre"
        >
          <label>
            Søk
            <input
              value={filters.q ?? ""}
              onChange={(event) => update({ q: event.target.value || undefined })}
              placeholder="Søk i kandidat, kilde, ordtreff"
            />
          </label>
          <fieldset className="notification-trigger-filter">
            <legend>Alvorlighet</legend>
            {severityOptions.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={filters.severities?.includes(option.value) ?? false}
                  onChange={() => update({ severities: toggle(filters.severities, option.value) })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="notification-trigger-filter">
            <legend>Type</legend>
            {kindOptions.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={filters.kinds?.includes(option.value) ?? false}
                  onChange={() => update({ kinds: toggle(filters.kinds, option.value) })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
        </aside>
        <section className="notification-trigger-list" aria-label="Varselkandidater">
          <div className="coverage-bundle-list-heading">
            <div>
              <p className="label">Siste beregning {time(page.generatedAt)}</p>
              <h2>Kandidater</h2>
            </div>
            <span>{page.items.length} vist</span>
          </div>
          {page.items.length === 0 ? (
            <p className="coverage-bundle-empty">Ingen varselkandidater matcher filtrene.</p>
          ) : (
            page.items.map((candidate) => (
              <button
                className={
                  candidate.id === selectedCandidate?.id
                    ? `notification-trigger-row selected ${candidate.severity}`
                    : `notification-trigger-row ${candidate.severity}`
                }
                key={candidate.id}
                type="button"
                onClick={() => update({ selected: candidate.id })}
              >
                <div className="notification-trigger-row-main">
                  <span>{kindLabels[candidate.kind]}</span>
                  <strong>{candidate.title}</strong>
                  <small>{candidate.body}</small>
                </div>
                <div className="notification-trigger-row-meta">
                  <span>{severityLabels[candidate.severity]}</span>
                  <span>{percent(candidate.score)}</span>
                  <span>{deliveryStateLabels[candidate.deliveryState]}</span>
                </div>
              </button>
            ))
          )}
        </section>
        <TriggerDrawer candidate={selectedCandidate} />
      </section>
    </main>
  );
}

export function NotificationTriggerCandidatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const filters = useMemo(() => parseFilters(search), [search]);
  const [page, setPage] = useState<NotificationTriggerPage>();
  const [deliveries, setDeliveries] = useState<PushDeliveryPage>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setError(undefined);
    Promise.all([
      api.notificationTriggers(queryFromFilters(filters)),
      api.notificationDeliveries(30),
    ])
      .then(([nextPage, nextDeliveries]) => {
        if (!ignore) {
          setPage(nextPage);
          setDeliveries(nextDeliveries);
        }
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });
    return () => {
      ignore = true;
    };
  }, [attempt, filters]);

  function updateFilters(nextFilters: NotificationTriggerFilters) {
    setSearchParams(buildSearch(nextFilters), { replace: true });
  }

  if (error) {
    return (
      <main className="fatal-error coverage-bundles-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igjen
        </button>
      </main>
    );
  }

  if (!page) {
    return (
      <main className="loading">
        <h1>Varselutløsere</h1>
        <p>Henter kandidater...</p>
      </main>
    );
  }

  return (
    <NotificationTriggerCandidatesDashboard
      filters={filters}
      deliveries={deliveries}
      onFiltersChange={updateFilters}
      page={page}
    />
  );
}
