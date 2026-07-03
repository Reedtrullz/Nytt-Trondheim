import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AiAnalysisProfile,
  AiProcessingRunDiagnostics,
  CommandCenterBriefingPayload,
  CommandCenterOperationsNote,
  MorningBrief,
  RawInspectorAiRunSummary,
  SourceHealth,
} from "@nytt/shared";
import { api, ApiError } from "../api.js";
import { DashboardGrid, type DashboardWidgetDefinition } from "../components/DashboardGrid.js";

const noteKindLabels: Record<CommandCenterOperationsNote["kind"], string> = {
  situation_progress: "Situasjonsutvikling",
  bundle_candidate: "Mulig samling",
  category_relevance: "Kategori/relevans",
  source_quality: "Kildekvalitet",
  other: "Annet",
};

const analysisProfileLabels: Record<AiAnalysisProfile, string> = {
  standard: "Full analyse",
  compact_recovery: "Kompakt gjenoppretting",
  brief_only_recovery: "Kun morgenbrief",
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

function sourceStateLabel(source: SourceHealth) {
  if (source.state === "ok" && !source.activeAlerts?.length) return "OK";
  if (source.state === "ok") return "Varsel";
  if (source.state === "degraded") return "Degradert";
  return "Feilet";
}

function analysisRunPath(id: string) {
  return `/command/radata?run=${encodeURIComponent(id)}`;
}

function analysisProfileLabel(diagnostics?: AiProcessingRunDiagnostics) {
  return diagnostics ? analysisProfileLabels[diagnostics.profile] : "Ukjent profil";
}

export function analysisModeSummary(
  run?: RawInspectorAiRunSummary,
  morningBrief?: MorningBrief,
): {
  detail: string;
  label: string;
  tone: "ai" | "fallback" | "degraded" | "missing";
} {
  if (!run) {
    return {
      label:
        morningBrief?.mode === "deterministic" ? "Reserve uten lagret kjøring" : "Ikke registrert",
      detail: "Ingen analysekjøring er lagret for denne briefen ennå.",
      tone: "missing",
    };
  }

  if (run.provider === "deterministic" || run.status === "disabled") {
    return {
      label: "Deterministisk reserve",
      detail:
        "Provideranalyse er avslått; regelbasert clustering, situasjonskobling og reservebrief brukes.",
      tone: "fallback",
    };
  }

  const successfulAttempt = [...(run.diagnostics?.attempts ?? [])]
    .reverse()
    .find((attempt) => attempt.status === "ok");
  const hadFailedAttempt = (run.diagnostics?.attempts ?? []).some(
    (attempt) => attempt.status === "failed",
  );
  if (run.status === "degraded" || hadFailedAttempt) {
    return {
      label: successfulAttempt ? "Gjenopprettet provideranalyse" : "Degradert provideranalyse",
      detail: successfulAttempt
        ? `${analysisProfileLabels[successfulAttempt.profile]} fullførte etter tidligere avvik.`
        : "Provideranalysen feilet eller manglet strukturert svar; deterministisk analyse brukes som sikring.",
      tone: "degraded",
    };
  }

  return {
    label: "Provideranalyse brukt",
    detail: `${run.model} fullførte ${analysisProfileLabel(run.diagnostics).toLowerCase()}.`,
    tone: "ai",
  };
}

export function CommandBriefingDashboard({ briefing }: { briefing: CommandCenterBriefingPayload }) {
  const { morningBrief } = briefing;
  const analysisMode = analysisModeSummary(briefing.latestAiRun, morningBrief);
  const widgets = useMemo<DashboardWidgetDefinition[]>(
    () => [
      {
        id: "published-brief",
        title: "Publisert bypuls",
        description: "Morgenbriefen slik den forklares på City Pulse.",
        defaultSize: "large",
        children: (
          <section className="command-briefing-card command-briefing-card-large">
            <div className="command-briefing-section-heading">
              <div>
                <p className="label">Publisert bypuls</p>
                <h2>{morningBrief?.title ?? "Ingen morgenbrief lagret"}</h2>
              </div>
              <span>{morningBrief?.sourceLine ?? "Venter på worker"}</span>
            </div>
            {morningBrief ? (
              <>
                <ol className="command-briefing-paragraphs">
                  {morningBrief.paragraphs.map((paragraph, index) => (
                    <li key={paragraph}>
                      <span>{index + 1}</span>
                      <p>{paragraph}</p>
                    </li>
                  ))}
                </ol>
                <div className="command-briefing-highlights">
                  {morningBrief.highlights.map((highlight) => (
                    <article key={highlight.label}>
                      <span>{highlight.label}</span>
                      <strong>{highlight.value}</strong>
                      <small>{highlight.detail}</small>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="command-briefing-empty">
                Ingen lagret brief ennå. Forsiden bruker deterministisk reserve når worker ikke har
                lagret en analysert brief.
              </p>
            )}
          </section>
        ),
      },
      {
        id: "ai-trace",
        title: "Analysespor",
        description: "Analysemodell, gjenopprettingsprofil og siste råresultat.",
        defaultSize: "standard",
        children: (
          <section className="command-briefing-card">
            <div className="command-briefing-section-heading">
              <div>
                <p className="label">Analysespor</p>
                <h2>Siste analyse</h2>
              </div>
              {briefing.latestAiRun ? (
                <Link to={analysisRunPath(briefing.latestAiRun.id)}>Åpne råresultat</Link>
              ) : null}
            </div>
            {briefing.latestAiRun ? (
              <>
                <div className={`command-briefing-analysis-mode mode-${analysisMode.tone}`}>
                  <span>Analysemodus</span>
                  <strong>{analysisMode.label}</strong>
                  <p>{analysisMode.detail}</p>
                </div>
                <dl className="command-briefing-ai-meta">
                  <div>
                    <dt>Status</dt>
                    <dd>{briefing.latestAiRun.status}</dd>
                  </div>
                  <div>
                    <dt>Modell</dt>
                    <dd>{briefing.latestAiRun.model}</dd>
                  </div>
                  <div>
                    <dt>Saker lest</dt>
                    <dd>{briefing.latestAiRun.articleCount}</dd>
                  </div>
                  <div>
                    <dt>Profil</dt>
                    <dd>{analysisProfileLabel(briefing.latestAiRun.diagnostics)}</dd>
                  </div>
                  {briefing.latestAiRun.diagnostics ? (
                    <div>
                      <dt>Forsøk</dt>
                      <dd>
                        {briefing.latestAiRun.diagnostics.attempts.length} ·{" "}
                        {briefing.latestAiRun.diagnostics.attempts
                          .map(
                            (attempt) =>
                              `${analysisProfileLabels[attempt.profile]} ${
                                attempt.status === "ok" ? "OK" : "feilet"
                              }`,
                          )
                          .join(", ")}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Ferdig</dt>
                    <dd>{time(briefing.latestAiRun.completedAt)}</dd>
                  </div>
                  {briefing.latestAiRun.error ? (
                    <div>
                      <dt>Avvik</dt>
                      <dd>{briefing.latestAiRun.error}</dd>
                    </div>
                  ) : null}
                </dl>
              </>
            ) : (
              <div className={`command-briefing-analysis-mode mode-${analysisMode.tone}`}>
                <span>Analysemodus</span>
                <strong>{analysisMode.label}</strong>
                <p>{analysisMode.detail}</p>
              </div>
            )}
          </section>
        ),
      },
      {
        id: "supporting-stories",
        title: "Historier bak briefen",
        description: "Artikler analysen peker på som grunnlag.",
        defaultSize: "large",
        children: (
          <section className="command-briefing-card command-briefing-card-large">
            <div className="command-briefing-section-heading">
              <div>
                <p className="label">Støttende saker</p>
                <h2>Historier bak briefen</h2>
              </div>
              <span>{briefing.supportingArticles.length} saker</span>
            </div>
            {briefing.supportingArticles.length ? (
              <ul className="command-briefing-story-list">
                {briefing.supportingArticles.map((article) => (
                  <li key={article.id}>
                    <div>
                      <span>
                        {article.sourceLabel} · {time(article.publishedAt)}
                      </span>
                      <strong>{article.title}</strong>
                      <p>{article.excerpt}</p>
                    </div>
                    {article.url ? (
                      <a href={article.url} rel="noreferrer" target="_blank">
                        Kilde
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="command-briefing-empty">Briefen peker ikke på lagrede saker ennå.</p>
            )}
          </section>
        ),
      },
      {
        id: "operator-notes",
        title: "Operatørnotater",
        description: "Signalene analysen flagget for eiergjennomgang.",
        defaultSize: "standard",
        children: (
          <section className="command-briefing-card">
            <div className="command-briefing-section-heading">
              <div>
                <p className="label">Operatørnotater</p>
                <h2>Signalene analysen flagget</h2>
              </div>
              <span>{briefing.operationsNotes.length} notater</span>
            </div>
            {briefing.operationsNotes.length ? (
              <ul className="command-briefing-note-list">
                {briefing.operationsNotes.map((note, index) => (
                  <li key={`${note.kind}:${note.subjectId}:${index}`}>
                    <span>{noteKindLabels[note.kind]}</span>
                    <strong>{note.summary}</strong>
                    <small>{note.subjectId}</small>
                    {note.citedClaims.length ? (
                      <ul>
                        {note.citedClaims.slice(0, 2).map((claim) => (
                          <li key={`${claim.articleId}:${claim.claim}`}>
                            {claim.claim} <em>{claim.supportingSnippet}</em>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="command-briefing-empty">
                Ingen operatørnotater i siste analyseresultat. Det kan være normalt ved
                deterministisk reserve eller tomt nyhetsbilde.
              </p>
            )}
          </section>
        ),
      },
      {
        id: "situation-context",
        title: "Koblet kontekst",
        description: "Situasjonsrom briefen peker tilbake til.",
        defaultSize: "standard",
        children: (
          <section className="command-briefing-card">
            <div className="command-briefing-section-heading">
              <div>
                <p className="label">Situasjoner</p>
                <h2>Koblet kontekst</h2>
              </div>
              <span>{briefing.supportingSituations.length} rom</span>
            </div>
            {briefing.supportingSituations.length ? (
              <ul className="command-briefing-situation-list">
                {briefing.supportingSituations.map((situation) => (
                  <li key={situation.id}>
                    <Link to={`/situasjoner/${encodeURIComponent(situation.id)}`}>
                      {situation.title}
                    </Link>
                    <span>
                      {situation.locationLabel} · {situation.status} ·{" "}
                      {situation.verificationStatus}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="command-briefing-empty">
                Briefen er ikke koblet til situasjonsrom ennå.
              </p>
            )}
          </section>
        ),
      },
      {
        id: "source-health",
        title: "Kildehelse",
        description: "Kilder som trenger tilsyn før neste brief.",
        defaultSize: "standard",
        children: (
          <section className="command-briefing-card">
            <div className="command-briefing-section-heading">
              <div>
                <p className="label">Kildehelse</p>
                <h2>Tilsyn</h2>
              </div>
              <Link to="/command/kilder">Åpne revisjon</Link>
            </div>
            {briefing.attentionSources.length ? (
              <ul className="command-briefing-source-list">
                {briefing.attentionSources.slice(0, 8).map((source) => (
                  <li key={source.source}>
                    <strong>{source.label}</strong>
                    <span>{sourceStateLabel(source)}</span>
                    <small>{source.detail}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="command-briefing-empty">
                Alle kilder rapporterer OK uten aktive varsler.
              </p>
            )}
          </section>
        ),
      },
    ],
    [analysisMode.detail, analysisMode.label, analysisMode.tone, briefing, morningBrief],
  );

  return (
    <main className="command-briefing-page">
      <header className="command-briefing-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Brief-revisjon</h1>
          <p>
            Eierflate for å kontrollere morgenbriefen, analysestatus og hvilke saker som ligger bak.
          </p>
        </div>
        <div className="coverage-bundles-actions">
          <Link to="/command">Kommandosenter</Link>
          <Link to="/command/radata">Rådata</Link>
          <Link to="/command/kilder">Kilderevisjon</Link>
        </div>
      </header>

      <section className="command-briefing-summary" aria-label="Briefstatus">
        <article>
          <span>Brief</span>
          <strong>{morningBrief ? morningBrief.mode : "Mangler"}</strong>
          <small>{time(morningBrief?.generatedAt ?? briefing.generatedAt)}</small>
        </article>
        <article>
          <span>Analysekjøring</span>
          <strong>{briefing.latestAiRun?.status ?? "Ikke registrert"}</strong>
          <small>
            {briefing.latestAiRun
              ? `${briefing.latestAiRun.model} · ${analysisProfileLabel(
                  briefing.latestAiRun.diagnostics,
                )} · ${time(briefing.latestAiRun.completedAt)}`
              : "Ingen analysekjøring funnet"}
          </small>
        </article>
        <article className={`command-briefing-summary-mode mode-${analysisMode.tone}`}>
          <span>Analysemodus</span>
          <strong>{analysisMode.label}</strong>
          <small>{analysisMode.detail}</small>
        </article>
        <article>
          <span>Kilder OK</span>
          <strong>
            {briefing.sourceHealthSummary.ok}/{briefing.sourceHealthSummary.total}
          </strong>
          <small>{briefing.sourceHealthSummary.attention} trenger tilsyn</small>
        </article>
        <article>
          <span>Støtte</span>
          <strong>{briefing.supportingArticles.length}</strong>
          <small>
            {briefing.supportingSituations.length} situasjoner · {briefing.operationsNotes.length}{" "}
            analysenotater
          </small>
        </article>
      </section>

      <DashboardGrid
        ariaLabel="Brief-revisjon-moduler"
        configMode="toggle"
        description="Dra og størrelsesjuster briefmoduler mens du kontrollerer analysegrunnlaget."
        label="Modulært kommandosenter"
        storageKey="nytt-command-briefing-dashboard-v1"
        title="Brief-arbeidsflate"
        widgets={widgets}
      />
    </main>
  );
}

export function CommandBriefingPage() {
  const [briefing, setBriefing] = useState<CommandCenterBriefingPayload>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    api
      .commandBriefing()
      .then((next) => {
        if (!cancelled) setBriefing(next);
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(
          nextError instanceof ApiError ? nextError.message : "Klarte ikke hente brief-revisjonen.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <main className="command-briefing-page">
        <p className="command-briefing-empty">{error}</p>
      </main>
    );
  }

  if (!briefing) {
    return (
      <main className="command-briefing-page">
        <p className="command-briefing-empty">Henter brief-revisjon...</p>
      </main>
    );
  }

  return <CommandBriefingDashboard briefing={briefing} />;
}
