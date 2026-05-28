import { useEffect, useState } from "react";
import type { OperationsStatus } from "@nytt/shared";
import { api } from "../api.js";

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Ikke registrert";
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
