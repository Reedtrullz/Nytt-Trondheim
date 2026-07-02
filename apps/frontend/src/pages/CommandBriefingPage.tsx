import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AiAnalysisProfile,
  AiProcessingRunDiagnostics,
  CommandCenterBriefingPayload,
  CommandCenterOperationsNote,
  SourceHealth,
} from "@nytt/shared";
import { api, ApiError } from "../api.js";

const noteKindLabels: Record<CommandCenterOperationsNote["kind"], string> = {
  situation_progress: "Situasjonsutvikling",
  bundle_candidate: "Mulig samling",
  category_relevance: "Kategori/relevans",
  source_quality: "Kildekvalitet",
  other: "Annet",
};

const aiProfileLabels: Record<AiAnalysisProfile, string> = {
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

function aiRunPath(id: string) {
  return `/command/radata?run=${encodeURIComponent(id)}`;
}

function aiProfileLabel(diagnostics?: AiProcessingRunDiagnostics) {
  return diagnostics ? aiProfileLabels[diagnostics.profile] : "Ukjent profil";
}

export function CommandBriefingDashboard({ briefing }: { briefing: CommandCenterBriefingPayload }) {
  const { morningBrief } = briefing;
  return (
    <main className="command-briefing-page">
      <header className="command-briefing-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Brief-revisjon</h1>
          <p>
            Eierflate for å kontrollere morgenbriefen, AI-status og hvilke saker som ligger bak.
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
          <span>AI-kjøring</span>
          <strong>{briefing.latestAiRun?.status ?? "Ikke registrert"}</strong>
          <small>
            {briefing.latestAiRun
              ? `${briefing.latestAiRun.model} · ${aiProfileLabel(
                  briefing.latestAiRun.diagnostics,
                )} · ${time(briefing.latestAiRun.completedAt)}`
              : "Ingen AI-run funnet"}
          </small>
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
            AI-notater
          </small>
        </article>
      </section>

      <section className="command-briefing-layout">
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
              lagret en AI- eller reservebrief.
            </p>
          )}
        </section>

        <section className="command-briefing-card">
          <div className="command-briefing-section-heading">
            <div>
              <p className="label">AI-spor</p>
              <h2>Siste analyse</h2>
            </div>
            {briefing.latestAiRun ? (
              <Link to={aiRunPath(briefing.latestAiRun.id)}>Åpne råresultat</Link>
            ) : null}
          </div>
          {briefing.latestAiRun ? (
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
                <dd>{aiProfileLabel(briefing.latestAiRun.diagnostics)}</dd>
              </div>
              {briefing.latestAiRun.diagnostics ? (
                <div>
                  <dt>Forsøk</dt>
                  <dd>
                    {briefing.latestAiRun.diagnostics.attempts.length} ·{" "}
                    {briefing.latestAiRun.diagnostics.attempts
                      .map(
                        (attempt) =>
                          `${aiProfileLabels[attempt.profile]} ${
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
          ) : (
            <p className="command-briefing-empty">Ingen AI-kjøringer er lagret ennå.</p>
          )}
        </section>

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

        <section className="command-briefing-card">
          <div className="command-briefing-section-heading">
            <div>
              <p className="label">AI-operatørnotater</p>
              <h2>Signalene DeepSeek flagget</h2>
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
              Ingen operatørnotater i siste AI-resultat. Det kan være normalt ved deterministisk
              reserve eller tomt nyhetsbilde.
            </p>
          )}
        </section>

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
                    {situation.locationLabel} · {situation.status} · {situation.verificationStatus}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="command-briefing-empty">Briefen er ikke koblet til situasjonsrom ennå.</p>
          )}
        </section>

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
      </section>
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
