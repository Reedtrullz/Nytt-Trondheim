import { useEffect, useMemo, useState } from "react";
import type {
  OperationsStatus,
  RuntimeFreshness,
  TrafficPulseCorridor,
  WorkerCycleMetrics,
} from "@nytt/shared";
import { api } from "../api.js";
import { DashboardGrid, type DashboardWidgetDefinition } from "../components/DashboardGrid.js";

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function minutes(seconds?: number) {
  if (seconds === undefined) return "—";
  return `${Math.round(seconds / 60)} min`;
}

function milliseconds(value?: number) {
  if (value === undefined) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} sek`;
}

function delayText(delaySeconds?: number) {
  if (delaySeconds === undefined) return "Forsinkelse ukjent";
  if (delaySeconds <= 0) return "Ingen forsinkelse";
  return `${Math.max(1, Math.round(delaySeconds / 60))} min forsinkelse`;
}

function trafficStateLabel(state: TrafficPulseCorridor["state"]) {
  const labels: Record<TrafficPulseCorridor["state"], string> = {
    free_flow: "Fri flyt",
    slow: "Sakte",
    congested: "Kø",
    stale: "Utdatert",
  };

  return labels[state];
}

function slowestSource(
  metrics: WorkerCycleMetrics | undefined,
  sources: OperationsStatus["sources"],
) {
  if (!metrics) return undefined;
  const [source, durationMs] = Object.entries(metrics.sourceDurationsMs).sort(
    ([, left], [, right]) => right - left,
  )[0] ?? [undefined, undefined];
  if (!source || durationMs === undefined) return undefined;
  return {
    source,
    label: sources.find((candidate) => candidate.source === source)?.label ?? source,
    durationMs,
  };
}

function parseFailureText(metrics?: WorkerCycleMetrics) {
  if (!metrics) return "—";
  return String(Object.values(metrics.parseFailures).reduce((sum, count) => sum + count, 0));
}

function sourceItemCountText(metrics?: WorkerCycleMetrics) {
  if (!metrics) return "Ingen fullført worker-syklus";
  const count = Object.values(metrics.sourceItemCounts).reduce((sum, count) => sum + count, 0);
  return `${count} operasjonelle objekter i siste syklus`;
}

function staleSourceCount(status: OperationsStatus) {
  return status.sources.filter((source) => source.state !== "ok" || source.activeAlerts?.length)
    .length;
}

function freshnessLabel(entry?: RuntimeFreshness) {
  if (!entry) return "Ukjent";
  if (entry.status === "ok") return "OK";
  if (entry.status === "stale") return "Utdatert";
  return "Mangler";
}

function freshnessDetail(entry?: RuntimeFreshness) {
  return entry?.detail ?? "Ingen status registrert.";
}

function CommandLinksWidget() {
  return (
    <div className="command-link-grid">
      <a className="operations-audit-link" href="/command/tilgang">
        Åpne tilgangsforespørsler
      </a>
      <a className="operations-audit-link" href="/command/dekning">
        Åpne dekningsgrupper
      </a>
      <a className="operations-audit-link" href="/command/tidslinje">
        Åpne tidslinje
      </a>
      <a className="operations-audit-link" href="/command/varsler">
        Åpne varselutløsere
      </a>
      <a className="operations-audit-link" href="/command/romlig">
        Åpne romlig analyse
      </a>
      <a className="operations-audit-link" href="/command/radata">
        Åpne rådata
      </a>
      <a className="operations-audit-link" href="/command/kilder">
        Åpne kilderevisjon
      </a>
    </div>
  );
}

function OperationsSummaryTiles({ status }: { status: OperationsStatus }) {
  return (
    <div className="operations-summary">
      <article>
        <strong>{status.articleCount}</strong>
        <span>Innhentede saker</span>
      </article>
      <article>
        <strong>{status.situationCounts.preliminary + status.situationCounts.active}</strong>
        <span>Aktuelle situasjoner</span>
      </article>
      <article>
        <strong>{status.situationCounts.dismissed}</strong>
        <span>Avviste feilkoblinger</span>
      </article>
      <article>
        <strong>{status.latestAiRun?.status ?? "Ukjent"}</strong>
        <span>DeepSeek · {time(status.latestAiRun?.completedAt)}</span>
      </article>
    </div>
  );
}

function WorkerMetricsWidget({
  workerMetrics,
  slowest,
  parseFailures,
  sourceItems,
  staleSources,
  status,
}: {
  workerMetrics?: WorkerCycleMetrics;
  slowest?: { label: string; durationMs: number };
  parseFailures: string;
  sourceItems: string;
  staleSources: number;
  status: OperationsStatus;
}) {
  return (
    <>
      <p className="dashboard-widget-note">
        Rå driftstall fra siste fullførte innhenting. Dette er ikke hendelsesbevis og legges ikke i
        kildeloggen.
      </p>
      <div className="worker-metrics-grid">
        <article>
          <span>Siste syklus</span>
          <strong>{milliseconds(workerMetrics?.cycleDurationMs)}</strong>
          <small>{time(workerMetrics?.cycleCompletedAt)}</small>
        </article>
        <article>
          <span>Tregeste kilde</span>
          <strong>{slowest ? slowest.label : "—"}</strong>
          <small>{slowest ? milliseconds(slowest.durationMs) : "Ingen måling"}</small>
        </article>
        <article>
          <span>Parsefeil</span>
          <strong>{parseFailures}</strong>
          <small>{sourceItems}</small>
        </article>
        <article>
          <span>Kilder som trenger tilsyn</span>
          <strong>{staleSources}</strong>
          <small>Ikke-OK i kildelisten</small>
        </article>
        <article>
          <span>Worker</span>
          <strong>{freshnessLabel(status.workerFreshness)}</strong>
          <small>{freshnessDetail(status.workerFreshness)}</small>
        </article>
        <article>
          <span>Sikkerhetskopi</span>
          <strong>{freshnessLabel(status.backup)}</strong>
          <small>{freshnessDetail(status.backup)}</small>
        </article>
        <article>
          <span>Gjenopprettingstest</span>
          <strong>{freshnessLabel(status.restoreCheck)}</strong>
          <small>{freshnessDetail(status.restoreCheck)}</small>
        </article>
      </div>
    </>
  );
}

function TrafficPulseWidget({ trafficPulse }: { trafficPulse: TrafficPulseCorridor[] }) {
  if (trafficPulse.length === 0) {
    return <p className="traffic-pulse-empty">Ingen reisetidskorridorer registrert ennå.</p>;
  }
  return (
    <div className="traffic-pulse-list">
      {trafficPulse.map((corridor) => (
        <article className={`traffic-pulse-row ${corridor.state}`} key={corridor.id}>
          <div>
            <h3>{corridor.name}</h3>
            <span className="traffic-pulse-state">{trafficStateLabel(corridor.state)}</span>
          </div>
          <dl>
            <div>
              <dt>Forsinkelse</dt>
              <dd>{delayText(corridor.delaySeconds)}</dd>
            </div>
            <div>
              <dt>Reisetid</dt>
              <dd>{minutes(corridor.travelTimeSeconds)}</dd>
            </div>
            <div>
              <dt>Fri flyt</dt>
              <dd>{minutes(corridor.freeFlowSeconds)}</dd>
            </div>
            <div>
              <dt>Målt</dt>
              <dd>{time(corridor.measurementTo ?? corridor.updatedAt)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function SourceStateWidget({ status }: { status: OperationsStatus }) {
  return (
    <div className="source-state-list">
      {status.sources.map((source) => (
        <article className="source-row" key={source.source}>
          <span className={source.state}>{source.label}</span>
          <small>{source.detail}</small>
          <time>{time(source.lastCheckedAt)}</time>
        </article>
      ))}
    </div>
  );
}

function BackupStateWidget({ status }: { status: OperationsStatus }) {
  return (
    <div className="backup-state">
      <p>
        Siste krypterte kopi: <strong>{time(status.backup?.completedAt)}</strong>
        <br />
        <span>{freshnessDetail(status.backup)}</span>
      </p>
      <p>
        Siste gjenopprettingstest: <strong>{time(status.restoreCheck?.completedAt)}</strong>
        <br />
        <span>{freshnessDetail(status.restoreCheck)}</span>
      </p>
      <p className="muted">DATEX og Politiloggen vises i kildelisten.</p>
    </div>
  );
}

export function OperationsDashboard({ status }: { status: OperationsStatus }) {
  const trafficPulse = status.trafficPulse ?? [];
  const workerMetrics = status.workerCycleMetrics;
  const slowest = slowestSource(workerMetrics, status.sources);
  const parseFailures = parseFailureText(workerMetrics);
  const sourceItems = sourceItemCountText(workerMetrics);
  const staleSources = staleSourceCount(status);
  const widgets = useMemo<DashboardWidgetDefinition[]>(
    () => [
      {
        id: "overview",
        title: "Situasjonsbilde",
        description: "Nøkkeltall for innhentede saker, åpne situasjoner og AI-status.",
        defaultSize: "wide",
        children: <OperationsSummaryTiles status={status} />,
      },
      {
        id: "worker",
        title: "Worker-syklus",
        description: "Operasjonell telemetri fra siste fullførte innhenting.",
        defaultSize: "large",
        children: (
          <WorkerMetricsWidget
            workerMetrics={workerMetrics}
            slowest={slowest}
            parseFailures={parseFailures}
            sourceItems={sourceItems}
            staleSources={staleSources}
            status={status}
          />
        ),
      },
      {
        id: "traffic-pulse",
        title: "Trafikkpuls fra Vegvesen",
        description: "Målt/estimert reisetid per korridor uten å anta årsak.",
        defaultSize: "wide",
        children: <TrafficPulseWidget trafficPulse={trafficPulse} />,
      },
      {
        id: "shortcuts",
        title: "Analyseverktøy",
        description: "Direkte innganger til de private Command Center-flatene.",
        defaultSize: "standard",
        children: <CommandLinksWidget />,
      },
      {
        id: "sources",
        title: "Kilder",
        description: "Adapterstatus, ferskhet og kildevarsler.",
        defaultSize: "large",
        children: <SourceStateWidget status={status} />,
      },
      {
        id: "backup",
        title: "Sikkerhetskopi",
        description: "Backup- og restore-ferskhet for driftsberedskap.",
        defaultSize: "standard",
        children: <BackupStateWidget status={status} />,
      },
    ],
    [parseFailures, slowest, sourceItems, staleSources, status, trafficPulse, workerMetrics],
  );

  return (
    <main className="operations-page">
      <header className="page-heading">
        <p className="label">Privat kommandosenter</p>
        <h1>Kommandosenter</h1>
        <p>Sist innhenting {time(status.latestCollectionAt)}</p>
      </header>
      <DashboardGrid
        ariaLabel="Kommandosenter-moduler"
        storageKey="nytt-command-dashboard-v1"
        widgets={widgets}
      />
    </main>
  );
}

export function OperationsPage() {
  const [status, setStatus] = useState<OperationsStatus>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(undefined);
    void api
      .operations()
      .then(setStatus)
      .catch((reason: Error) => setError(reason.message));
  }, [attempt]);

  if (error) {
    return (
      <main className="operations-page" role="alert">
        <p>Kunne ikke hente driftstatus: {error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igjen
        </button>
      </main>
    );
  }
  if (!status) return <main className="operations-page">Henter driftstatus...</main>;

  return <OperationsDashboard status={status} />;
}
