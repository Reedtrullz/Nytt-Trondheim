import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  AiAnalysisProfile,
  AiProcessingRunDiagnostics,
  RawInspectorAiRunDetail,
  RawInspectorAiRunFilters,
  RawInspectorAiRunPage,
  RawInspectorSourceItemDetail,
  SourceItemFilters,
  SourceItemPage,
} from "@nytt/shared";
import { api } from "../api.js";

interface RawInspectorViewFilters extends RawInspectorAiRunFilters {
  sourceItem?: string;
  sourceKind?: SourceItemFilters["kind"];
  sourceQ?: string;
  sourceCursor?: string;
  run?: string;
}

const providerLabels: Record<NonNullable<RawInspectorAiRunFilters["provider"]>, string> = {
  deepseek: "DeepSeek",
  deterministic: "Deterministisk",
};

const statusLabels: Record<NonNullable<RawInspectorAiRunFilters["status"]>, string> = {
  ok: "OK",
  degraded: "Degradert",
  disabled: "Avslått",
};

const aiProfileLabels: Record<AiAnalysisProfile, string> = {
  standard: "Full analyse",
  compact_recovery: "Kompakt gjenoppretting",
  brief_only_recovery: "Kun morgenbrief",
};

const sourceKindLabels = {
  article: "Artikkel",
  official_event: "Offisiell hendelse",
  warning: "Farevarsel",
  reporter_note: "Redaksjonsnotat",
  reader_tip: "Lesertips",
  media_asset: "Medieobjekt",
} as const satisfies Record<NonNullable<SourceItemFilters["kind"]>, string>;

function parseRawInspectorFilters(search: string): RawInspectorViewFilters {
  const parameters = new URLSearchParams(search);
  const provider = parameters.get("provider");
  const status = parameters.get("status");
  const sourceKind = parameters.get("sourceKind");
  const q = parameters.get("q")?.trim() || undefined;
  const sourceQ = parameters.get("sourceQ")?.trim() || undefined;
  const cursor = parameters.get("cursor") || undefined;
  const sourceCursor = parameters.get("sourceCursor") || undefined;
  const sourceItem = parameters.get("sourceItem")?.trim() || undefined;
  const run = parameters.get("run")?.trim() || undefined;
  return {
    limit: 20,
    ...(provider === "deepseek" || provider === "deterministic" ? { provider } : {}),
    ...(status === "ok" || status === "degraded" || status === "disabled" ? { status } : {}),
    ...(sourceKind && sourceKind in sourceKindLabels
      ? { sourceKind: sourceKind as SourceItemFilters["kind"] }
      : {}),
    ...(q ? { q } : {}),
    ...(sourceQ ? { sourceQ } : {}),
    ...(cursor ? { cursor } : {}),
    ...(sourceCursor ? { sourceCursor } : {}),
    ...(sourceItem ? { sourceItem } : {}),
    ...(run ? { run } : {}),
  };
}

function buildRawInspectorSearch(filters: RawInspectorViewFilters) {
  const parameters = new URLSearchParams();
  if (filters.provider) parameters.set("provider", filters.provider);
  if (filters.status) parameters.set("status", filters.status);
  if (filters.sourceKind) parameters.set("sourceKind", filters.sourceKind);
  if (filters.q) parameters.set("q", filters.q);
  if (filters.sourceQ) parameters.set("sourceQ", filters.sourceQ);
  if (filters.cursor) parameters.set("cursor", filters.cursor);
  if (filters.sourceCursor) parameters.set("sourceCursor", filters.sourceCursor);
  if (filters.sourceItem) parameters.set("sourceItem", filters.sourceItem);
  if (filters.run) parameters.set("run", filters.run);
  return parameters;
}

function aiRunQuery(filters: RawInspectorViewFilters): RawInspectorAiRunFilters {
  return {
    limit: filters.limit ?? 20,
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  };
}

function sourceItemQuery(filters: RawInspectorViewFilters): SourceItemFilters {
  return {
    limit: 12,
    ...(filters.sourceKind ? { kind: filters.sourceKind } : {}),
    ...(filters.sourceQ ? { q: filters.sourceQ } : {}),
    ...(filters.sourceCursor ? { cursor: filters.sourceCursor } : {}),
  };
}

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function aiProfileLabel(diagnostics?: AiProcessingRunDiagnostics) {
  return diagnostics ? aiProfileLabels[diagnostics.profile] : "Ukjent profil";
}

function PayloadPanel({ title, value, note }: { title: string; value: unknown; note?: string }) {
  return (
    <section className="raw-inspector-payload">
      <div>
        <h3>{title}</h3>
        {note ? <p>{note}</p> : null}
      </div>
      <pre>{prettyJson(value)}</pre>
    </section>
  );
}

export function RawDataInspectorDashboard({
  filters,
  aiRuns,
  sourceItems = { items: [] },
  sourceItem,
  selectedAiRun,
  sourceError,
  sourceItemsError,
  aiError,
  onFiltersChange,
}: {
  filters: RawInspectorViewFilters;
  aiRuns: RawInspectorAiRunPage;
  sourceItems?: SourceItemPage;
  sourceItem?: RawInspectorSourceItemDetail;
  selectedAiRun?: RawInspectorAiRunDetail;
  sourceError?: string;
  sourceItemsError?: string;
  aiError?: string;
  onFiltersChange?: (filters: RawInspectorViewFilters) => void;
}) {
  const [sourceInput, setSourceInput] = useState(filters.sourceItem ?? "");

  useEffect(() => {
    setSourceInput(filters.sourceItem ?? "");
  }, [filters.sourceItem]);

  function update(next: Partial<RawInspectorViewFilters>) {
    onFiltersChange?.({ ...filters, cursor: undefined, ...next });
  }

  function submitSourceItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ sourceItem: sourceInput.trim() || undefined });
  }

  return (
    <main className="raw-inspector-page">
      <header className="raw-inspector-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Rådata-inspektør</h1>
          <p>Les-only visning av kildepayloads og AI-kjøringer.</p>
        </div>
        <div className="coverage-bundles-actions">
          <Link to="/command">Kommandosenter</Link>
          <Link to="/command/kilder">Kilderevisjon</Link>
          <Link to="/command/dekning">Dekningsgrupper</Link>
        </div>
      </header>
      <section className="raw-inspector-grid">
        <aside className="raw-inspector-sidebar" aria-label="Rådatafiltre">
          <form onSubmit={submitSourceItem}>
            <label>
              Kildeelement-ID
              <input
                value={sourceInput}
                onChange={(event) => setSourceInput(event.target.value)}
                placeholder="source:..."
              />
            </label>
            <button type="submit">Hent kildeelement</button>
          </form>
          <label>
            Kildesøk
            <input
              value={filters.sourceQ ?? ""}
              onChange={(event) =>
                update({ sourceQ: event.target.value || undefined, sourceCursor: undefined })
              }
              placeholder="Søk i tittel, sammendrag, hash"
            />
          </label>
          <label>
            Kildetype
            <select
              value={filters.sourceKind ?? ""}
              onChange={(event) =>
                update({
                  sourceKind: (event.target.value ||
                    undefined) as RawInspectorViewFilters["sourceKind"],
                  sourceCursor: undefined,
                })
              }
            >
              <option value="">Alle</option>
              {Object.entries(sourceKindLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {sourceItems.nextCursor ? (
            <button type="button" onClick={() => update({ sourceCursor: sourceItems.nextCursor })}>
              Neste kildeside
            </button>
          ) : null}
          <label>
            AI-søk
            <input
              value={filters.q ?? ""}
              onChange={(event) => update({ q: event.target.value || undefined })}
              placeholder="Søk i kjøring, modell, feil"
            />
          </label>
          <label>
            Provider
            <select
              value={filters.provider ?? ""}
              onChange={(event) =>
                update({
                  provider: (event.target.value ||
                    undefined) as RawInspectorAiRunFilters["provider"],
                })
              }
            >
              <option value="">Alle</option>
              <option value="deepseek">DeepSeek</option>
              <option value="deterministic">Deterministisk</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={filters.status ?? ""}
              onChange={(event) =>
                update({
                  status: (event.target.value || undefined) as RawInspectorAiRunFilters["status"],
                })
              }
            >
              <option value="">Alle</option>
              <option value="ok">OK</option>
              <option value="degraded">Degradert</option>
              <option value="disabled">Avslått</option>
            </select>
          </label>
          {aiRuns.nextCursor ? (
            <button type="button" onClick={() => update({ cursor: aiRuns.nextCursor })}>
              Neste side
            </button>
          ) : null}
        </aside>
        <section className="raw-inspector-list" aria-label="Kildeelementer og AI-kjøringer">
          <div className="raw-inspector-section-heading">
            <h2>Kildeelementer</h2>
            <span>{sourceItems.items.length} vist</span>
          </div>
          {sourceItemsError ? <p className="raw-inspector-error">{sourceItemsError}</p> : null}
          {sourceItems.items.length === 0 ? (
            <p className="raw-inspector-empty">Ingen kildeelementer matcher filtrene.</p>
          ) : (
            sourceItems.items.map((item) => (
              <button
                className={
                  item.id === filters.sourceItem
                    ? "raw-inspector-run selected"
                    : "raw-inspector-run"
                }
                key={item.id}
                type="button"
                onClick={() => update({ sourceItem: item.id })}
              >
                <span>
                  {item.provider} · {sourceKindLabels[item.kind]}
                </span>
                <strong>{item.title ?? item.id}</strong>
                <small>
                  {item.summary ?? item.id} · hentet {time(item.fetchedAt)}
                </small>
              </button>
            ))
          )}
          <div className="raw-inspector-section-heading">
            <h2>AI-kjøringer</h2>
            <span>{aiRuns.items.length} vist</span>
          </div>
          {aiError ? <p className="raw-inspector-error">{aiError}</p> : null}
          {aiRuns.items.length === 0 ? (
            <p className="raw-inspector-empty">Ingen AI-kjøringer matcher filtrene.</p>
          ) : (
            aiRuns.items.map((run) => (
              <button
                className={
                  run.id === filters.run ? "raw-inspector-run selected" : "raw-inspector-run"
                }
                key={run.id}
                type="button"
                onClick={() => update({ run: run.id })}
              >
                <span>{providerLabels[run.provider] ?? run.provider}</span>
                <strong>{run.model}</strong>
                <small>
                  {statusLabels[run.status] ?? run.status} · {run.articleCount} saker ·{" "}
                  {aiProfileLabel(run.diagnostics)} · {time(run.completedAt)}
                </small>
                {run.error ? <em>{run.error}</em> : null}
              </button>
            ))
          )}
        </section>
        <aside className="raw-inspector-detail" aria-label="Rådatadetalj">
          <section>
            <p className="label">Kildeelement</p>
            {sourceError ? <p className="raw-inspector-error">{sourceError}</p> : null}
            {sourceItem ? (
              <>
                <h2>{sourceItem.item.title ?? sourceItem.item.id}</h2>
                <dl>
                  <div>
                    <dt>Provider</dt>
                    <dd>{sourceItem.item.provider}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{sourceItem.item.kind}</dd>
                  </div>
                  <div>
                    <dt>Payload</dt>
                    <dd>
                      {Math.round(sourceItem.payloadBytes.raw / 1024)} kB rå ·{" "}
                      {Math.round(sourceItem.payloadBytes.normalized / 1024)} kB normalisert
                    </dd>
                  </div>
                </dl>
                {sourceItem.redacted || sourceItem.truncated ? (
                  <p className="raw-inspector-warning">
                    Payload er {sourceItem.redacted ? "redigert" : "ikke redigert"}
                    {sourceItem.truncated ? " og forkortet" : ""}.
                  </p>
                ) : null}
                <PayloadPanel title="Normalisert payload" value={sourceItem.normalizedPayload} />
                <PayloadPanel title="Rå payload" value={sourceItem.rawPayload} />
              </>
            ) : (
              <p className="raw-inspector-empty">Velg et kildeelement for råpayload.</p>
            )}
          </section>
          <section>
            <p className="label">AI-detalj</p>
            {selectedAiRun ? (
              <>
                <h2>{selectedAiRun.model}</h2>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{statusLabels[selectedAiRun.status] ?? selectedAiRun.status}</dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{providerLabels[selectedAiRun.provider] ?? selectedAiRun.provider}</dd>
                  </div>
                  <div>
                    <dt>Artikler</dt>
                    <dd>{selectedAiRun.articleIds.join(", ") || "Ingen"}</dd>
                  </div>
                  <div>
                    <dt>Profil</dt>
                    <dd>{aiProfileLabel(selectedAiRun.diagnostics)}</dd>
                  </div>
                  {selectedAiRun.diagnostics ? (
                    <div>
                      <dt>Forsøk</dt>
                      <dd>
                        {selectedAiRun.diagnostics.attempts
                          .map(
                            (attempt) =>
                              `${aiProfileLabels[attempt.profile]} ${
                                attempt.status === "ok" ? "OK" : "feilet"
                              } (${attempt.articleCount}/${attempt.situationCount})`,
                          )
                          .join(", ")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {selectedAiRun.error ? (
                  <p className="raw-inspector-error">{selectedAiRun.error}</p>
                ) : null}
                <PayloadPanel
                  title="AI-resultat"
                  value={selectedAiRun.result}
                  note={`${Math.round(selectedAiRun.resultBytes / 1024)} kB etter sanitering`}
                />
              </>
            ) : (
              <p className="raw-inspector-empty">Velg en AI-kjøring for resultatpayload.</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

export function RawDataInspectorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseRawInspectorFilters(searchParams.toString()), [searchParams]);
  const [aiRuns, setAiRuns] = useState<RawInspectorAiRunPage>({ items: [] });
  const [sourceItems, setSourceItems] = useState<SourceItemPage>({ items: [] });
  const [sourceItem, setSourceItem] = useState<RawInspectorSourceItemDetail>();
  const [selectedAiRun, setSelectedAiRun] = useState<RawInspectorAiRunDetail>();
  const [sourceError, setSourceError] = useState<string>();
  const [sourceItemsError, setSourceItemsError] = useState<string>();
  const [aiError, setAiError] = useState<string>();

  useEffect(() => {
    setSourceItemsError(undefined);
    void api
      .sourceItems(sourceItemQuery(filters))
      .then(setSourceItems)
      .catch((reason: Error) => setSourceItemsError(reason.message));
  }, [filters.sourceKind, filters.sourceQ, filters.sourceCursor]);

  useEffect(() => {
    setAiError(undefined);
    void api
      .rawAiRuns(aiRunQuery(filters))
      .then(setAiRuns)
      .catch((reason: Error) => setAiError(reason.message));
  }, [filters.provider, filters.status, filters.q, filters.cursor, filters.limit]);

  useEffect(() => {
    setSourceError(undefined);
    setSourceItem(undefined);
    if (!filters.sourceItem) return;
    void api
      .rawSourceItem(filters.sourceItem)
      .then(setSourceItem)
      .catch((reason: Error) => setSourceError(reason.message));
  }, [filters.sourceItem]);

  useEffect(() => {
    setSelectedAiRun(undefined);
    if (!filters.run) return;
    void api
      .rawAiRun(filters.run)
      .then(setSelectedAiRun)
      .catch((reason: Error) => setAiError(reason.message));
  }, [filters.run]);

  function setFilters(next: RawInspectorViewFilters) {
    setSearchParams(buildRawInspectorSearch(next));
  }

  return (
    <RawDataInspectorDashboard
      aiError={aiError}
      aiRuns={aiRuns}
      filters={filters}
      selectedAiRun={selectedAiRun}
      sourceError={sourceError}
      sourceItem={sourceItem}
      sourceItems={sourceItems}
      sourceItemsError={sourceItemsError}
      onFiltersChange={setFilters}
    />
  );
}
