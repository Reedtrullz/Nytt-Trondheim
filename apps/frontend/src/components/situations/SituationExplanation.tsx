import type { SituationExplanation } from "@nytt/shared";

const roleLabels: Record<SituationExplanation["sourceRoles"][number]["role"], string> = {
  evidence: "Hendelsesgrunnlag",
  context: "Kontekst, ikke årsak",
  telemetry: "Telemetri, ikke årsak",
  private: "Privat vurdering",
};

const sourceLabels: Partial<
  Record<SituationExplanation["sourceRoles"][number]["provider"], string>
> = {
  nrk: "NRK",
  adressa: "Adresseavisen",
  vg: "VG",
  dagbladet: "Dagbladet",
  trondheim_kommune: "Trondheim kommune",
  met: "MET",
  nve: "NVE / Varsom",
  datex: "Vegvesen DATEX",
  datex_travel_time: "DATEX reisetid",
  datex_weather: "Vegvesen værstasjoner",
  datex_cctv: "Vegvesen kamera",
  trafikkdata: "Trafikkdata",
  entur_vehicle_positions: "Entur kjøretøyposisjoner",
  entur_service_alerts: "Entur avvik",
  politiloggen: "Politiloggen",
  deepseek: "Privat AI-analyse",
};

function sourceLabel(provider: SituationExplanation["sourceRoles"][number]["provider"]): string {
  return sourceLabels[provider] ?? provider;
}

const locationConfidenceLabels: Record<SituationExplanation["locationConfidence"], string> = {
  official: "Offisiell plassering",
  estimated: "Estimert plassering",
  mixed: "Blandet offisiell og estimert plassering",
  unknown: "Ukjent plasseringssikkerhet",
};

const dismissalLabels: Record<NonNullable<SituationExplanation["dismissalReason"]>, string> = {
  false_positive: "Avvist fordi automatisk gruppering var en feilkobling.",
  owner_dismissed: "Avvist manuelt av eier.",
};

interface Props {
  explanation?: SituationExplanation;
}

export function SituationExplanationPanel({ explanation }: Props) {
  if (!explanation) return null;
  const contextOnlyRoles = explanation.sourceRoles.filter(
    (role) => role.role === "context" || role.role === "telemetry",
  );

  return (
    <section className="situation-explanation" aria-labelledby="situation-explanation-heading">
      <h2 id="situation-explanation-heading">Hvorfor vises dette?</h2>
      <div>
        <h3>Opprettet fordi</h3>
        <ul>
          {explanation.createdBecause.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Kilderoller</h3>
        <ul>
          {explanation.sourceRoles.map((sourceRole) => (
            <li key={`${sourceRole.provider}:${sourceRole.role}`}>
              <strong>{sourceLabel(sourceRole.provider)}</strong>: {roleLabels[sourceRole.role]}
            </li>
          ))}
        </ul>
      </div>
      <p>
        <strong>Plassering:</strong> {locationConfidenceLabels[explanation.locationConfidence]}
      </p>
      {contextOnlyRoles.length ? (
        <p>
          Kun kontekst: {contextOnlyRoles.map((role) => sourceLabel(role.provider)).join(", ")}{" "}
          brukes til situasjonsforståelse, ikke som årsak til at hendelsen ble opprettet.
        </p>
      ) : null}
      {explanation.dismissalReason ? (
        <p className="dismissal-reason">{dismissalLabels[explanation.dismissalReason]}</p>
      ) : null}
    </section>
  );
}
