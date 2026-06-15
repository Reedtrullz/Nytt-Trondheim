import type { KeyboardEvent } from "react";
import type { RankedTrafficEventModel } from "../../trafficViewModel.js";

interface TrafficEventListProps {
  rankedEvents: RankedTrafficEventModel[];
  selectedEventId?: string;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onSelectEvent: (eventId: string) => void;
}

function focusTrafficEventButton(index: number) {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-traffic-event-row]");
  buttons[index]?.focus();
}

function handleTrafficEventKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  total: number,
) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusTrafficEventButton(Math.min(total - 1, index + 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusTrafficEventButton(Math.max(0, index - 1));
  } else if (event.key === "Home") {
    event.preventDefault();
    focusTrafficEventButton(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusTrafficEventButton(total - 1);
  }
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
        {rankedEvents.map((row, index) => (
          <li key={row.id}>
            <button
              type="button"
              className={row.id === selectedEventId ? "selected" : undefined}
              aria-pressed={row.id === selectedEventId}
              data-traffic-event-row
              onClick={() => onSelectEvent(row.id)}
              onKeyDown={(event) => handleTrafficEventKeyDown(event, index, rankedEvents.length)}
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
