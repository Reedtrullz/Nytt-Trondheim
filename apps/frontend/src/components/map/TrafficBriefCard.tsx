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

function freshnessLabel(freshness: TrafficBrief["freshness"]) {
  switch (freshness) {
    case "fresh":
      return "ferske DATEX-data";
    case "stale":
      return "mulig foreldet DATEX-data";
    default:
      return "ukjent datferskhet";
  }
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
      <small>
        Sist oppdatert {formatGeneratedAt(brief.generatedAt)} · {freshnessLabel(brief.freshness)}
      </small>
    </section>
  );
}
