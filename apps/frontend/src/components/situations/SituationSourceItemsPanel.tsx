import {
  sourceIdLabel,
  sourceItemKindLabel,
  sourceItemRelationshipLabel,
  sourceReliabilityTierLabel,
  type SourceItem,
  type SourceItemRelationship,
} from "@nytt/shared";
import type { ReactNode } from "react";
import { safeExternalUrl } from "../../safeExternalUrl.js";

const sourceItemRelationships: SourceItemRelationship[] = [
  "supports",
  "context",
  "contradicts",
  "duplicate",
];

function sourceItemMeta(item: SourceItem): string {
  return [
    sourceIdLabel(item.provider),
    sourceItemKindLabel(item.kind),
    sourceReliabilityTierLabel(item.reliabilityTier),
    item.relationship ? sourceItemRelationshipLabel(item.relationship) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface SituationSourceItemsPanelProps {
  sourceItems: SourceItem[];
  loading: boolean;
  error?: string;
  canManage: boolean;
  search: string;
  relationship: SourceItemRelationship;
  candidates: SourceItem[];
  candidatesLoading: boolean;
  candidatesError?: string;
  linkingSourceItemId?: string;
  onRetry: () => void;
  onSearchChange: (value: string) => void;
  onRelationshipChange: (value: SourceItemRelationship) => void;
  onLoadCandidates: () => void;
  onLink: (sourceItemId: string) => void;
  onUnlink: (sourceItemId: string) => void;
}

function SourceItemSummary({ item, action }: { item: SourceItem; action?: ReactNode }) {
  const originalUrl = safeExternalUrl(item.originalUrl);
  return (
    <li>
      <div className="source-item-card-header">
        <div>
          <strong>{item.title ?? item.externalId ?? item.id}</strong>
          <span>{sourceItemMeta(item)}</span>
        </div>
        {action}
      </div>
      {item.summary ? <p>{item.summary}</p> : null}
      {originalUrl ? (
        <a href={originalUrl} target="_blank" rel="noreferrer noopener">
          Åpne kilde
        </a>
      ) : null}
    </li>
  );
}

export function SituationSourceItemsPanel({
  sourceItems,
  loading,
  error,
  canManage,
  search,
  relationship,
  candidates,
  candidatesLoading,
  candidatesError,
  linkingSourceItemId,
  onRetry,
  onSearchChange,
  onRelationshipChange,
  onLoadCandidates,
  onLink,
  onUnlink,
}: SituationSourceItemsPanelProps) {
  return (
    <section className="source-items-panel">
      <h2>Kildegrunnlag</h2>
      {canManage ? (
        <form
          className="source-item-picker"
          onSubmit={(event) => {
            event.preventDefault();
            onLoadCandidates();
          }}
        >
          <label>
            <span>Søk i kildeelementer</span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Søk etter kilde, sted eller tittel"
            />
          </label>
          <label>
            <span>Relasjon</span>
            <select
              value={relationship}
              onChange={(event) =>
                onRelationshipChange(event.target.value as SourceItemRelationship)
              }
            >
              {sourceItemRelationships.map((item) => (
                <option key={item} value={item}>
                  {sourceItemRelationshipLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={candidatesLoading}>
            {candidatesLoading ? "Søker..." : "Søk kildegrunnlag"}
          </button>
          <small>Kontekst- og telemetrikilder må kobles som kontekst, ikke hendelsesbevis.</small>
        </form>
      ) : null}
      {candidatesError ? (
        <div className="source-items-error" role="alert" aria-live="assertive">
          <p>Kunne ikke søke kildeelementer: {candidatesError}</p>
        </div>
      ) : null}
      {canManage && candidates.length > 0 ? (
        <div className="source-item-candidates">
          <h3>Mulige kildeelementer</h3>
          <ul>
            {candidates.map((item) => (
              <SourceItemSummary
                key={item.id}
                item={{ ...item, relationship }}
                action={
                  <button
                    type="button"
                    disabled={linkingSourceItemId === item.id}
                    onClick={() => onLink(item.id)}
                  >
                    {linkingSourceItemId === item.id ? "Kobler..." : "Koble"}
                  </button>
                }
              />
            ))}
          </ul>
        </div>
      ) : null}
      {loading ? (
        <p aria-live="polite">Henter kildegrunnlag...</p>
      ) : error ? (
        <div className="source-items-error" role="alert" aria-live="assertive">
          <p>Kunne ikke hente kildegrunnlag: {error}</p>
          <button type="button" onClick={onRetry}>
            Prøv igjen
          </button>
        </div>
      ) : sourceItems.length === 0 ? (
        <p>Ingen kildeelementer er koblet ennå.</p>
      ) : (
        <ul className="linked-source-items">
          {sourceItems.map((item) => (
            <SourceItemSummary
              key={item.id}
              item={item}
              action={
                canManage ? (
                  <button type="button" className="remove" onClick={() => onUnlink(item.id)}>
                    Koble fra
                  </button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
