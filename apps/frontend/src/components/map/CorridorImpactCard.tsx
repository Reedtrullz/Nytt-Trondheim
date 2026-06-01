import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { delaySummary } from "../../trafficViewModel.js";

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

function delaySeconds(impact: TrafficCorridorImpact): number {
  const delay = impact.travelTime?.delaySeconds;
  return typeof delay === "number" && Number.isFinite(delay) ? delay : 0;
}

export function CorridorImpactCard({
  impacts,
  events,
  selectedImpactId,
  onSelectImpact,
}: CorridorImpactCardProps) {
  const sortedImpacts = [...impacts].sort(
    (left, right) => delaySeconds(right) - delaySeconds(left),
  );
  const selectedImpact = impacts.find((impact) => impact.id === selectedImpactId);
  const selectedTravelTimeSummary = selectedImpact ? delaySummary(selectedImpact) : undefined;
  const affectedEvents = selectedImpact
    ? selectedImpact.affectedEventIds
        .map((eventId) => events.find((event) => event.id === eventId))
        .filter((event): event is TrafficMapEvent => Boolean(event))
    : [];

  return (
    <section className="corridor-impact-card">
      <header>
        <h2>Reisetidskorridorer</h2>
        {selectedImpact ? (
          <button type="button" onClick={() => onSelectImpact(undefined)}>
            Nullstill
          </button>
        ) : null}
      </header>
      <div className="corridor-impact-list">
        {sortedImpacts.map((impact) => {
          const summary = delaySummary(impact);
          return (
            <button
              key={impact.id}
              type="button"
              className={impact.id === selectedImpactId ? "selected" : undefined}
              onClick={() => onSelectImpact(impact.id === selectedImpactId ? undefined : impact.id)}
            >
              <span>{impact.name}</span>
              {impact.travelTime ? <span className="trust-badge">REISETID</span> : null}
              <small>
                {impact.eventCount} hendelser · {severityLabel(impact.highestSeverity)}
                {summary ? ` · ${summary}` : ""}
              </small>
            </button>
          );
        })}
      </div>
      {selectedImpact ? (
        <div className="corridor-impact-events">
          <h3>{selectedImpact.name}</h3>
          {selectedImpact.travelTime ? <span className="trust-badge">REISETID</span> : null}
          {selectedTravelTimeSummary ? (
            <p className="corridor-impact-travel-time">{selectedTravelTimeSummary}</p>
          ) : null}
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
