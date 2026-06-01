const entries = [
  ["OFFISIELL", "Statens vegvesen DATEX/TrafficInfo eller annen offisiell kilde."],
  ["ESTIMERT", "Plassering utledet fra nyhet/geokoding, ikke offisiell koordinat."],
  ["REISETID", "DATEX TravelTime: målt/estimert trafikkpuls, ikke årsak."],
  ["VARSELKONTEKST", "Vær/risiko som kan påvirke trafikk, ikke bekreftet hendelse."],
  ["KOLLEKTIV", "Entur/AtB-avvik eller kjøretøykontekst."],
  ["NYHETSKILDE", "Relatert artikkel eller offentlig melding."],
] as const;

export function TrafficLegend() {
  return (
    <aside className="traffic-legend" aria-label="Tegnforklaring for trafikkartet">
      <h2>Tegnforklaring</h2>
      <p>Linje = berørt veg/korridor. Sirkel med stiplet kant = estimert plassering.</p>
      <dl>
        {entries.map(([badge, detail]) => (
          <div key={badge}>
            <dt className="trust-badge">{badge}</dt>
            <dd>{detail}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
