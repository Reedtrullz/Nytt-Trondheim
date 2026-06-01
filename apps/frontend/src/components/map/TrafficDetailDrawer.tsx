import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { safeExternalUrl } from "../../safeExternalUrl.js";
import { badgesForTrafficEvent, sourceDisplayLabel } from "../../trafficProvenance.js";
import { delaySummary } from "../../trafficViewModel.js";

function clock(value?: string): string {
  if (!value) return "ukjent";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function stateLabel(state: TrafficMapEvent["state"]): string {
  switch (state) {
    case "active":
      return "Aktiv";
    case "planned":
      return "Planlagt";
    case "expired":
      return "Utløpt";
    case "cancelled":
      return "Kansellert";
    default:
      return state;
  }
}

function categoryLabel(category: TrafficMapEvent["category"]): string {
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
      return "Trafikkmelding";
  }
}

function impactForEvent(event: TrafficMapEvent, impacts: TrafficCorridorImpact[]) {
  return impacts.find((impact) => impact.affectedEventIds.includes(event.id));
}

function confidenceLabel(confidence?: number): string | undefined {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return undefined;
  if (confidence < 0 || confidence > 1) return undefined;
  return `${Math.round(confidence * 100)} %`;
}

function distanceLabel(distanceMeters?: number): string | undefined {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) return undefined;
  if (distanceMeters < 0) return undefined;
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1).replace(".", ",")} km unna`
    : `${Math.round(distanceMeters)} m unna`;
}

export function TrafficDetailDrawer({
  event,
  corridorImpacts,
  onClose,
}: {
  event?: TrafficMapEvent;
  corridorImpacts: TrafficCorridorImpact[];
  onClose: () => void;
}) {
  if (!event) return null;
  const impact = impactForEvent(event, corridorImpacts);
  const sourceUrl = safeExternalUrl(event.sourceUrl);
  const confidence = confidenceLabel(event.confidence);

  return (
    <aside className="traffic-detail-drawer" aria-label="Detaljer om trafikkhendelse">
      <header>
        <p className="label">Hvorfor ser jeg dette?</p>
        <h2>{event.title}</h2>
        <button type="button" onClick={onClose} aria-label="Lukk trafikkdetaljer">
          Lukk
        </button>
      </header>
      <div className="traffic-drawer-badges">
        {badgesForTrafficEvent(event).map((badge) => (
          <span key={badge} className="trust-badge">
            {badge}
          </span>
        ))}
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{stateLabel(event.state)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{categoryLabel(event.category)}</dd>
        </div>
        <div>
          <dt>Kilde</dt>
          <dd>{sourceDisplayLabel(event.source)}</dd>
        </div>
        <div>
          <dt>Observert</dt>
          <dd>{clock(event.validFrom)}</dd>
        </div>
        <div>
          <dt>Oppdatert</dt>
          <dd>{clock(event.updatedAt)}</dd>
        </div>
        <div>
          <dt>Plassering</dt>
          <dd>Offisiell koordinat/geometri</dd>
        </div>
        {confidence ? (
          <div>
            <dt>Konfidens</dt>
            <dd>{confidence}</dd>
          </div>
        ) : null}
      </dl>
      {event.description ? <p>{event.description}</p> : null}
      {impact?.travelTime ? (
        <section>
          <h3>Trafikkpuls</h3>
          <p>
            {impact.name}: {delaySummary(impact)}
          </p>
        </section>
      ) : null}
      {event.relatedArticles?.length ? (
        <section>
          <h3>Relatert kildegrunnlag</h3>
          <ul>
            {event.relatedArticles.map((article) => {
              const href = safeExternalUrl(article.url);
              const distance = distanceLabel(article.distanceMeters);
              return (
                <li key={article.id}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {article.title}
                    </a>
                  ) : (
                    <span>{article.title}</span>
                  )}
                  <small>
                    {article.location ? "estimert nyhetsplassering" : "relatert artikkel"}
                    {distance ? ` · ${distance}` : ""}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
          Åpne kilde
        </a>
      ) : null}
    </aside>
  );
}
