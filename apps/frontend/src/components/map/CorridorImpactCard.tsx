import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";

interface CorridorImpactCardProps {
  impacts: TrafficCorridorImpact[];
  events: TrafficMapEvent[];
  selectedImpactId?: string;
  onSelectImpact: (impactId?: string) => void;
}

function severityLabel(severity: TrafficCorridorImpact["highestSeverity"]) {
  switch (severity) {
    case "critical":
      return "kritisk";
    case "high":
      return "høy";
    case "medium":
      return "middels";
    default:
      return "lav";
  }
}

export function CorridorImpactCard({
  impacts,
  events,
  selectedImpactId,
  onSelectImpact,
}: CorridorImpactCardProps) {
  const selectedImpact = impacts.find((impact) => impact.id === selectedImpactId);
  const affectedEvents = selectedImpact
    ? selectedImpact.affectedEventIds
        .map((eventId) => events.find((event) => event.id === eventId))
        .filter((event): event is TrafficMapEvent => Boolean(event))
    : [];

  return (
    <section className="corridor-impact-card">
      <header>
        <h2>Korridorpåvirkning</h2>
        {selectedImpact ? (
          <button type="button" onClick={() => onSelectImpact(undefined)}>
            Nullstill
          </button>
        ) : null}
      </header>
      <div className="corridor-impact-list">
        {impacts.map((impact) => (
          <button
            key={impact.id}
            type="button"
            className={impact.id === selectedImpactId ? "selected" : undefined}
            onClick={() => onSelectImpact(impact.id === selectedImpactId ? undefined : impact.id)}
          >
            <span>{impact.name}</span>
            <small>
              {impact.eventCount} hendelser · {severityLabel(impact.highestSeverity)}
            </small>
          </button>
        ))}
      </div>
      {selectedImpact ? (
        <div className="corridor-impact-events">
          <h3>{selectedImpact.name}</h3>
          {affectedEvents.length > 0 ? (
            <ul>
              {affectedEvents.map((event) => (
                <li key={event.id}>
                  <strong>{event.title}</strong>
                  {event.locationName ? <span> ved {event.locationName}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>Ingen filtrerte DATEX-hendelser treffer denne korridoren.</p>
          )}
        </div>
      ) : (
        <p className="corridor-impact-hint">
          Velg en korridor for å markere berørte hendelser på kartet.
        </p>
      )}
    </section>
  );
}
