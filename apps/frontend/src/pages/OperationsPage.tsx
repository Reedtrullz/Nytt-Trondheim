import { useEffect, useMemo, useState } from "react";
import type {
  CommandCenterBriefingPayload,
  NotificationTriggerCandidate,
  NotificationTriggerPage,
  OperationsStatus,
  RuntimeFreshness,
  SourceHealth,
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

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
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

function sourceItemCount(metrics?: WorkerCycleMetrics) {
  if (!metrics) return 0;
  return Object.values(metrics.sourceItemCounts).reduce((sum, count) => sum + count, 0);
}

const nonActionableAttentionSources = new Set<SourceHealth["source"]>([
  "deepseek",
  "internal",
  "private_annotations",
  "web_push",
]);

function staleSourceCount(status: OperationsStatus) {
  return status.sources.filter(
    (source) =>
      !nonActionableAttentionSources.has(source.source) &&
      (source.state !== "ok" || source.activeAlerts?.length),
  ).length;
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

type CommandToolTone = "ok" | "watch" | "idle";

interface CommandTool {
  title: string;
  capability: string;
  href: string;
  cta: string;
  status: string;
  detail: string;
  tone: CommandToolTone;
}

function commandTools({
  status,
  briefing,
  notificationTriggers,
  staleSources,
  sourceItems,
}: {
  status: OperationsStatus;
  briefing?: CommandCenterBriefingPayload;
  notificationTriggers?: NotificationTriggerPage;
  staleSources: number;
  sourceItems: number;
}): CommandTool[] {
  const activeSituations = status.situationCounts.preliminary + status.situationCounts.active;
  const readyPush = notificationTriggers?.pushStatus?.readyCandidates ?? 0;
  const blockedPush = notificationTriggers?.pushStatus?.blockedCandidates ?? 0;
  const sourceAttention = staleSources;

  return [
    {
      title: "Brief-revisjon",
      capability: "AI Summary Generator",
      href: "/command/brief",
      cta: "Åpne brief-revisjon",
      status: briefing?.morningBrief ? "Brief klar" : "Venter på brief",
      detail: briefing?.latestAiRun?.model ?? "Viser AI-spor når worker har kjørt.",
      tone: briefing?.morningBrief ? "ok" : "idle",
    },
    {
      title: "Dekningsgrupper",
      capability: "Event Clustering",
      href: "/command/dekning",
      cta: "Åpne dekningsgrupper",
      status: "Lesbar audit",
      detail: "Forklarer hvorfor saker ble samlet eller holdt adskilt.",
      tone: "ok",
    },
    {
      title: "Operasjonstidslinje",
      capability: "Source Traceability",
      href: "/command/tidslinje",
      cta: "Åpne tidslinje",
      status: `${activeSituations} aktuelle situasjoner`,
      detail: `Siste innhenting ${time(status.latestCollectionAt)}.`,
      tone: activeSituations > 0 ? "ok" : "idle",
    },
    {
      title: "Varselutløsere",
      capability: "Push Notification Trigger",
      href: "/command/varsler",
      cta: "Åpne varselutløsere",
      status: `${readyPush} klare · ${blockedPush} blokkert`,
      detail: notificationTriggers?.pushStatus?.detail ?? "Krever Web Push-status fra API.",
      tone: blockedPush > 0 ? "watch" : readyPush > 0 ? "ok" : "idle",
    },
    {
      title: "Romlig analyse",
      capability: "PostGIS Heatmaps",
      href: "/command/romlig",
      cta: "Åpne romlig analyse",
      status: `${status.trafficPulse?.length ?? 0} korridorer`,
      detail: "Varmepunkt og uforklarte DATEX-forsinkelser.",
      tone: (status.trafficPulse?.length ?? 0) > 0 ? "ok" : "idle",
    },
    {
      title: "Rådata-inspektør",
      capability: "Raw Data Inspector",
      href: "/command/radata",
      cta: "Åpne rådata",
      status: sourceItems > 0 ? `${sourceItems} objekter` : "Venter på objekter",
      detail: "Sanitert råpayload for kilder, telemetri og AI-kjøringer.",
      tone: sourceItems > 0 ? "ok" : "idle",
    },
    {
      title: "Kilderevisjon",
      capability: "Source Health",
      href: "/command/kilder",
      cta: "Åpne kilderevisjon",
      status: sourceAttention > 0 ? `${sourceAttention} trenger tilsyn` : "Ingen åpne tilsyn",
      detail: "Adapterferskhet, kontraktstatus og spor til tidslinje.",
      tone: sourceAttention > 0 ? "watch" : "ok",
    },
    {
      title: "Tilgang",
      capability: "Auth Gate",
      href: "/command/tilgang",
      cta: "Åpne tilgang",
      status: "Eierstyrt",
      detail: "Godkjenn, avvis eller gi lesetilgang uten forespørsel.",
      tone: "ok",
    },
  ];
}

function CommandLinksWidget({
  status,
  briefing,
  notificationTriggers,
  staleSources,
  sourceItems,
}: {
  status: OperationsStatus;
  briefing?: CommandCenterBriefingPayload;
  notificationTriggers?: NotificationTriggerPage;
  staleSources: number;
  sourceItems: number;
}) {
  const tools = commandTools({ status, briefing, notificationTriggers, staleSources, sourceItems });

  return (
    <div className="command-tool-grid">
      {tools.map((tool) => (
        <a className={`command-tool-card ${tool.tone}`} href={tool.href} key={tool.href}>
          <span>{tool.capability}</span>
          <strong>{tool.title}</strong>
          <small>{tool.status}</small>
          <p>{tool.detail}</p>
          <b>{tool.cta}</b>
        </a>
      ))}
    </div>
  );
}

const notificationSeverityLabels: Record<NotificationTriggerCandidate["severity"], string> = {
  critical: "Kritisk",
  warning: "Varsel",
  watch: "Følg med",
};

const notificationKindLabels: Record<NotificationTriggerCandidate["kind"], string> = {
  public_safety: "Sikkerhet",
  traffic_disruption: "Trafikk",
  weather_hazard: "Vær",
  service_disruption: "Driftsbrudd",
};

function NotificationBridgeWidget({ page }: { page?: NotificationTriggerPage }) {
  if (!page) {
    return (
      <div className="notification-bridge-widget">
        <p className="dashboard-widget-note">
          Varselutløsere beregnes separat fra driftstatus. Åpne verktøyet for siste kandidater og
          Web Push-status.
        </p>
        <a className="operations-audit-link" href="/command/varsler">
          Åpne varselutløsere
        </a>
      </div>
    );
  }

  const activeCandidates = page.items.filter((item) => item.severity !== "watch");
  const topCandidates = activeCandidates.length
    ? activeCandidates.slice(0, 3)
    : page.items.slice(0, 3);
  const pushStatus = page.pushStatus;
  const publicVisibleCount = page.items.filter(
    (candidate) => candidate.publicSurface.state === "visible",
  ).length;

  return (
    <div className="notification-bridge-widget">
      <div className="notification-bridge-meta">
        <article>
          <span>Kritisk</span>
          <strong>{page.summary.critical}</strong>
          <small>{page.summary.warning} varsel</small>
        </article>
        <article>
          <span>Offentlig</span>
          <strong>{publicVisibleCount}</strong>
          <small>{page.summary.officialBacked} kildebacket</small>
        </article>
        <article>
          <span>Push</span>
          <strong>{pushStatus?.label ?? "Ukjent"}</strong>
          <small>
            {pushStatus
              ? `${pushStatus.readyCandidates} klare · ${pushStatus.deliveryCounts.sent} sendt`
              : "Venter på kanalstatus"}
          </small>
        </article>
      </div>
      {topCandidates.length ? (
        <div className="notification-bridge-candidates">
          {topCandidates.map((candidate) => (
            <article className={`notification-bridge-row ${candidate.severity}`} key={candidate.id}>
              <div>
                <span>
                  {notificationKindLabels[candidate.kind]} ·{" "}
                  {notificationSeverityLabels[candidate.severity]}
                </span>
                <strong>{candidate.title}</strong>
                <small>{candidate.sourceLabels.join(", ") || candidate.sourceIds.join(", ")}</small>
                <small>{candidate.publicSurface.label}</small>
              </div>
              <b>{percent(candidate.score)}</b>
            </article>
          ))}
        </div>
      ) : (
        <p className="dashboard-widget-note">Ingen høyeffektskandidater akkurat nå.</p>
      )}
      <a className="operations-audit-link" href="/command/varsler">
        Åpne varselutløsere
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
        <strong>{status.situationPublicationCounts.public}</strong>
        <span>{status.situationPublicationCounts.command_center} kun Command Center</span>
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

function IntelligenceBridgeWidget({ briefing }: { briefing?: CommandCenterBriefingPayload }) {
  if (!briefing) {
    return (
      <div className="intelligence-bridge-widget">
        <p className="dashboard-widget-note">
          Brief-revisjon hentes separat fra driftsstatus. Åpne verktøyet for siste lagrede brief.
        </p>
        <a className="operations-audit-link" href="/command/brief">
          Åpne brief-revisjon
        </a>
      </div>
    );
  }

  return (
    <div className="intelligence-bridge-widget">
      <div className="intelligence-bridge-meta">
        <article>
          <span>Brief</span>
          <strong>{briefing.morningBrief?.mode ?? "Mangler"}</strong>
          <small>{time(briefing.morningBrief?.generatedAt ?? briefing.generatedAt)}</small>
        </article>
        <article>
          <span>AI</span>
          <strong>{briefing.latestAiRun?.status ?? "Ikke registrert"}</strong>
          <small>{briefing.latestAiRun?.model ?? "Ingen kjøring"}</small>
        </article>
        <article>
          <span>Tilsyn</span>
          <strong>{briefing.sourceHealthSummary.attention}</strong>
          <small>
            {briefing.sourceHealthSummary.ok}/{briefing.sourceHealthSummary.total} kilder OK
          </small>
        </article>
      </div>
      {briefing.morningBrief ? (
        <ol className="intelligence-bridge-paragraphs">
          {briefing.morningBrief.paragraphs.map((paragraph, index) => (
            <li key={`${index}:${paragraph}`}>{paragraph}</li>
          ))}
        </ol>
      ) : (
        <p className="dashboard-widget-note">Ingen lagret morgenbrief ennå.</p>
      )}
      <a className="operations-audit-link" href="/command/brief">
        Åpne brief-revisjon
      </a>
    </div>
  );
}

export function OperationsDashboard({
  status,
  briefing,
  notificationTriggers,
}: {
  status: OperationsStatus;
  briefing?: CommandCenterBriefingPayload;
  notificationTriggers?: NotificationTriggerPage;
}) {
  const trafficPulse = status.trafficPulse ?? [];
  const workerMetrics = status.workerCycleMetrics;
  const slowest = slowestSource(workerMetrics, status.sources);
  const parseFailures = parseFailureText(workerMetrics);
  const sourceItems = sourceItemCountText(workerMetrics);
  const sourceItemTotal = sourceItemCount(workerMetrics);
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
        id: "briefing",
        title: "Intelligence Bridge",
        description: "Morgenbrief, AI-spor og støttegrunnlag for offentlig bypuls.",
        defaultSize: "wide",
        children: <IntelligenceBridgeWidget briefing={briefing} />,
      },
      {
        id: "notifications",
        title: "Varselbro",
        description: "Høyeffektskandidater og Web Push-klargjøring for operatørvarsler.",
        defaultSize: "wide",
        children: <NotificationBridgeWidget page={notificationTriggers} />,
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
        title: "Command Center-matrise",
        description: "Hva hver privat flate beviser, og hvor den henter status fra.",
        defaultSize: "large",
        children: (
          <CommandLinksWidget
            status={status}
            briefing={briefing}
            notificationTriggers={notificationTriggers}
            staleSources={staleSources}
            sourceItems={sourceItemTotal}
          />
        ),
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
    [
      briefing,
      notificationTriggers,
      parseFailures,
      slowest,
      sourceItems,
      staleSources,
      status,
      trafficPulse,
      workerMetrics,
    ],
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
  const [briefing, setBriefing] = useState<CommandCenterBriefingPayload>();
  const [notificationTriggers, setNotificationTriggers] = useState<NotificationTriggerPage>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setStatus(undefined);
    setBriefing(undefined);
    setNotificationTriggers(undefined);
    void api
      .operations()
      .then((nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        void api
          .commandBriefing()
          .then((nextBriefing) => {
            if (!cancelled) setBriefing(nextBriefing);
          })
          .catch(() => {
            // Keep the Command Center usable if the derived briefing review is temporarily unavailable.
          });
        void api
          .notificationTriggers({ limit: 4 })
          .then((nextTriggers) => {
            if (!cancelled) setNotificationTriggers(nextTriggers);
          })
          .catch(() => {
            // Keep the Command Center usable if notification analysis is temporarily unavailable.
          });
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
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

  return (
    <OperationsDashboard
      status={status}
      briefing={briefing}
      notificationTriggers={notificationTriggers}
    />
  );
}
