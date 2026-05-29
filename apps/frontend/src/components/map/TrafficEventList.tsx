import type { TrafficMapEvent } from "@nytt/shared";

interface TrafficEventListProps {
  events: TrafficMapEvent[];
  selectedEventId?: string;
  onSelectEvent: (eventId: string) => void;
}

function formatEventTime(event: TrafficMapEvent) {
  const value = event.validFrom ?? event.updatedAt;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Ukjent tid";
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function categoryLabel(category: TrafficMapEvent["category"]) {
  switch (category) {
    case "roadworks":
      return "Veiarbeid";
    case "accident":
      return "Ulykke";
    case "closure":
      return "Stengt vei";
    case "congestion":
      return "Kø/forsinkelse";
    case "weather":
      return "Vær/føre";
    case "restriction":
      return "Restriksjon";
    case "obstruction":
      return "Hindring";
    default:
      return "Annet";
  }
}

function severityLabel(severity: TrafficMapEvent["severity"]) {
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

function stateLabel(state: TrafficMapEvent["state"]) {
  switch (state) {
    case "active":
      return "aktiv";
    case "planned":
      return "planlagt";
    case "expired":
      return "utløpt";
    case "cancelled":
      return "kansellert";
    default:
      return state;
  }
}

export function TrafficEventList({ events, selectedEventId, onSelectEvent }: TrafficEventListProps) {
  return (
    <section className="traffic-event-list-card">
      <header>
        <h2>Hendelser i kartet</h2>
        <span>{events.length}</span>
      </header>
      {events.length === 0 ? <p>Ingen hendelser i valgt kartutsnitt og filter.</p> : null}
      <ol className="traffic-event-list">
        {events.slice(0, 80).map((event) => (
          <li key={event.id}>
            <button
              type="button"
              className={event.id === selectedEventId ? "selected" : undefined}
              aria-pressed={event.id === selectedEventId}
              onClick={() => onSelectEvent(event.id)}
            >
              <strong>{event.title}</strong>
              <span>
                {categoryLabel(event.category)} · {severityLabel(event.severity)} · {stateLabel(event.state)}
              </span>
              {event.locationName ?? event.roadName ? (
                <span>{event.locationName ?? event.roadName}</span>
              ) : null}
              <small>{formatEventTime(event)}</small>
            </button>
          </li>
        ))}
      </ol>
      {events.length > 80 ? <p>Viser de 80 første hendelsene.</p> : null}
    </section>
  );
}
