import { useState } from "react";
import type { HomeStoryCard } from "../../homeStoryCards.js";
import { coverageMatchExplanation } from "../../homeStoryCards.js";
import { safeExternalUrl } from "../../safeExternalUrl.js";

function sourceTime(value: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CoverageSourceCluster({
  card,
  canCorrect,
  onCorrect,
}: {
  card: HomeStoryCard;
  canCorrect: boolean;
  onCorrect: (card: HomeStoryCard) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const supporting = card.group.articles.filter((article) => article.id !== card.primary.id);
  if (supporting.length === 0) return null;
  const visible = expanded ? supporting : supporting.slice(0, 2);
  const supportingSourceCount = new Set(supporting.map((article) => article.source)).size;
  const countLabel = `${supporting.length} ${supporting.length === 1 ? "annen sak" : "andre saker"} fra ${supportingSourceCount} ${supportingSourceCount === 1 ? "kilde" : "kilder"}`;
  const bundleLabel = `${card.articleCount} saker fra ${card.sourceCount} kilder`;

  return (
    <section
      className="coverage-source-cluster"
      aria-label={`Samlet dekning: ${bundleLabel}. ${countLabel}`}
    >
      <div className="coverage-source-heading">
        <strong>{countLabel}</strong>
        <span>{coverageMatchExplanation(card)}</span>
      </div>
      <div className="coverage-source-list" data-expanded={expanded}>
        {visible.map((article) => {
          const href = safeExternalUrl(article.url);
          const content = (
            <>
              <b>
                {article.sourceLabel} · {sourceTime(article.publishedAt)}
              </b>
              <small>{article.title}</small>
            </>
          );
          return href ? (
            <a
              className="coverage-source-row"
              data-article-id={article.id}
              href={href}
              key={article.id}
              target="_blank"
              rel="noreferrer noopener"
            >
              {content}
            </a>
          ) : (
            <span className="coverage-source-row" data-article-id={article.id} key={article.id}>
              {content}
            </span>
          );
        })}
      </div>
      <div className="coverage-source-actions">
        {supporting.length > 2 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Vis færre saker" : `Vis alle ${countLabel}`}
          </button>
        ) : null}
        {canCorrect && card.group.bundle ? (
          <button
            type="button"
            className="coverage-correction-open"
            onClick={() => onCorrect(card)}
          >
            Feil gruppering?
          </button>
        ) : null}
      </div>
    </section>
  );
}
