import type { RankedTrafficEventModel } from "../../trafficViewModel.js";

interface TrafficEventListProps {
  rankedEvents: RankedTrafficEventModel[];
  selectedEventId?: string;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onSelectEvent: (eventId: string) => void;
}

export function TrafficEventList({
  rankedEvents,
  selectedEventId,
  showAll,
  onShowAllChange,
  onSelectEvent,
}: TrafficEventListProps) {
  return (
    <section className="traffic-event-list-card">
      <header>
        <div>
          <h2>Aktive trafikksituasjoner</h2>
          <span>{rankedEvents.length}</span>
        </div>
        <button type="button" onClick={() => onShowAllChange(!showAll)}>
          {showAll ? "Skjul mindre" : "Vis alle"}
        </button>
      </header>
      {rankedEvents.length === 0 ? (
        <p>Ingen aktive hendelser i valgt kartutsnitt. Prøv å zoome ut eller slå på “Vis alle”.</p>
      ) : null}
      <ol className="traffic-event-list">
        {rankedEvents.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={row.id === selectedEventId ? "selected" : undefined}
              aria-pressed={row.id === selectedEventId}
              onClick={() => onSelectEvent(row.id)}
            >
              <strong>{row.title}</strong>
              <span>{row.meta}</span>
              <span className="traffic-row-badges">
                {row.badges.map((badge) => (
                  <span key={badge} className="trust-badge">
                    {badge}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
