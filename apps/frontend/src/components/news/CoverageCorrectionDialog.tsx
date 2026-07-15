import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CoverageBundleSplitRequest } from "@nytt/shared";
import type { HomeStoryCard } from "../../homeStoryCards.js";

export function coverageCorrectionSplitInput(
  card: HomeStoryCard,
  rejectedArticleIds: string[],
  reason: string,
): CoverageBundleSplitRequest | undefined {
  const bundle = card.group.bundle;
  if (!bundle || rejectedArticleIds.length === 0) return undefined;
  return {
    expectedGeneratedAt: bundle.generatedAt,
    ...(bundle.correctionTarget
      ? {
          expectedProjectionRevision: bundle.correctionTarget.projectionRevision,
          originalBundleId: bundle.correctionTarget.originalBundleId,
        }
      : {}),
    anchorArticleId: card.coverageAnchor.id,
    rejectedArticleIds: [...rejectedArticleIds].sort(),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  };
}

export function CoverageCorrectionDialog({
  card,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  card: HomeStoryCard;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (input: CoverageBundleSplitRequest) => void;
}) {
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState("");
  const supporting = card.group.articles.filter((article) => article.id !== card.coverageAnchor.id);

  useEffect(() => {
    firstCheckboxRef.current?.focus();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
      ) ?? []),
    ];
    if (controls.length === 0) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = coverageCorrectionSplitInput(card, [...selectedIds], reason);
    if (input) onConfirm(input);
  }

  return (
    <div className="coverage-correction-backdrop">
      <div
        ref={dialogRef}
        className="coverage-correction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${descriptionId}-title`}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <form onSubmit={submit}>
          <h2 id={`${descriptionId}-title`}>Feil gruppering?</h2>
          <p id={descriptionId}>Velg sakene som ikke hører sammen med hovedsaken.</p>
          <div className="coverage-correction-anchor">
            <span>Behold som hovedsak</span>
            <strong>
              {card.coverageAnchor.sourceLabel}: {card.coverageAnchor.title}
            </strong>
          </div>
          <fieldset disabled={pending}>
            <legend>Skill ut</legend>
            {supporting.map((article, index) => (
              <label key={article.id}>
                <input
                  ref={index === 0 ? firstCheckboxRef : undefined}
                  type="checkbox"
                  checked={selectedIds.has(article.id)}
                  onChange={(event) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(article.id);
                      else next.delete(article.id);
                      return next;
                    })
                  }
                />
                <span>{article.sourceLabel}</span>
                <strong>{article.title}</strong>
              </label>
            ))}
          </fieldset>
          <label className="coverage-correction-reason">
            Årsak (valgfritt)
            <textarea
              maxLength={500}
              value={reason}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div className="coverage-correction-actions">
            <button type="button" disabled={pending} onClick={onCancel}>
              Avbryt
            </button>
            <button type="submit" disabled={pending || selectedIds.size === 0}>
              {pending ? "Splitter…" : "Splitt nå"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
