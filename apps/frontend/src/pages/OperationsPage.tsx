import { useEffect, useState } from "react";
import type { OperationsStatus, TrafficPulseCorridor } from "@nytt/shared";
import { api } from "../api.js";

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Ikke registrert";
}

function minutes(seconds?: number) {
  if (seconds === undefined) return "—";
  return `${Math.round(seconds / 60)} min`;
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

export function OperationsPage() {
  const [status, setStatus] = useState<OperationsStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api
      .operations()
      .then(setStatus)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <main className="operations-page">Kunne ikke hente driftstatus: {error}</main>;
  if (!status) return <main className="operations-page">Henter driftstatus...</main>;

  const trafficPulse = status.trafficPulse ?? [];

  return (
    <main className="operations-page">
      <header className="page-heading">
        <p className="label">Privat drift</p>
        <h1>Kilder og systemstatus</h1>
        <p>Sist innhenting {time(status.latestCollectionAt)}</p>
      </header>
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
      <section className="traffic-pulse-panel" aria-labelledby="traffic-pulse-heading">
        <div className="traffic-pulse-heading">
          <h2 id="traffic-pulse-heading">Trafikkpuls fra Vegvesen</h2>
          <p>Målt/estimert reisetid per korridor. Dette forklarer ikke årsaken til eventuell kø.</p>
        </div>
        {trafficPulse.length === 0 ? (
          <p className="traffic-pulse-empty">Ingen reisetidskorridorer registrert ennå.</p>
        ) : (
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
        )}
      </section>
      <section className="operations-detail">
        <div>
          <h2>Kilder</h2>
          {status.sources.map((source) => (
            <article className="source-row" key={source.source}>
              <span className={source.state}>{source.label}</span>
              <small>{source.detail}</small>
              <time>{time(source.lastCheckedAt)}</time>
            </article>
          ))}
        </div>
        <div className="backup-state">
          <h2>Sikkerhetskopi</h2>
          <p>
            Siste krypterte kopi: <strong>{time(status.backup?.completedAt)}</strong>
          </p>
          <p>
            Siste gjenopprettingstest: <strong>{time(status.restoreCheck?.completedAt)}</strong>
          </p>
          <p className="muted">DATEX og Politiloggen vises i kildelisten over.</p>
        </div>
      </section>
    </main>
  );
}
