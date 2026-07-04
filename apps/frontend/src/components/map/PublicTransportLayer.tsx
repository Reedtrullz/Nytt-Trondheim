import type {
  PublicTransportMapPayload,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  PublicTransportVehicleMode,
} from "@nytt/shared";
import { CircleMarker, Popup } from "react-leaflet";
import { latLngFromGeoJsonPosition, latLngFromPoint } from "../../mapCoordinates.js";

const modeLabels: Record<PublicTransportVehicleMode, string> = {
  bus: "Buss",
  tram: "Trikk",
  rail: "Tog",
  water: "Båt",
  metro: "T-bane",
  unknown: "Annet",
};

function alertPositions(alert: PublicTransportServiceAlert): Array<[number, number]> {
  if (!alert.geometry) return [];
  if (alert.geometry.type === "Point") {
    const center = latLngFromPoint(alert.geometry);
    return center ? [center] : [];
  }
  return alert.geometry.coordinates.flatMap((position) => {
    const center = latLngFromGeoJsonPosition(position);
    return center ? [center] : [];
  });
}

function vehicleTitle(vehicle: PublicTransportVehicle): string {
  if (vehicle.publicCode) {
    return `${vehicle.publicCode} → ${vehicle.destinationName ?? "ukjent"}`;
  }
  return vehicle.lineName ?? vehicle.vehicleId;
}

function formatTime(value?: string): string {
  if (!value) return "ukjent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function modesFromAlert(alert: PublicTransportServiceAlert): PublicTransportVehicleMode[] {
  const text = [
    alert.summary,
    alert.description,
    alert.advice,
    ...(alert.affectedLineNames ?? []),
    ...(alert.affectedStopNames ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase("nb");
  const modes = new Set<PublicTransportVehicleMode>();
  if (/\b(?:trikk|tram)\b/u.test(text)) modes.add("tram");
  if (/\b(?:tog|trønderbanen|dovrebanen|nordlandsbanen|meråkerbanen|rail)\b/u.test(text)) {
    modes.add("rail");
  }
  if (/\b(?:båt|hurtigbåt|ferje|ferry|boat)\b/u.test(text)) modes.add("water");
  if (/\b(?:buss|bus|linje)\b/u.test(text)) modes.add("bus");
  return modes.size ? Array.from(modes) : ["unknown"];
}

export function publicTransportModeGroups(payload: PublicTransportMapPayload): Array<{
  mode: PublicTransportVehicleMode;
  label: string;
  vehicles: PublicTransportVehicle[];
  alerts: PublicTransportServiceAlert[];
}> {
  const order: PublicTransportVehicleMode[] = ["bus", "tram", "rail", "water", "metro", "unknown"];
  return order
    .map((mode) => ({
      mode,
      label: modeLabels[mode],
      vehicles: payload.vehicles.filter((vehicle) => vehicle.mode === mode),
      alerts: payload.alerts.filter((alert) => modesFromAlert(alert).includes(mode)),
    }))
    .filter((group) => group.vehicles.length > 0 || group.alerts.length > 0);
}

function alertAffectedSummary(alert: PublicTransportServiceAlert): string {
  const lines = alert.affectedLineNames?.filter(Boolean) ?? [];
  const stops = alert.affectedStopNames?.filter(Boolean) ?? [];
  const parts = [
    lines.length ? `Linjer: ${lines.slice(0, 4).join(", ")}` : undefined,
    stops.length ? `Stopp: ${stops.slice(0, 3).join(", ")}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

export function PublicTransportLayer({
  payload,
  visible,
  context = false,
}: {
  payload?: PublicTransportMapPayload;
  visible: boolean;
  context?: boolean;
}) {
  if (!visible || !payload) return null;
  return (
    <>
      {payload.vehicles.flatMap((vehicle) => {
        const center = latLngFromPoint(vehicle.geometry);
        if (!center) return [];
        return [
          <CircleMarker
            key={vehicle.id}
            center={center}
            radius={vehicle.mode === "bus" ? 5 : 6}
            pathOptions={{
              className: context
                ? "public-transport-marker public-transport-marker-context"
                : "public-transport-marker",
              color: vehicle.stale ? "#64748b" : "#7c3aed",
              fillOpacity: context ? 0.45 : 0.8,
              opacity: context ? 0.65 : 0.95,
              weight: context ? 1 : 2,
            }}
          >
            <Popup>
              <article className="public-transport-popup">
                <strong>{vehicleTitle(vehicle)}</strong>
                <span>Entur · oppdatert {formatTime(vehicle.lastUpdated)}</span>
              </article>
            </Popup>
          </CircleMarker>,
        ];
      })}
      {payload.alerts.flatMap((alert) =>
        alertPositions(alert).map((center, index) => (
          <CircleMarker
            key={`${alert.id}:${index}`}
            center={center}
            radius={context ? 7 : 8}
            pathOptions={{
              className: context
                ? "public-transport-alert public-transport-marker-context"
                : "public-transport-alert",
              color: "#f97316",
              fillOpacity: context ? 0.45 : 0.65,
              opacity: context ? 0.7 : 0.95,
              weight: context ? 1 : 2,
            }}
          >
            <Popup>
              <article className="public-transport-popup">
                <strong>{alert.summary}</strong>
                <span>Entur avvik</span>
              </article>
            </Popup>
          </CircleMarker>
        )),
      )}
    </>
  );
}

export function PublicTransportSummary({
  payload,
  loading,
  error,
  onReload,
  context = false,
}: {
  payload?: PublicTransportMapPayload;
  loading?: boolean;
  error?: string;
  onReload?: () => void;
  context?: boolean;
}) {
  if (!payload && !loading && !error) return null;
  return (
    <section className={context ? "public-transport-card context" : "public-transport-card"}>
      <header>
        <h2>Kollektivtrafikk</h2>
        {payload ? <span>{payload.vehicles.length + payload.alerts.length}</span> : null}
      </header>
      {context ? <p>Kontekstvisning for kollektivtrafikk – ikke automatisk kildebevis.</p> : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          {onReload ? (
            <button type="button" onClick={onReload} disabled={loading}>
              Prøv igjen
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <p>Henter kollektivtrafikk...</p> : null}
      {payload ? (
        <>
          {publicTransportModeGroups(payload).map((group) => (
            <section key={group.mode} className="public-transport-mode-group">
              <h3>{group.label}</h3>
              <ul>
                {group.alerts.slice(0, 6).map((alert) => {
                  const affectedSummary = alertAffectedSummary(alert);
                  return (
                    <li key={alert.id}>
                      <strong>{alert.summary}</strong>
                      <span>
                        Entur avvik · {formatTime(alert.updatedAt)}
                        {affectedSummary ? ` · ${affectedSummary}` : ""}
                      </span>
                      {alert.advice ? <small>{alert.advice}</small> : null}
                    </li>
                  );
                })}
                {group.vehicles.slice(0, 6).map((vehicle) => (
                  <li key={vehicle.id}>
                    <strong>{vehicleTitle(vehicle)}</strong>
                    <span>Entur kjøretøyposisjoner · {formatTime(vehicle.lastUpdated)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {payload.vehicles.length === 0 && payload.alerts.length === 0 ? (
            <p>
              Ingen aktive kollektivavvik eller kjøretøyposisjoner i valgt kartutsnitt. Sjekk
              AtB/Entur for konkrete avganger.
            </p>
          ) : null}
          {payload.sources.length ? (
            <div className="public-transport-sources">
              {payload.sources.map((source) => (
                <small key={source.source}>
                  {source.label}
                  {source.detail ? ` · ${source.detail}` : ""}
                </small>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
