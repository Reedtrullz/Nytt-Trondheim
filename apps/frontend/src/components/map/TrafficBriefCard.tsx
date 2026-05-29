import type { TrafficBrief } from "@nytt/shared";

interface TrafficBriefCardProps {
  brief: TrafficBrief;
  loading?: boolean;
  error?: string;
  onReload?: () => void;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent tid";
  return new Intl.DateTimeFormat("nb-NO", {
    timeStyle: "short",
  }).format(date);
}

export function TrafficBriefCard({ brief, loading, error, onReload }: TrafficBriefCardProps) {
  return (
    <section className={`traffic-brief-card severity-${brief.severity}`}>
      <header>
        <h2>Trafikk akkurat nå</h2>
        <button type="button" onClick={onReload} disabled={loading}>
          {loading ? "Oppdaterer ..." : "Oppdater"}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <p>{brief.headline}</p>
      <ul>
        {brief.bullets.map((bullet, index) => (
          <li key={`${index}:${bullet}`}>{bullet}</li>
        ))}
      </ul>
      {brief.freshness === "stale" ? (
        <p role="status">
          Hendelsene i kartet har ikke fått nye oppdateringer på over 30 minutter.
        </p>
      ) : null}
      <small>Brief generert {formatGeneratedAt(brief.generatedAt)}</small>
    </section>
  );
}
