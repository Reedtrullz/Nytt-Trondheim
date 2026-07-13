import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  ArticleCoverageBundleConfidence,
  ArticleCoverageBundleKind,
  CoverageBundleListItem,
  CoverageBundlePage,
  CoverageBundleQueryInput,
  CoverageBundleSplitRequest,
} from "@nytt/shared";
import { api, CoverageCorrectionConflictError } from "../api.js";
import { CoverageCorrectionDialog } from "../components/news/CoverageCorrectionDialog.js";
import { homeStoryCardForGroup } from "../homeStoryCards.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

export type CoverageWorkspaceFilters = {
  projection: "legacy" | "shadow" | "active";
  matchTier?: "strong" | "moderate";
  corrected?: "yes" | "no";
  integrity?: "clean" | "error";
  query?: string;
  cursor?: string;
  bundleId?: string;
  confidence?: ArticleCoverageBundleConfidence;
};

const kindLabels: Record<ArticleCoverageBundleKind, string> = {
  incident: "Hendelse",
  topic: "Tema",
  update: "Oppdatering",
};

const confidenceLabels: Record<ArticleCoverageBundleConfidence, string> = {
  high: "Høy",
  medium: "Middels",
};

const projectionLabels: Record<CoverageWorkspaceFilters["projection"], string> = {
  shadow: "Skyggevisning",
  active: "Aktiv v2-visning",
  legacy: "Dagens publiserte",
};

const matchTierLabels = {
  strong: "Sterkt treff",
  moderate: "Moderat treff",
  weak: "Svakt treff",
} as const;

const signalLabels: Record<CoverageBundleListItem["signals"][number]["kind"], string> = {
  persisted_bundle: "Lagret kobling",
  situation_id: "Situasjons-ID",
  title_similarity: "Tittellikhet",
  near_duplicate: "Nær duplikat",
  generic_place_incident: "Generisk steds-hendelse",
  topical_thread: "Tematråd",
  cross_source_incident: "Tverrkilde-hendelse",
  shared_place: "Delt sted",
};

const nearMissLabels: Record<CoverageBundleListItem["nearMisses"][number]["reason"], string> = {
  conflicting_specific_places: "Konflikt i spesifikt sted",
  different_situation: "Annen situasjon",
  outside_time_window: "Utenfor tidsvindu",
  low_text_overlap: "Lav tekstoverlapp",
  stale_persisted_bundle: "Utdatert lagret kobling",
};

const candidateReasonLabels: Record<string, string> = {
  correction_conflict: "Konflikt med aktiv korrigering",
  specific_place: "Konflikt i spesifikt sted",
  incident_subtype: "Konflikt i hendelsestype",
  situation_id: "Konflikt i situasjons-ID",
  topic_opponent: "Konflikt i tema eller motpart",
  weak: "Svakt treff",
  moderate: "Moderat treff til vurdering",
  strong: "Sterkt treff til vurdering",
};

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function percentage(value: number) {
  return `${Math.round(value * 100)} %`;
}

export function coverageWorkspaceFilters(search: string): CoverageWorkspaceFilters {
  const parameters = new URLSearchParams(search);
  const requestedProjection = parameters.get("projection");
  const projection =
    requestedProjection === "legacy" || requestedProjection === "active"
      ? requestedProjection
      : "shadow";
  const matchTier = parameters.get("matchTier");
  const corrected = parameters.get("corrected");
  const integrity = parameters.get("integrity");
  const confidence = parameters.get("confidence");
  const query = parameters.get("q")?.trim() || undefined;
  const cursor = parameters.get("cursor") || undefined;
  const bundleId = parameters.get("bundle") || undefined;
  return {
    projection,
    ...(projection !== "legacy" && (matchTier === "strong" || matchTier === "moderate")
      ? { matchTier }
      : {}),
    ...(corrected === "yes" || corrected === "no" ? { corrected } : {}),
    ...(integrity === "clean" || integrity === "error" ? { integrity } : {}),
    ...(query ? { query } : {}),
    ...(cursor ? { cursor } : {}),
    ...(bundleId ? { bundleId } : {}),
    ...(projection === "legacy" && (confidence === "high" || confidence === "medium")
      ? { confidence }
      : {}),
  };
}

export function coverageWorkspaceSearch(filters: CoverageWorkspaceFilters): string {
  const parameters = new URLSearchParams();
  parameters.set("projection", filters.projection);
  if (filters.projection === "legacy") {
    if (filters.confidence) parameters.set("confidence", filters.confidence);
  } else if (filters.matchTier) {
    parameters.set("matchTier", filters.matchTier);
  }
  if (filters.corrected) parameters.set("corrected", filters.corrected);
  if (filters.integrity) parameters.set("integrity", filters.integrity);
  if (filters.query) parameters.set("q", filters.query);
  if (filters.cursor) parameters.set("cursor", filters.cursor);
  if (filters.bundleId) parameters.set("bundle", filters.bundleId);
  return parameters.toString();
}

function queryFromFilters(filters: CoverageWorkspaceFilters): CoverageBundleQueryInput {
  return {
    projection: filters.projection,
    limit: 30,
    ...(filters.projection === "legacy" && filters.confidence
      ? { confidence: filters.confidence }
      : {}),
    ...(filters.projection !== "legacy" && filters.matchTier
      ? { matchTier: filters.matchTier }
      : {}),
    ...(filters.corrected ? { corrected: filters.corrected === "yes" } : {}),
    ...(filters.integrity
      ? { integrity: filters.integrity === "clean" ? ("ok" as const) : ("error" as const) }
      : {}),
    ...(filters.query ? { q: filters.query } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  };
}

export async function splitCoverageBundleAndRefresh(
  bundleId: string,
  input: CoverageBundleSplitRequest,
  loadCoveragePage: () => Promise<boolean>,
  splitCoverageBundle: (
    bundleId: string,
    input: CoverageBundleSplitRequest,
  ) => Promise<unknown> = api.splitCoverageBundle,
): Promise<"updated" | "conflict" | "reload_failed" | "conflict_reload_failed"> {
  try {
    await splitCoverageBundle(bundleId, input);
    return (await loadCoveragePage()) ? "updated" : "reload_failed";
  } catch (reason) {
    if (!(reason instanceof CoverageCorrectionConflictError)) throw reason;
    return (await loadCoveragePage()) ? "conflict" : "conflict_reload_failed";
  }
}

export async function undoCoverageCorrectionAndRefresh(
  correctionId: string,
  loadCoveragePage: () => Promise<boolean>,
  undoCoverageCorrection: (correctionId: string) => Promise<unknown> = api.undoCoverageCorrection,
) {
  await undoCoverageCorrection(correctionId);
  return loadCoveragePage();
}

function signalText(signal: CoverageBundleListItem["signals"][number]) {
  const metrics = [
    signal.overlap !== undefined ? `${signal.overlap} treff` : undefined,
    signal.score !== undefined ? percentage(signal.score) : undefined,
    signal.detail,
  ].filter(Boolean);
  return metrics.length
    ? `${signalLabels[signal.kind]} · ${metrics.join(" · ")}`
    : signalLabels[signal.kind];
}

function nearMissText(nearMiss: CoverageBundleListItem["nearMisses"][number]) {
  const metrics = [
    nearMiss.overlap !== undefined ? `${nearMiss.overlap} treff` : undefined,
    nearMiss.score !== undefined ? percentage(nearMiss.score) : undefined,
    nearMiss.detail,
  ].filter(Boolean);
  return metrics.length
    ? `${nearMissLabels[nearMiss.reason]} · ${metrics.join(" · ")}`
    : nearMissLabels[nearMiss.reason];
}

function nearMissArticleText(
  nearMiss: CoverageBundleListItem["nearMisses"][number],
  articlesById: Map<string, CoverageBundleListItem["memberArticles"][number]>,
) {
  const articleLabels = nearMiss.articleIds.flatMap((articleId) => {
    const article = articlesById.get(articleId);
    return article ? [`${article.sourceLabel}: ${article.title}`] : [];
  });
  return articleLabels.length ? articleLabels.join(" / ") : nearMiss.articleIds.join(" / ");
}

function candidateReason(candidate: CoverageBundleListItem["reviewCandidates"][number]) {
  return candidate.correctionConflict
    ? "correction_conflict"
    : (candidate.conflicts[0]?.kind ?? candidate.tier);
}

export function groupedCoverageReviewCandidates(bundle: CoverageBundleListItem) {
  const grouped = new Map<string, CoverageBundleListItem["reviewCandidates"]>();
  for (const candidate of bundle.reviewCandidates) {
    const reason = candidateReason(candidate);
    grouped.set(reason, [...(grouped.get(reason) ?? []), candidate]);
  }
  return [...grouped.entries()].map(([reason, candidates]) => ({
    reason,
    total: candidates.length,
    visible: [...candidates].sort((left, right) => right.score - left.score).slice(0, 5),
  }));
}

function acceptedEdges(bundle: CoverageBundleListItem) {
  const memberIds = new Set(bundle.memberArticleIds);
  return bundle.edges.filter(
    (edge) =>
      !edge.reviewable &&
      !edge.correctionConflict &&
      edge.tier !== "weak" &&
      edge.articleIds.every((articleId) => memberIds.has(articleId)),
  );
}

function edgeText(edge: CoverageBundleListItem["edges"][number]) {
  const evidence = edge.signals.map(signalText);
  const conflicts = edge.conflicts.map(({ detail }) => detail);
  return [matchTierLabels[edge.tier], percentage(edge.score), ...evidence, ...conflicts].join(
    " · ",
  );
}

function admissionEdge(bundle: CoverageBundleListItem, memberId: string) {
  const edges = acceptedEdges(bundle)
    .filter(({ articleIds }) => articleIds.includes(memberId))
    .sort((left, right) => right.score - left.score);
  return edges.find(({ articleIds }) => articleIds.includes(bundle.primaryArticleId)) ?? edges[0];
}

function coverageBundleCard(bundle: CoverageBundleListItem) {
  const articles = bundle.memberArticles.map((article) => ({
    ...article,
    scope: "trondheim" as const,
    coverageBundle: bundle,
  }));
  const primary = articles.find(({ id }) => id === bundle.primaryArticleId) ?? articles[0];
  if (!primary) return undefined;
  return homeStoryCardForGroup({
    id: bundle.id,
    primary,
    articles,
    sourceLabels: bundle.sourceLabels,
    bundle,
    acceptedEdges: acceptedEdges(bundle),
  });
}

function integrityErrorParts(error: string) {
  const separator = error.indexOf(":");
  return separator === -1
    ? { errorClass: error, articleId: undefined }
    : { errorClass: error.slice(0, separator), articleId: error.slice(separator + 1) };
}

function CandidateGroups({ bundle }: { bundle: CoverageBundleListItem }) {
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(() => new Set());
  const groups = groupedCoverageReviewCandidates(bundle);
  const articlesById = new Map(
    [...bundle.memberArticles, ...bundle.nearMissArticles].map((article) => [article.id, article]),
  );

  useEffect(() => {
    setExpandedReasons(new Set());
  }, [bundle.id]);

  if (groups.length === 0) {
    return <p className="coverage-bundle-empty">Ingen nesten-treff til vurdering.</p>;
  }

  return (
    <div className="coverage-review-groups">
      {groups.map((group) => {
        const expanded = expandedReasons.has(group.reason);
        const candidates = expanded
          ? bundle.reviewCandidates
              .filter((candidate) => candidateReason(candidate) === group.reason)
              .sort((left, right) => right.score - left.score)
          : group.visible;
        return (
          <section className="coverage-review-group" key={group.reason}>
            <header>
              <div>
                <h4>{candidateReasonLabels[group.reason] ?? group.reason}</h4>
                <span>{group.total} kandidater</span>
              </div>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedReasons((current) => {
                    const next = new Set(current);
                    if (expanded) next.delete(group.reason);
                    else next.add(group.reason);
                    return next;
                  })
                }
              >
                {expanded ? "Vis færre" : `Vis ${group.total} nesten-treff`}
              </button>
            </header>
            <ul className="coverage-bundle-signal-list">
              {candidates.map((candidate) => (
                <li key={candidate.evidenceFingerprint}>
                  <span>{edgeText(candidate)}</span>
                  <small>
                    {candidate.articleIds
                      .map((articleId) => {
                        const article = articlesById.get(articleId);
                        return article ? `${article.sourceLabel}: ${article.title}` : articleId;
                      })
                      .join(" / ")}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BundleDrawer({
  bundle,
  correctionsEnabled,
  mutationPending,
  onSplit,
  onUndo,
}: {
  bundle: CoverageBundleListItem | undefined;
  correctionsEnabled: boolean;
  mutationPending: boolean;
  onSplit?: (bundle: CoverageBundleListItem) => void;
  onUndo?: (correctionId: string) => void;
}) {
  if (!bundle) {
    return (
      <aside className="coverage-bundle-drawer">
        <p className="label">Detalj</p>
        <h2>Ingen gruppe valgt</h2>
      </aside>
    );
  }
  const nearMissArticlesById = new Map(
    [...bundle.memberArticles, ...bundle.nearMissArticles].map((article) => [article.id, article]),
  );
  const bundleAcceptedEdges = acceptedEdges(bundle);
  const weakestAcceptedEdge = [...bundleAcceptedEdges].sort(
    (left, right) => left.score - right.score,
  )[0];
  const card = coverageBundleCard(bundle);

  return (
    <aside className="coverage-bundle-drawer" aria-label={`Detaljer for ${bundle.reason}`}>
      <div className="coverage-bundle-drawer-heading">
        <div>
          <p className="label">{kindLabels[bundle.kind]}</p>
          <h2>{bundle.reason}</h2>
        </div>
        {correctionsEnabled ? (
          <button
            type="button"
            className="coverage-bundle-mutation"
            disabled={mutationPending || !onSplit}
            onClick={() => onSplit?.(bundle)}
          >
            Splitt gruppe
          </button>
        ) : null}
      </div>
      <div className="coverage-bundle-badges">
        <span>{projectionLabels[bundle.state === "superseded" ? "shadow" : bundle.state]}</span>
        <span>{bundle.memberArticles.length} saker</span>
        <span>{bundle.sourceLabels.join(", ")}</span>
      </div>
      <dl className="coverage-bundle-facts">
        <div>
          <dt>Generert</dt>
          <dd>{time(bundle.generatedAt)}</dd>
        </div>
        <div>
          <dt>Sist sett</dt>
          <dd>{time(bundle.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Treffstyrke</dt>
          <dd>
            {bundle.matchConfidence
              ? `${matchTierLabels[bundle.matchConfidence.tier]} · ${percentage(bundle.matchConfidence.score)}`
              : `${confidenceLabels[bundle.confidence]} eldre tillit`}
          </dd>
        </div>
        <div>
          <dt>Matcher</dt>
          <dd>{bundle.matcherVersion ?? "v1"}</dd>
        </div>
      </dl>
      {bundle.matchConfidence ? (
        <section className="coverage-bundle-explanation">
          <h3>Hvorfor er gruppen godkjent?</h3>
          <p>{bundle.matchConfidence.rationale}</p>
        </section>
      ) : null}
      <section>
        <h3>Saker og innslippskanter</h3>
        <div className="coverage-bundle-member-list">
          {bundle.memberArticles.map((article) => {
            const href = safeExternalUrl(article.url);
            const role = article.id === bundle.primaryArticleId ? "Anker" : "Medlem";
            const edge =
              article.id === bundle.primaryArticleId
                ? undefined
                : admissionEdge(bundle, article.id);
            const content = (
              <>
                <span>
                  {role} · {article.sourceLabel}
                </span>
                <strong>{article.title}</strong>
                <small>
                  {time(article.publishedAt)} · {article.places.join(", ") || "Ukjent sted"}
                </small>
                {edge ? <small>Innslippskant: {edgeText(edge)}</small> : null}
              </>
            );
            return href ? (
              <a href={href} key={article.id}>
                {content}
              </a>
            ) : (
              <div className="coverage-bundle-member-linkless" key={article.id}>
                {content}
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <h3>Treffsignaler</h3>
        {bundle.signals.length ? (
          <ul className="coverage-bundle-signal-list">
            {bundle.signals.map((signal) => (
              <li key={`${signal.kind}:${signal.articleIds.join(":")}`}>{signalText(signal)}</li>
            ))}
          </ul>
        ) : (
          <p className="coverage-bundle-empty">Ingen signaler lagret.</p>
        )}
      </section>
      <section>
        <h3>Svakeste godkjente treff</h3>
        {weakestAcceptedEdge ? (
          <p className="coverage-bundle-edge-summary">
            {weakestAcceptedEdge.articleIds.join(" / ")} · {edgeText(weakestAcceptedEdge)}
          </p>
        ) : (
          <p className="coverage-bundle-empty">Ingen normalisert innslippskant lagret.</p>
        )}
      </section>
      <section className="coverage-trust-grid">
        <div>
          <h3>Kildetillit</h3>
          {card ? (
            <p>
              {card.sourceConfidence.label ?? card.sourceConfidence.level}
              {card.sourceConfidence.score !== undefined
                ? ` · ${percentage(card.sourceConfidence.score)}`
                : ""}
              {card.sourceConfidence.rationale ? ` · ${card.sourceConfidence.rationale}` : ""}
            </p>
          ) : (
            <p>Ikke tilgjengelig.</p>
          )}
        </div>
        <div>
          <h3>Direkte verifiseringskant</h3>
          <p>
            {card?.verification
              ? `${card.verification.label} · ${card.verification.sourceSummary} · ${card.verification.detail}`
              : "Ingen direkte sterk offisiell verifiseringskant."}
          </p>
        </div>
      </section>
      {bundle.state === "legacy" ? (
        <section>
          <h3>Nesten-treff</h3>
          {bundle.nearMisses.length ? (
            <ul className="coverage-bundle-signal-list">
              {bundle.nearMisses.map((nearMiss) => (
                <li key={`${nearMiss.reason}:${nearMiss.articleIds.join(":")}`}>
                  <span>{nearMissText(nearMiss)}</span>
                  <small>{nearMissArticleText(nearMiss, nearMissArticlesById)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="coverage-bundle-empty">Ingen nesten-treff lagret.</p>
          )}
        </section>
      ) : (
        <section>
          <h3>Til vurdering</h3>
          <CandidateGroups bundle={bundle} />
        </section>
      )}
      {bundle.integrityErrors.length ? (
        <section className="coverage-integrity-errors" role="alert">
          <h3>Dataintegritet</h3>
          <ul>
            {bundle.integrityErrors.map((integrityError) => {
              const parts = integrityErrorParts(integrityError);
              return (
                <li key={integrityError}>
                  <strong>{parts.errorClass}</strong>
                  {parts.articleId ? ` · ${parts.articleId}` : ""}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <section>
        <h3>Korrigeringshistorikk</h3>
        {bundle.corrections.length ? (
          <ul className="coverage-correction-history">
            {bundle.corrections.map((correction) => (
              <li key={correction.id}>
                <div>
                  <strong>
                    {correction.status === "active"
                      ? "Aktiv korrigering"
                      : "Tilbakestilt korrigering"}
                  </strong>
                  <span>
                    {correction.anchorArticleId} / {correction.rejectedArticleId}
                  </span>
                  <small>
                    Opprettet {time(correction.createdAt)}
                    {correction.revertedAt ? ` · angret ${time(correction.revertedAt)}` : ""}
                  </small>
                </div>
                {correctionsEnabled && correction.status === "active" ? (
                  <button
                    type="button"
                    disabled={mutationPending || !onUndo}
                    onClick={() => onUndo?.(correction.id)}
                  >
                    Angre
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="coverage-bundle-empty">Ingen korrigeringer registrert.</p>
        )}
      </section>
    </aside>
  );
}

export function CoverageBundlesDashboard({
  page,
  filters,
  onFiltersChange,
  mutationPending = false,
  visibleError,
  onSplit,
  onUndo,
}: {
  page: CoverageBundlePage;
  filters: CoverageWorkspaceFilters;
  onFiltersChange: (filters: CoverageWorkspaceFilters) => void;
  mutationPending?: boolean;
  visibleError?: string;
  onSplit?: (bundle: CoverageBundleListItem) => void;
  onUndo?: (correctionId: string) => void;
}) {
  const selectedBundle = page.items.find((item) => item.id === filters.bundleId) ?? page.items[0];
  const parityClean = page.parity?.clean !== false;
  const integrityClean = page.summary.integrityErrorCount === 0;
  const correctionsEnabled =
    page.correctionsEnabled === true &&
    (filters.projection === "shadow" || filters.projection === "active") &&
    (selectedBundle?.state === "shadow" || selectedBundle?.state === "active");

  function update(next: Partial<CoverageWorkspaceFilters>) {
    onFiltersChange({ ...filters, cursor: undefined, bundleId: undefined, ...next });
  }

  return (
    <main className="coverage-bundles-page">
      <header className="coverage-bundles-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Dekningsgrupper</h1>
          <p>
            Matcher {page.summary.matcherVersion} · siste vellykkede generering{" "}
            {time(page.summary.generation?.completedAt ?? page.summary.latestGeneratedAt)}
          </p>
        </div>
        <div className="coverage-bundles-actions">
          <Link to="/command">Kommandosenter</Link>
          <Link to="/command/tidslinje">Tidslinje</Link>
          <Link to="/command/kilder">Kilderevisjon</Link>
        </div>
      </header>
      {visibleError ? (
        <div className="coverage-workspace-alert" role="alert">
          {visibleError}
        </div>
      ) : null}
      {!parityClean || !integrityClean ? (
        <section className="coverage-workspace-alert" role="alert">
          <strong>Dataintegritet krever gjennomgang</strong>
          {!parityClean ? <p>Skyggevisningen avviker fra dagens publiserte grupper</p> : null}
          {!integrityClean ? (
            <p>{page.summary.integrityErrorCount} integritetsfeil i utvalget.</p>
          ) : null}
        </section>
      ) : page.parity ? (
        <section className="coverage-workspace-ready" aria-label="Projeksjonsstatus">
          <strong>Offentlig projeksjon samsvarer</strong>
          <span>Ingen medlems- eller primæravvik i sammenligningen.</span>
        </section>
      ) : null}
      <section className="coverage-bundles-summary" aria-label="Dekningsoppsummering">
        <article>
          <strong>{page.summary.activeBundleCount}</strong>
          <span>Aktive grupper</span>
        </article>
        <article>
          <strong>{page.summary.byMatchTier.strong}</strong>
          <span>Sterke treff</span>
        </article>
        <article>
          <strong>{page.summary.byMatchTier.moderate}</strong>
          <span>Moderate treff</span>
        </article>
        <article>
          <strong>{page.summary.reviewCandidateCount}</strong>
          <span>Til vurdering</span>
        </article>
        <article>
          <strong>{page.summary.activeCorrectionCount}</strong>
          <span>Aktive korrigeringer</span>
        </article>
        <article>
          <strong>{page.summary.integrityErrorCount}</strong>
          <span>Dataintegritet</span>
        </article>
      </section>
      <section className="coverage-export-panel">
        <div>
          <strong>Korrigeringskorpus</strong>
          <p>Gjennomgå og anonymiser eksporten før den legges i testkorpuset.</p>
        </div>
        <a href="/api/operations/coverage-corrections/export?sinceDays=30" download>
          Eksporter korrigeringer
        </a>
      </section>
      <div className="coverage-bundles-grid">
        <aside className="coverage-bundles-sidebar" aria-label="Dekningsfiltre">
          <label>
            Søk
            <input
              value={filters.query ?? ""}
              onChange={(event) => update({ query: event.target.value || undefined })}
              placeholder="Søk i grupper"
            />
          </label>
          <label>
            Projeksjon
            <select
              value={filters.projection}
              onChange={(event) =>
                update({
                  projection: event.target.value as CoverageWorkspaceFilters["projection"],
                  matchTier: undefined,
                  confidence: undefined,
                })
              }
            >
              <option value="shadow">Skyggevisning</option>
              <option value="active">Aktiv v2-visning</option>
              <option value="legacy">Dagens publiserte</option>
            </select>
          </label>
          {filters.projection === "legacy" ? (
            <label>
              Eldre tillit
              <select
                value={filters.confidence ?? ""}
                onChange={(event) =>
                  update({
                    confidence: (event.target.value ||
                      undefined) as CoverageWorkspaceFilters["confidence"],
                  })
                }
              >
                <option value="">Alle</option>
                <option value="high">Høy</option>
                <option value="medium">Middels</option>
              </select>
            </label>
          ) : (
            <label>
              Treffstyrke
              <select
                value={filters.matchTier ?? ""}
                onChange={(event) =>
                  update({
                    matchTier: (event.target.value ||
                      undefined) as CoverageWorkspaceFilters["matchTier"],
                  })
                }
              >
                <option value="">Alle</option>
                <option value="strong">Sterke treff</option>
                <option value="moderate">Moderate treff</option>
              </select>
            </label>
          )}
          <label>
            Korrigert
            <select
              value={filters.corrected ?? ""}
              onChange={(event) =>
                update({
                  corrected: (event.target.value ||
                    undefined) as CoverageWorkspaceFilters["corrected"],
                })
              }
            >
              <option value="">Alle</option>
              <option value="yes">Med aktiv korrigering</option>
              <option value="no">Uten aktiv korrigering</option>
            </select>
          </label>
          <label>
            Dataintegritet
            <select
              value={filters.integrity ?? ""}
              onChange={(event) =>
                update({
                  integrity: (event.target.value ||
                    undefined) as CoverageWorkspaceFilters["integrity"],
                })
              }
            >
              <option value="">Alle</option>
              <option value="clean">Uten feil</option>
              <option value="error">Med feil</option>
            </select>
          </label>
        </aside>
        <section className="coverage-bundle-list" aria-labelledby="coverage-bundle-list-heading">
          <div className="coverage-bundle-list-heading">
            <div>
              <p className="label">{projectionLabels[filters.projection]}</p>
              <h2 id="coverage-bundle-list-heading">Grupper til gjennomgang</h2>
            </div>
            {page.nextCursor ? (
              <button
                type="button"
                onClick={() => onFiltersChange({ ...filters, cursor: page.nextCursor })}
              >
                Neste side
              </button>
            ) : null}
          </div>
          {page.items.length ? (
            page.items.map((bundle) => {
              const selected = selectedBundle?.id === bundle.id;
              return (
                <button
                  className={`coverage-bundle-row ${selected ? "selected" : ""}`}
                  data-coverage-bundle-row
                  key={bundle.id}
                  onClick={() => onFiltersChange({ ...filters, bundleId: bundle.id })}
                  type="button"
                >
                  <span className="coverage-bundle-row-main">
                    <strong>{bundle.reason}</strong>
                    <small>
                      {bundle.sourceLabels.join(", ")} · {time(bundle.lastSeenAt)}
                    </small>
                  </span>
                  <span className="coverage-bundle-row-meta">
                    <span>{kindLabels[bundle.kind]}</span>
                    <span>
                      {bundle.matchConfidence
                        ? matchTierLabels[bundle.matchConfidence.tier]
                        : confidenceLabels[bundle.confidence]}
                    </span>
                    <span>{bundle.memberArticles.length} saker</span>
                    {bundle.corrections.some(({ status }) => status === "active") ? (
                      <span>Korrigert</span>
                    ) : null}
                    {bundle.integrityErrors.length ? <span>Integritetsfeil</span> : null}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="coverage-bundle-empty">Ingen dekningsgrupper matcher filteret.</p>
          )}
        </section>
        <BundleDrawer
          bundle={selectedBundle}
          correctionsEnabled={correctionsEnabled}
          mutationPending={mutationPending}
          onSplit={onSplit}
          onUndo={onUndo}
        />
      </div>
    </main>
  );
}

export function CoverageBundlesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const filters = useMemo(() => coverageWorkspaceFilters(searchText), [searchText]);
  const [page, setPage] = useState<CoverageBundlePage>();
  const [selectedBundle, setSelectedBundle] = useState<CoverageBundleListItem>();
  const [pendingAction, setPendingAction] = useState<"split" | `undo:${string}`>();
  const [visibleError, setVisibleError] = useState<string>();
  const requestIdRef = useRef(0);

  const loadCoveragePage = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setVisibleError(undefined);
    try {
      const response = await api.coverageBundles(queryFromFilters(filters));
      if (requestId === requestIdRef.current) setPage(response);
      return true;
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setVisibleError(
          reason instanceof Error ? reason.message : "Kunne ikke hente dekningsgrupper.",
        );
      }
      return false;
    }
  }, [filters]);

  useEffect(() => {
    void loadCoveragePage();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadCoveragePage]);

  function updateFilters(next: CoverageWorkspaceFilters) {
    setSearchParams(coverageWorkspaceSearch(next), { replace: true });
  }

  async function handleSplit(input: CoverageBundleSplitRequest) {
    if (!selectedBundle || pendingAction) return;
    setPendingAction("split");
    setVisibleError(undefined);
    try {
      const outcome = await splitCoverageBundleAndRefresh(
        selectedBundle.id,
        input,
        loadCoveragePage,
      );
      setSelectedBundle(undefined);
      if (outcome === "conflict") {
        setVisibleError(
          "Gruppen ble endret mens du vurderte den. Arbeidsområdet er lastet på nytt.",
        );
      } else if (outcome === "reload_failed") {
        setVisibleError(
          "Endringen ble lagret, men arbeidsområdet kunne ikke lastes på nytt. Oppdater siden.",
        );
      } else if (outcome === "conflict_reload_failed") {
        setVisibleError(
          "Gruppen ble endret, og det oppdaterte arbeidsområdet kunne ikke hentes. Oppdater siden.",
        );
      }
    } catch (reason) {
      setVisibleError(reason instanceof Error ? reason.message : "Kunne ikke splitte gruppen.");
    } finally {
      setPendingAction(undefined);
    }
  }

  async function handleUndo(correctionId: string) {
    if (pendingAction) return;
    setPendingAction(`undo:${correctionId}`);
    setVisibleError(undefined);
    try {
      const refreshed = await undoCoverageCorrectionAndRefresh(correctionId, loadCoveragePage);
      if (!refreshed) {
        setVisibleError(
          "Korrigeringen ble angret, men arbeidsområdet kunne ikke lastes på nytt. Oppdater siden.",
        );
      }
    } catch (reason) {
      setVisibleError(reason instanceof Error ? reason.message : "Kunne ikke angre korrigeringen.");
    } finally {
      setPendingAction(undefined);
    }
  }

  if (!page) {
    return (
      <main
        className={`coverage-bundles-page ${visibleError ? "coverage-bundles-error" : ""}`}
        role={visibleError ? "alert" : undefined}
      >
        {visibleError
          ? `Kunne ikke hente dekningsgrupper: ${visibleError}`
          : "Henter dekningsgrupper..."}
      </main>
    );
  }

  const correctionCard = selectedBundle ? coverageBundleCard(selectedBundle) : undefined;

  return (
    <>
      <CoverageBundlesDashboard
        page={page}
        filters={filters}
        onFiltersChange={updateFilters}
        mutationPending={pendingAction !== undefined}
        visibleError={selectedBundle ? undefined : visibleError}
        onSplit={(bundle) => {
          setVisibleError(undefined);
          setSelectedBundle(bundle);
        }}
        onUndo={(correctionId) => void handleUndo(correctionId)}
      />
      {selectedBundle && correctionCard ? (
        <CoverageCorrectionDialog
          card={correctionCard}
          pending={pendingAction === "split"}
          error={visibleError}
          onCancel={() => {
            if (pendingAction) return;
            setVisibleError(undefined);
            setSelectedBundle(undefined);
          }}
          onConfirm={(input) => void handleSplit(input)}
        />
      ) : null}
    </>
  );
}
