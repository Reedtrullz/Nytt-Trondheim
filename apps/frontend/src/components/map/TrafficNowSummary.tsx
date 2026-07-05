import type { TrafficSummaryCardModel } from "../../trafficViewModel.js";

export function TrafficNowSummary({ cards }: { cards: TrafficSummaryCardModel[] }) {
  return (
    <section className="traffic-now-summary" aria-labelledby="traffic-now-heading">
      <header>
        <p className="label">Reisegrunnlag</p>
        <h2 id="traffic-now-heading">Trafikkbildet nå</h2>
      </header>
      <div className="traffic-now-cards">
        {cards.map((card) => (
          <article key={card.id} className={`traffic-now-card severity-${card.severity ?? "low"}`}>
            <div>
              <span className="traffic-now-count">{card.count}</span>
              <h3>{card.title}</h3>
            </div>
            {card.badge ? <span className="trust-badge">{card.badge}</span> : null}
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
