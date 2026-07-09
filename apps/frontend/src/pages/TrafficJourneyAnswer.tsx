import type { JourneyTravellerAnswerView } from "./trafficJourneyView.js";

export function TrafficJourneyAnswer({
  answer,
  onSelectItinerary,
}: {
  answer: JourneyTravellerAnswerView;
  onSelectItinerary?: (itineraryId: string) => void;
}) {
  return (
    <article
      className={`traffic-journey-answer traffic-journey-answer-${answer.severity}`}
      aria-live="polite"
    >
      <header className="traffic-journey-answer-header">
        <p className="label">Reiseråd nå</p>
        <h2>{answer.headline}</h2>
        {answer.primaryMeta ? (
          <p className="traffic-journey-answer-meta">{answer.primaryMeta}</p>
        ) : null}
        <p>{answer.supportingText}</p>
        {answer.handoff.url && answer.handoff.label ? (
          <a
            className="traffic-journey-answer-handoff"
            href={answer.handoff.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {answer.handoff.label}
          </a>
        ) : null}
      </header>

      {answer.steps.length ? (
        <ol className="traffic-journey-steps" aria-label="Reisesteg">
          {answer.steps.map((step) => (
            <li key={step.id} className={`traffic-journey-step traffic-journey-step-${step.kind}`}>
              <span className="traffic-journey-step-icon" aria-hidden="true">
                {step.kind === "ride" ? "◇" : "•"}
              </span>
              <div>
                <strong>{step.label}</strong>
                {step.detail ? <span>{step.detail}</span> : null}
                {step.meta ? <small>{step.meta}</small> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {answer.routeOptions.length > 1 ? (
        <section className="traffic-journey-alternatives" aria-label="Andre reiseforslag">
          <h3>Andre valg</h3>
          <div>
            {answer.routeOptions.map((option) => (
              <button
                key={`${option.label}:${option.itineraryId}`}
                type="button"
                className={option.selected ? "selected" : undefined}
                aria-pressed={option.selected}
                onClick={() => onSelectItinerary?.(option.itineraryId)}
              >
                <strong>{option.label}</strong>
                <span>{option.summary}</span>
                <small>{option.meta}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {answer.context.primaryTextItems.length ? (
        <details className="traffic-journey-context-disclosure">
          <summary>Hva påvirker reisen? {answer.context.disclosureLabel}</summary>
          <ul>
            {answer.context.primaryTextItems.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span>
                  {item.detail} · {item.source}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer>Nytt vurderer reiserisiko, ikke billetter eller garanti.</footer>
    </article>
  );
}
