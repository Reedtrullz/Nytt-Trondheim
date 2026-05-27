import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Situation, SituationLifecycle } from "@nytt/shared";
import { api } from "../api.js";

const filters: Array<{ label: string; status?: SituationLifecycle; includeDismissed?: boolean }> = [
  { label: "Aktuelle" },
  { label: "Foreløpige", status: "preliminary" },
  { label: "Bekreftet", status: "active" },
  { label: "Avsluttet", status: "resolved", includeDismissed: true },
  { label: "Avvist historikk", status: "dismissed", includeDismissed: true },
];

function time(value: string) {
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function SituationsPage() {
  const [selected, setSelected] = useState(filters[0]!);
  const [items, setItems] = useState<Situation[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(undefined);
    void api
      .situations({ status: selected.status, includeDismissed: selected.includeDismissed })
      .then((page) =>
        setItems(
          selected.label === "Aktuelle"
            ? page.items.filter(
                (situation) => situation.status === "preliminary" || situation.status === "active",
              )
            : page.items,
        ),
      )
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <main className="situations-index">
      <header className="page-heading">
        <p className="label">Situasjonsrom</p>
        <h1>Hendelser og utvikling</h1>
        <p>
          Samlede hendelser fra publiserte kilder, med tydelig skille mellom anslag og offentlig
          informasjon.
        </p>
      </header>
      <div className="situation-filters" aria-label="Filtrer situasjoner">
        {filters.map((filter) => (
          <button
            key={filter.label}
            className={selected.label === filter.label ? "selected" : ""}
            onClick={() => setSelected(filter)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {loading ? <p className="feed-state">Henter situasjoner...</p> : null}
      {error ? <p className="feed-state error">Kunne ikke hente situasjoner: {error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="empty-panel">Ingen situasjoner i denne visningen.</p>
      ) : null}
      <section className="situation-cards">
        {items.map((situation) => (
          <article key={situation.id}>
            <div>
              <span className={`case-status ${situation.status}`}>{statusLabel(situation)}</span>
              <h2>{situation.title}</h2>
              <p>{situation.summary}</p>
              <small>
                {situation.locationLabel} · Oppdatert {time(situation.updatedAt)}
              </small>
            </div>
            <Link className="primary-link" to={`/situasjoner/${situation.id}`}>
              Åpne oversikt
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}

function statusLabel(situation: Situation) {
  if (situation.status === "dismissed") return "Avvist som feilkobling";
  if (situation.status === "resolved") return "Avsluttet";
  if (situation.status === "active") return "Offentlig bekreftet";
  return "Foreløpig fra rapportering";
}
