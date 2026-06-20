import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { OperationsTimelineEvent, OperationsTimelineResponse } from "@nytt/shared";
import { api } from "../api.js";
import {
  buildOperationsTimelineSearch,
  operationsTimelineKindOptions,
  operationsTimelineProvenanceOptions,
  operationsTimelineQueryFromFilters,
  operationsTimelineRoleOptions,
  operationsTimelineSeverityOptions,
  operationsTimelineSourceOptions,
  operationsTimelineStatusOptions,
  parseOperationsTimelineFilters,
  toggleTimelineFilterValue,
  type OperationsTimelineFilters,
} from "../operationsTimelineFilters.js";
import {
  groupOperationsTimelineEvents,
  operationsTimelineConfidenceLabel,
  operationsTimelineKindLabel,
  operationsTimelineProvenanceLabel,
  operationsTimelineRoleLabel,
  operationsTimelineSeverityLabel,
  operationsTimelineStatusLabel,
  osloTimeFormatter,
} from "../operationsTimelineRows.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

function time(value: string) {
  return osloTimeFormatter.format(new Date(value));
}

function duration(value?: number) {
  if (value === undefined) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} sek`;
}

function FilterCheckboxGroup<T extends string>({
  title,
  values,
  options,
  onChange,
}: {
  title: string;
  values: readonly T[] | undefined;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (values: T[] | undefined) => void;
}) {
  return (
    <fieldset className="operations-timeline-filter">
      <legend>{title}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={values?.includes(option.value) ?? false}
            onChange={() => {
              const next = toggleTimelineFilterValue(values, option.value);
              onChange(next.length ? next : undefined);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function focusEventButton(index: number) {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-timeline-event]");
  buttons[index]?.focus();
}

function handleEventKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number, total: number) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusEventButton(Math.min(total - 1, index + 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusEventButton(Math.max(0, index - 1));
  } else if (event.key === "Home") {
    event.preventDefault();
    focusEventButton(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusEventButton(total - 1);
  }
}

function EventRow({
  event,
  selected,
  index,
  total,
  onSelect,
}: {
  event: OperationsTimelineEvent;
  selected: boolean;
  index: number;
  total: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`timeline-event-row timeline-severity-${event.severity} ${
        selected ? "selected" : ""
      }`}
      aria-expanded={selected}
      data-timeline-event
      onClick={() => onSelect(event.id)}
      onKeyDown={(keyboardEvent) => handleEventKeyDown(keyboardEvent, index, total)}
    >
      <span className={`timeline-status-dot is-${event.severity}`} aria-hidden="true" />
      <span className="timeline-event-main">
        <strong>{event.title}</strong>
        <small>{event.detail}</small>
      </span>
      <span className="timeline-event-meta">
        <time>{time(event.timestamp)}</time>
        <span>{event.sourceLabel ?? event.source ?? operationsTimelineRoleLabel(event.role)}</span>
      </span>
      <span className="timeline-event-badges">
        <span>{operationsTimelineKindLabel(event.kind)}</span>
        <span>{operationsTimelineSeverityLabel(event.severity)}</span>
        <span>{operationsTimelineProvenanceLabel(event)}</span>
      </span>
    </button>
  );
}

function TimelineDrawer({ event }: { event: OperationsTimelineEvent | undefined }) {
  if (!event) {
    return (
      <aside className="operations-timeline-drawer">
        <p className="label">Detalj</p>
        <h2>Velg en hendelse</h2>
        <p className="muted">
          Tidslinjen viser operasjonelle spor uten rådata eller hemmeligheter.
        </p>
      </aside>
    );
  }

  return (
    <aside className="operations-timeline-drawer" aria-label={`Detaljer for ${event.title}`}>
      <p className="label">{operationsTimelineKindLabel(event.kind)}</p>
      <h2>{event.title}</h2>
      <div className="timeline-event-badges drawer-badges">
        <span>{operationsTimelineSeverityLabel(event.severity)}</span>
        <span>{operationsTimelineRoleLabel(event.role)}</span>
        <span>{operationsTimelineConfidenceLabel(event)}</span>
      </div>
      <dl className="operations-timeline-facts">
        <div>
          <dt>Tid</dt>
          <dd>{time(event.timestamp)}</dd>
        </div>
        <div>
          <dt>Situasjon</dt>
          <dd>{event.situationTitle ?? "Ikke koblet"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{operationsTimelineStatusLabel(event.situationStatus)}</dd>
        </div>
        <div>
          <dt>Kilde</dt>
          <dd>{event.sourceLabel ?? event.source ?? "System"}</dd>
        </div>
        <div>
          <dt>Proveniens</dt>
          <dd>{operationsTimelineProvenanceLabel(event)}</dd>
        </div>
      </dl>
      <p>{event.detail}</p>
      {event.metadata ? (
        <dl className="operations-timeline-metrics">
          {"recordsSeen" in event.metadata ? (
            <div>
              <dt>Sett</dt>
              <dd>{event.metadata.recordsSeen}</dd>
            </div>
          ) : null}
          {"recordsAccepted" in event.metadata ? (
            <div>
              <dt>Inn</dt>
              <dd>{event.metadata.recordsAccepted}</dd>
            </div>
          ) : null}
          {"recordsRejected" in event.metadata ? (
            <div>
              <dt>Avvik</dt>
              <dd>{event.metadata.recordsRejected}</dd>
            </div>
          ) : null}
          {"durationMs" in event.metadata ? (
            <div>
              <dt>Varighet</dt>
              <dd>{duration(event.metadata.durationMs)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <section>
        <h3>Lenker</h3>
        {event.links.length ? (
          <div className="operations-timeline-links">
            {event.links.map((link, index) => {
              const href = link.kind === "external" ? safeExternalUrl(link.href) : link.href;
              if (!href) return <span key={`${link.kind}-${index}`}>{link.label}</span>;
              return link.kind === "external" ? (
                <a key={`${link.kind}-${index}`} href={href} rel="noreferrer" target="_blank">
                  {link.label}
                </a>
              ) : (
                <Link key={`${link.kind}-${index}`} to={href}>
                  {link.label}
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="muted">Ingen lenker registrert.</p>
        )}
      </section>
    </aside>
  );
}

export function OperationsTimelineDashboard({
  timeline,
  filters,
  onFiltersChange,
}: {
  timeline: OperationsTimelineResponse;
  filters: OperationsTimelineFilters;
  onFiltersChange: (filters: OperationsTimelineFilters) => void;
}) {
  const groups = groupOperationsTimelineEvents(timeline.events);
  const selectedEvent =
    timeline.events.find((event) => event.id === filters.selectedEvent) ?? timeline.events[0];
  const flatEvents = timeline.events;

  function update(next: Partial<OperationsTimelineFilters>) {
    const selectionOnly = Object.keys(next).length === 1 && "selectedEvent" in next;
    onFiltersChange({
      ...filters,
      ...(selectionOnly ? {} : { cursor: undefined, selectedEvent: undefined }),
      ...next,
    });
  }

  return (
    <main className="operations-timeline-page">
      <header className="operations-timeline-hero">
        <div>
          <p className="label">Privat drift</p>
          <h1>Operasjonstidslinje</h1>
          <p>Aktive situasjoner, kildeoppdateringer, worker-kjøringer og private arbeidsgrep.</p>
        </div>
        <div className="operations-timeline-actions">
          <Link to="/drift">Drift</Link>
          <Link to="/drift/kilder">Kilderevisjon</Link>
        </div>
      </header>

      <section className="operations-timeline-summary" aria-label="Tidslinjeoppsummering">
        <article>
          <strong>{timeline.summary.total}</strong>
          <span>Hendelser</span>
        </article>
        <article>
          <strong>{timeline.summary.activeSituations}</strong>
          <span>Aktive situasjoner</span>
        </article>
        <article>
          <strong>{timeline.summary.staleWarnings}</strong>
          <span>Utdaterte varsler</span>
        </article>
        <article>
          <strong>{timeline.summary.collectorRuns}</strong>
          <span>Worker-kjøringer</span>
        </article>
        <article>
          <strong>{timeline.summary.privateEvents}</strong>
          <span>Private grep</span>
        </article>
      </section>

      <div className="operations-timeline-grid">
        <aside className="operations-timeline-sidebar" aria-label="Tidslinjefiltre">
          <label className="operations-timeline-search">
            <span>Søk</span>
            <input
              value={filters.q ?? ""}
              onChange={(event) => update({ q: event.target.value || undefined })}
              placeholder="Søk i tidslinjen"
            />
          </label>
          <label className="operations-timeline-toggle">
            <input
              type="checkbox"
              checked={filters.includePrivateAnnotations !== false}
              onChange={(event) =>
                update({ includePrivateAnnotations: event.target.checked || false })
              }
            />
            <span>Vis private arbeidsgrep</span>
          </label>
          <label className="operations-timeline-select">
            <span>Sortering</span>
            <select
              value={filters.sort ?? "desc"}
              onChange={(event) => update({ sort: event.target.value === "asc" ? "asc" : "desc" })}
            >
              <option value="desc">Nyeste først</option>
              <option value="asc">Eldste først</option>
            </select>
          </label>
          <FilterCheckboxGroup
            title="Type"
            values={filters.kinds}
            options={operationsTimelineKindOptions}
            onChange={(kinds) => update({ kinds })}
          />
          <FilterCheckboxGroup
            title="Kilder"
            values={filters.sources}
            options={operationsTimelineSourceOptions}
            onChange={(sources) => update({ sources })}
          />
          <FilterCheckboxGroup
            title="Proveniens"
            values={filters.provenances}
            options={operationsTimelineProvenanceOptions}
            onChange={(provenances) => update({ provenances })}
          />
          <FilterCheckboxGroup
            title="Status"
            values={filters.statuses}
            options={operationsTimelineStatusOptions}
            onChange={(statuses) => update({ statuses })}
          />
          <FilterCheckboxGroup
            title="Alvorlighet"
            values={filters.severities}
            options={operationsTimelineSeverityOptions}
            onChange={(severities) => update({ severities })}
          />
          <FilterCheckboxGroup
            title="Rolle"
            values={filters.roles}
            options={operationsTimelineRoleOptions}
            onChange={(roles) => update({ roles })}
          />
        </aside>

        <section className="operations-timeline-list" aria-labelledby="operations-timeline-heading">
          <div className="operations-timeline-list-heading">
            <div>
              <p className="label">Kronologi</p>
              <h2 id="operations-timeline-heading">Siste operative spor</h2>
            </div>
            <div className="operations-timeline-heading-actions">
              <time>{time(timeline.generatedAt)}</time>
              {timeline.nextCursor ? (
                <button
                  type="button"
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      cursor: timeline.nextCursor,
                      selectedEvent: undefined,
                    })
                  }
                >
                  Neste side
                </button>
              ) : null}
            </div>
          </div>
          {groups.length ? (
            groups.map((group) => (
              <section className="timeline-day-group" key={group.key}>
                <h3 className="timeline-day-heading">{group.label}</h3>
                {group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={selectedEvent?.id === event.id}
                    index={flatEvents.findIndex((candidate) => candidate.id === event.id)}
                    total={flatEvents.length}
                    onSelect={(selectedEventId) => update({ selectedEvent: selectedEventId })}
                  />
                ))}
              </section>
            ))
          ) : (
            <p className="operations-timeline-state">Ingen hendelser matcher filteret.</p>
          )}
        </section>

        <TimelineDrawer event={selectedEvent} />
      </div>
    </main>
  );
}

export function OperationsTimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const filters = useMemo(() => parseOperationsTimelineFilters(searchText), [searchText]);
  const [timeline, setTimeline] = useState<OperationsTimelineResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    api
      .operationsTimeline(operationsTimelineQueryFromFilters(filters))
      .then((payload) => {
        if (!ignore) setTimeline(payload);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [filters, attempt]);

  function updateFilters(next: OperationsTimelineFilters) {
    setSearchParams(buildOperationsTimelineSearch(next), { replace: true });
  }

  if (loading)
    return <main className="operations-timeline-page">Henter operasjonstidslinje...</main>;
  if (error) {
    return (
      <main className="operations-timeline-page operations-timeline-error" role="alert">
        <h1>Operasjonstidslinjen kunne ikke hentes</h1>
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igjen
        </button>
      </main>
    );
  }
  if (!timeline)
    return <main className="operations-timeline-page">Ingen tidslinjedata tilgjengelig.</main>;

  return (
    <OperationsTimelineDashboard
      timeline={timeline}
      filters={filters}
      onFiltersChange={updateFilters}
    />
  );
}
