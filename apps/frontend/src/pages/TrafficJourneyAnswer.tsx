import type { JourneyTravellerAnswerView } from "./trafficJourneyView.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

export interface TrafficJourneyRouteChoice {
  itineraryId: string;
  label: string;
  selected: boolean;
  recommended: boolean;
  summary: string;
  lineSummary: string;
  detail: string;
  meta: string;
}

export interface TrafficJourneyRouteChoiceView {
  heading: string;
  detail: string;
  options: TrafficJourneyRouteChoice[];
}

export interface TrafficJourneyRouteWatchView {
  heading: string;
  detail: string;
  severity: "ok" | "watch" | "warning";
  items: Array<{
    id: string;
    label: string;
    detail: string;
    severity: "ok" | "watch" | "warning";
    source: string;
  }>;
}

export function TrafficJourneyAnswer({
  answer,
  onSelectItinerary,
  routeChoice,
  routeWatch,
}: {
  answer: JourneyTravellerAnswerView;
  onSelectItinerary?: (itineraryId: string) => void;
  routeChoice?: TrafficJourneyRouteChoiceView;
  routeWatch?: TrafficJourneyRouteWatchView;
}) {
  const handoffUrl = safeExternalUrl(answer.handoff.url);
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
        {handoffUrl && answer.handoff.label ? (
          <a
            className="traffic-journey-answer-handoff"
            href={handoffUrl}
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

      {routeWatch && routeWatch.severity !== "ok" ? (
        <aside
          className={`traffic-journey-watch traffic-journey-watch-${routeWatch.severity}`}
          aria-label="Sjekk før avreise"
        >
          <strong>{routeWatch.heading}</strong>
          <p>{routeWatch.detail}</p>
          {routeWatch.items.length ? (
            <ul>
              {routeWatch.items.map((item) => (
                <li key={item.id} className={`traffic-journey-watch-item-${item.severity}`}>
                  <strong>{item.label}</strong>
                  <span>
                    {item.detail} · {item.source}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      ) : null}

      {routeChoice && routeChoice.options.length ? (
        <section className="traffic-journey-alternatives" aria-label="Andre reiseforslag">
          <h3>{routeChoice.heading}</h3>
          <p>{routeChoice.detail}</p>
          <div>
            {routeChoice.options.map((option) => (
              <button
                key={`${option.label}:${option.itineraryId}`}
                type="button"
                className={
                  `${option.selected ? "selected " : ""}${
                    option.recommended ? "recommended" : ""
                  }`.trim() || undefined
                }
                aria-pressed={option.selected}
                onClick={() => {
                  if (!option.selected) {
                    onSelectItinerary?.(option.itineraryId);
                  }
                }}
              >
                <strong>{option.label}</strong>
                <span>{option.lineSummary}</span>
                <small>{option.summary}</small>
                <small>{option.meta}</small>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </section>
      ) : answer.routeOptions.length > 1 ? (
        <section className="traffic-journey-alternatives" aria-label="Andre reiseforslag">
          <h3>Andre valg</h3>
          <div>
            {answer.routeOptions.map((option) => (
              <button
                key={`${option.label}:${option.itineraryId}`}
                type="button"
                className={option.selected ? "selected" : undefined}
                aria-pressed={option.selected}
                onClick={() => {
                  if (!option.selected) {
                    onSelectItinerary?.(option.itineraryId);
                  }
                }}
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
