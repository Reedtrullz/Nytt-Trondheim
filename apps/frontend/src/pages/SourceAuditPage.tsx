import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  provenanceLabels,
  sourceIdLabel,
  type Provenance,
  type SourceStaleDataAlertStatus,
  IncidentSourceTraceabilitySummary,
  type SourceAuditSourceSummary,
  type SourceAuditWorkspaceResponse,
  type SourceCollectorRun,
} from "@nytt/shared";
import { api } from "../api.js";
import {
  buildSourceAuditSearch,
  parseSourceAuditFilters,
  sourceAuditContractOptions,
  sourceAuditFreshnessOptions,
  sourceAuditGroupOptions,
  sourceAuditHealthOptions,
  sourceAuditQueryFromFilters,
  sourceAuditReliabilityOptions,
  sourceAuditRoleOptions,
  sourceAuditSourceOptions,
  toggleAuditFilterValue,
  type SourceAuditFilters,
} from "../sourceAuditFilters.js";

const osloFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Oslo",
});

function time(value?: string) {
  return value ? osloFormatter.format(new Date(value)) : "Ikke registrert";
}

function duration(value?: number) {
  if (value === undefined) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} sek`;
}

function healthLabel(state: SourceAuditSourceSummary["healthState"]) {
  const labels: Record<SourceAuditSourceSummary["healthState"], string> = {
    ok: "OK",
    degraded: "Degradert",
    disabled: "Avslått",
    awaiting_access: "Venter på tilgang",
  };
  return labels[state];
}

function freshnessLabel(state: SourceAuditSourceSummary["freshness"]["state"]) {
  const labels: Record<SourceAuditSourceSummary["freshness"]["state"], string> = {
    fresh: "Fersk",
    lagging: "Treg",
    stale: "Utdatert",
    unknown: "Ukjent",
  };
  return labels[state];
}

function contractLabel(state: SourceAuditSourceSummary["contractStatus"]) {
  const labels: Record<SourceAuditSourceSummary["contractStatus"], string> = {
    pass: "Bestått",
    warn: "Varsel",
    fail: "Brudd",
    not_applicable: "Ikke relevant",
  };
  return labels[state];
}

function focusSourceAuditButton(index: number) {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-source-audit-row]");
  buttons[index]?.focus();
}

function handleSourceAuditKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  total: number,
) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusSourceAuditButton(Math.min(total - 1, index + 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusSourceAuditButton(Math.max(0, index - 1));
  } else if (event.key === "Home") {
    event.preventDefault();
    focusSourceAuditButton(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusSourceAuditButton(total - 1);
  }
}

function roleLabel(role: SourceAuditSourceSummary["role"]) {
  const labels: Record<SourceAuditSourceSummary["role"], string> = {
    incident_source: "Hendelseskilde",
    context_source: "Kontekst",
    telemetry_source: "Telemetri",
    internal_analysis: "Intern analyse",
    private_annotation: "Privat markering",
  };
  return labels[role];
}

function traceStateLabel(state: IncidentSourceTraceabilitySummary["traceabilityState"]) {
  const labels: Record<IncidentSourceTraceabilitySummary["traceabilityState"], string> = {
    complete: "Komplett",
    partial: "Delvis",
    missing: "Mangler",
  };
  return labels[state];
}

function reliabilityLabel(level: SourceAuditSourceSummary["reliability"][number]["level"]) {
  const labels: Record<SourceAuditSourceSummary["reliability"][number]["level"], string> = {
    good: "God",
    watch: "Følg med",
    poor: "Svak",
    unknown: "Ukjent",
  };
  return labels[level];
}

function provenanceLabel(provenance: string): string {
  return provenanceLabels[provenance as Provenance] ?? provenance;
}

function sourceAuditAlertStatusLabel(status: SourceStaleDataAlertStatus | string): string {
  const labels: Record<SourceStaleDataAlertStatus, string> = {
    open: "Åpen",
    acknowledged: "Kvittert",
    resolved: "Løst",
  };
  return labels[status as SourceStaleDataAlertStatus] ?? status;
}

function runStatusLabel(status: SourceCollectorRun["status"]) {
  const labels: Record<SourceCollectorRun["status"], string> = {
    succeeded: "OK",
    partial: "Delvis",
    failed: "Feilet",
    skipped: "Hoppet over",
    running: "Kjører",
  };
  return labels[status];
}

function traceRelationshipLabel(
  relationship: IncidentSourceTraceabilitySummary["links"][number]["relationship"],
) {
  const labels: Record<IncidentSourceTraceabilitySummary["links"][number]["relationship"], string> =
    {
      supports: "Støtter",
      contradicts: "Motsier",
      context: "Kontekst",
      duplicate: "Duplikat",
      activation: "Aktivering",
      timeline: "Tidslinje",
      private_annotation: "Privat markering",
    };
  return labels[relationship];
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
    <fieldset className="source-audit-filter">
      <legend>{title}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={values?.includes(option.value) ?? false}
            onChange={() => {
              const next = toggleAuditFilterValue(values, option.value);
              onChange(next.length ? next : undefined);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function SourceAuditDrawer({
  source,
  runs,
  audit,
}: {
  source: SourceAuditSourceSummary | undefined;
  runs: SourceCollectorRun[];
  audit: SourceAuditWorkspaceResponse;
}) {
  if (!source) {
    return (
      <aside className="source-audit-drawer">
        <p className="label">Detalj</p>
        <h2>Velg en kilde</h2>
        <p>
          Marker en rad for å se kjøringer, kontraktsjekker, diagnostikk og situasjonskoblinger.
        </p>
      </aside>
    );
  }

  const contractChecks = audit.contractChecks.filter((check) => check.source === source.source);
  const diagnostics = audit.diagnostics?.filter((item) => item.key.startsWith(`${source.source}:`));
  const alerts = audit.alerts.filter((alert) => alert.source === source.source);
  const traces = audit.traceability.filter((trace) =>
    trace.links.some((link) => link.source === source.source),
  );
  const primaryReliability = source.reliability[0];

  return (
    <aside className="source-audit-drawer" aria-label={`Detaljer for ${source.label}`}>
      <p className="label">Kilderevisjon</p>
      <h2>{source.label}</h2>
      <div className="source-audit-badges">
        <span className={`audit-pill health-${source.healthState}`}>
          {healthLabel(source.healthState)}
        </span>
        <span className={`audit-pill freshness-${source.freshness.state}`}>
          {freshnessLabel(source.freshness.state)}
        </span>
        <span className={`audit-pill contract-${source.contractStatus}`}>
          {contractLabel(source.contractStatus)}
        </span>
      </div>
      <dl className="source-audit-facts">
        <div>
          <dt>Sist sett</dt>
          <dd>{time(source.freshness.lastObservedAt)}</dd>
        </div>
        <div>
          <dt>Neste innhenting</dt>
          <dd>{time(source.freshness.nextPollAt)}</dd>
        </div>
        <div>
          <dt>Rolle</dt>
          <dd>{roleLabel(source.role)}</dd>
        </div>
        <div>
          <dt>Proveniens</dt>
          <dd>{provenanceLabel(source.provenance)}</dd>
        </div>
        <div>
          <dt>Pålitelighet</dt>
          <dd>
            {primaryReliability
              ? `${reliabilityLabel(primaryReliability.level)}${
                  primaryReliability.score
                    ? ` · ${Math.round(primaryReliability.score * 100)} %`
                    : ""
                }`
              : "Ukjent"}
          </dd>
        </div>
      </dl>
      <section>
        <h3>Varsler</h3>
        {alerts.length ? (
          <div className="source-audit-checks">
            {alerts.map((alert) => (
              <article key={alert.id} className={`alert-${alert.severity}`}>
                <strong>{alert.severity === "critical" ? "Kritisk" : "Tilsyn"}</strong>
                <span>{sourceAuditAlertStatusLabel(alert.status)}</span>
                <small>{alert.message}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Ingen åpne varsler om utdaterte data.</p>
        )}
      </section>
      <section>
        <h3>Kjøringshistorikk</h3>
        {runs.length ? (
          <div className="source-audit-run-list">
            {runs.slice(0, 6).map((run) => (
              <article key={run.id}>
                <span className={`audit-dot run-${run.status}`} />
                <div>
                  <strong>{runStatusLabel(run.status)}</strong>
                  <small>
                    {time(run.completedAt ?? run.startedAt)} · {duration(run.durationMs)}
                  </small>
                </div>
                <small>
                  {run.recordsAccepted} inn · {run.recordsRejected} avvik
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Ingen kjøringer registrert ennå.</p>
        )}
      </section>
      <section>
        <h3>Kontraktsjekker</h3>
        {contractChecks.length ? (
          <div className="source-audit-checks">
            {contractChecks.map((check) => (
              <article key={check.id} className={`contract-${check.status}`}>
                <strong>{check.label}</strong>
                <span>{contractLabel(check.status)}</span>
                <small>{check.detail}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Ingen kontraktsjekker er registrert for denne kilden ennå.</p>
        )}
      </section>
      <section>
        <h3>Diagnostikk</h3>
        {diagnostics?.length ? (
          <div className="source-audit-diagnostics">
            {diagnostics.map((item) => (
              <article key={item.key}>
                <span>{item.label}</span>
                <strong>{String(item.value ?? "—")}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Ingen ikke-hemmelig diagnostikk for valgt filter.</p>
        )}
      </section>
      <section>
        <h3>Koblet til situasjoner</h3>
        {traces.length ? (
          <div className="source-audit-trace-list">
            {traces.slice(0, 6).map((trace) => (
              <Link key={trace.situationId} to={`/situasjoner/${trace.situationId}`}>
                <strong>{trace.title}</strong>
                <small>
                  {trace.sourceCount} kilder · {traceStateLabel(trace.traceabilityState)}
                </small>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">Ingen situasjonskoblinger funnet.</p>
        )}
      </section>
    </aside>
  );
}

export function SourceAuditDashboard({
  audit,
  filters,
  onFiltersChange,
}: {
  audit: SourceAuditWorkspaceResponse;
  filters: SourceAuditFilters;
  onFiltersChange: (filters: SourceAuditFilters) => void;
}) {
  const selectedSource =
    audit.sources.find((source) => source.source === filters.selectedSource) ?? audit.sources[0];
  const selectedRuns = selectedSource
    ? audit.collectorRuns.filter((run) => run.source === selectedSource.source)
    : [];
  const alertCount = audit.alerts.filter((alert) => alert.status === "open").length;
  const contractWarnings = audit.contractChecks.filter((check) =>
    ["warn", "fail"].includes(check.status),
  ).length;
  const traceCount = audit.traceability.reduce((count, trace) => count + trace.links.length, 0);

  function update(next: Partial<SourceAuditFilters>) {
    const selectionOnly = Object.keys(next).length === 1 && "selectedSource" in next;
    onFiltersChange({
      ...filters,
      ...(selectionOnly ? {} : { cursor: undefined, selectedSource: undefined }),
      ...next,
    });
  }

  return (
    <main className="source-audit-page">
      <header className="source-audit-hero">
        <div>
          <p className="label">Privat drift</p>
          <h1>Kildehelse og proveniens</h1>
          <p>
            Revisjon av innhenting, kontrakter og kildekoblinger. Viser bare ikke-hemmelig
            diagnostikk.
          </p>
        </div>
        <div className="source-audit-actions">
          <Link className="source-audit-backlink" to="/drift/tidslinje">
            Tidslinje
          </Link>
          <Link className="source-audit-backlink" to="/drift">
            Til drift
          </Link>
        </div>
      </header>

      <section className="source-audit-summary" aria-label="Revisjonsoppsummering">
        <article>
          <strong>{audit.sources.length}</strong>
          <span>Kilder i filter</span>
        </article>
        <article>
          <strong>{alertCount}</strong>
          <span>Åpne varsler</span>
        </article>
        <article>
          <strong>{audit.collectorRuns.length}</strong>
          <span>Kjøringer</span>
        </article>
        <article>
          <strong>{contractWarnings}</strong>
          <span>Kontraktvarsler</span>
        </article>
        <article>
          <strong>{traceCount}</strong>
          <span>Kildekoblinger</span>
        </article>
      </section>

      <div className="source-audit-grid">
        <aside className="source-audit-sidebar" aria-label="Kildefiltre">
          <label className="source-audit-search">
            <span>Søk</span>
            <input
              value={filters.q ?? ""}
              onChange={(event) => update({ q: event.target.value || undefined })}
              placeholder="Søk i kilder"
            />
          </label>
          <label className="source-audit-toggle">
            <input
              type="checkbox"
              checked={filters.staleOnly ?? false}
              onChange={(event) => update({ staleOnly: event.target.checked || undefined })}
            />
            <span>Vis bare kilder som trenger tilsyn</span>
          </label>
          <FilterCheckboxGroup
            title="Kilder"
            values={filters.sources}
            options={sourceAuditSourceOptions}
            onChange={(sources) => update({ sources })}
          />
          <FilterCheckboxGroup
            title="Gruppe"
            values={filters.groups}
            options={sourceAuditGroupOptions}
            onChange={(groups) => update({ groups })}
          />
          <FilterCheckboxGroup
            title="Rolle"
            values={filters.roles}
            options={sourceAuditRoleOptions}
            onChange={(roles) => update({ roles })}
          />
          <FilterCheckboxGroup
            title="Kildehelse"
            values={filters.healthStates}
            options={sourceAuditHealthOptions}
            onChange={(healthStates) => update({ healthStates })}
          />
          <FilterCheckboxGroup
            title="Ferskhet"
            values={filters.freshnessStates}
            options={sourceAuditFreshnessOptions}
            onChange={(freshnessStates) => update({ freshnessStates })}
          />
          <FilterCheckboxGroup
            title="Pålitelighet"
            values={filters.reliabilityLevels}
            options={sourceAuditReliabilityOptions}
            onChange={(reliabilityLevels) => update({ reliabilityLevels })}
          />
          <FilterCheckboxGroup
            title="Kontrakt"
            values={filters.contractStatuses}
            options={sourceAuditContractOptions}
            onChange={(contractStatuses) => update({ contractStatuses })}
          />
        </aside>

        <section className="source-audit-table-panel" aria-labelledby="source-audit-table-heading">
          <div className="source-audit-panel-heading">
            <div>
              <p className="label">Status per kilde</p>
              <h2 id="source-audit-table-heading">Revisjonskonsoll</h2>
            </div>
            <div className="source-audit-heading-actions">
              <time>{time(audit.generatedAt)}</time>
              {audit.nextCursor ? (
                <button
                  type="button"
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      cursor: audit.nextCursor,
                      selectedSource: undefined,
                    })
                  }
                >
                  Neste side
                </button>
              ) : null}
            </div>
          </div>
          {audit.sources.length === 0 ? (
            <p className="source-audit-empty">Ingen kilder matcher filteret.</p>
          ) : (
            <div className="source-audit-table" role="table" aria-label="Kilderevisjon">
              <div className="source-audit-row header" role="row">
                <span>Kilde</span>
                <span>Helse</span>
                <span>Ferskhet</span>
                <span>Kontrakt</span>
                <span>Siste kjøring</span>
                <span>Spor</span>
              </div>
              {audit.sources.map((source, index) => {
                const selected = selectedSource?.source === source.source;
                const traces = audit.traceability.filter((trace) =>
                  trace.links.some((link) => link.source === source.source),
                );
                return (
                  <button
                    type="button"
                    className={`source-audit-row ${selected ? "selected" : ""}`}
                    key={source.source}
                    data-source-audit-row
                    onClick={() => update({ selectedSource: source.source })}
                    onKeyDown={(event) =>
                      handleSourceAuditKeyDown(event, index, audit.sources.length)
                    }
                  >
                    <span>
                      <strong>{source.label}</strong>
                      <small>{source.source}</small>
                    </span>
                    <span className={`audit-pill health-${source.healthState}`}>
                      {healthLabel(source.healthState)}
                    </span>
                    <span className={`audit-pill freshness-${source.freshness.state}`}>
                      {freshnessLabel(source.freshness.state)}
                    </span>
                    <span className={`audit-pill contract-${source.contractStatus}`}>
                      {contractLabel(source.contractStatus)}
                    </span>
                    <span>
                      <strong>
                        {source.latestRun
                          ? runStatusLabel(source.latestRun.status)
                          : "Ingen kjøring"}
                      </strong>
                      <small>{duration(source.latestRun?.durationMs)}</small>
                    </span>
                    <span>
                      <strong>{traces.length}</strong>
                      <small>situasjoner</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <section className="source-audit-history" aria-labelledby="source-audit-history-heading">
            <div className="source-audit-panel-heading">
              <div>
                <p className="label">Worker</p>
                <h2 id="source-audit-history-heading">Siste kjøringer</h2>
              </div>
            </div>
            {audit.collectorRuns.length ? (
              <div className="source-audit-history-list">
                {audit.collectorRuns.slice(0, 12).map((run) => (
                  <article key={run.id}>
                    <span className={`audit-dot run-${run.status}`} />
                    <div>
                      <strong>{run.collector}</strong>
                      <small>
                        {runStatusLabel(run.status)} · {time(run.completedAt ?? run.startedAt)}
                      </small>
                    </div>
                    <span>{duration(run.durationMs)}</span>
                    <span>
                      {run.recordsAccepted} inn / {run.recordsRejected} avvik
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="source-audit-empty">Ingen worker-kjøringer registrert ennå.</p>
            )}
          </section>

          <section
            className="source-audit-trace-panel"
            aria-labelledby="source-audit-trace-heading"
          >
            <div className="source-audit-panel-heading">
              <div>
                <p className="label">Proveniens</p>
                <h2 id="source-audit-trace-heading">Situasjonsspor</h2>
              </div>
            </div>
            {audit.traceability.length ? (
              <div className="source-audit-trace-table">
                {audit.traceability.slice(0, 8).map((trace) => (
                  <article key={trace.situationId}>
                    <div>
                      <Link to={`/situasjoner/${trace.situationId}`}>{trace.title}</Link>
                      <small>
                        {trace.sourceCount} kilder · {trace.evidenceCount} bevis ·{" "}
                        {trace.privateAnnotationCount} private markeringer
                      </small>
                    </div>
                    <div className="source-audit-trace-links">
                      {trace.links.slice(0, 5).map((link, index) => (
                        <span key={`${trace.situationId}-${link.source}-${index}`}>
                          {sourceIdLabel(link.source)} · {traceRelationshipLabel(link.relationship)}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="source-audit-empty">Ingen situasjonsspor matcher filteret.</p>
            )}
          </section>
        </section>

        <SourceAuditDrawer source={selectedSource} runs={selectedRuns} audit={audit} />
      </div>
    </main>
  );
}

export function SourceAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const filters = useMemo(() => parseSourceAuditFilters(searchText), [searchText]);
  const [audit, setAudit] = useState<SourceAuditWorkspaceResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    api
      .sourceAudit(sourceAuditQueryFromFilters(filters))
      .then((payload) => {
        if (!ignore) setAudit(payload);
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

  function updateFilters(next: SourceAuditFilters) {
    const search = buildSourceAuditSearch(next);
    setSearchParams(search, { replace: true });
  }

  if (loading) return <main className="source-audit-page">Henter kilderevisjon...</main>;
  if (error) {
    return (
      <main className="source-audit-page source-audit-error" role="alert">
        <h1>Kilderevisjon kunne ikke hentes</h1>
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igjen
        </button>
      </main>
    );
  }
  if (!audit) return <main className="source-audit-page">Ingen revisjonsdata tilgjengelig.</main>;

  return <SourceAuditDashboard audit={audit} filters={filters} onFiltersChange={updateFilters} />;
}
