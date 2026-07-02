import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  RawInspectorAiRunDetail,
  RawInspectorAiRunFilters,
  RawInspectorAiRunPage,
  RawInspectorSourceItemDetail,
} from "@nytt/shared";
import { api } from "../api.js";

interface RawInspectorViewFilters extends RawInspectorAiRunFilters {
  sourceItem?: string;
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

function parseRawInspectorFilters(search: string): RawInspectorViewFilters {
  const parameters = new URLSearchParams(search);
  const provider = parameters.get("provider");
  const status = parameters.get("status");
  const q = parameters.get("q")?.trim() || undefined;
  const cursor = parameters.get("cursor") || undefined;
  const sourceItem = parameters.get("sourceItem")?.trim() || undefined;
  const run = parameters.get("run")?.trim() || undefined;
  return {
    limit: 20,
    ...(provider === "deepseek" || provider === "deterministic" ? { provider } : {}),
    ...(status === "ok" || status === "degraded" || status === "disabled" ? { status } : {}),
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
    ...(sourceItem ? { sourceItem } : {}),
    ...(run ? { run } : {}),
  };
}

function buildRawInspectorSearch(filters: RawInspectorViewFilters) {
  const parameters = new URLSearchParams();
  if (filters.provider) parameters.set("provider", filters.provider);
  if (filters.status) parameters.set("status", filters.status);
  if (filters.q) parameters.set("q", filters.q);
  if (filters.cursor) parameters.set("cursor", filters.cursor);
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
  sourceItem,
  selectedAiRun,
  sourceError,
  aiError,
  onFiltersChange,
}: {
  filters: RawInspectorViewFilters;
  aiRuns: RawInspectorAiRunPage;
  sourceItem?: RawInspectorSourceItemDetail;
  selectedAiRun?: RawInspectorAiRunDetail;
  sourceError?: string;
  aiError?: string;
  onFiltersChange?: (filters: RawInspectorViewFilters) => void;
}) {
  const [sourceInput, setSourceInput] = useState(filters.sourceItem ?? "");

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
        <section className="raw-inspector-list" aria-label="AI-kjøringer">
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
                  {time(run.completedAt)}
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
  const [sourceItem, setSourceItem] = useState<RawInspectorSourceItemDetail>();
  const [selectedAiRun, setSelectedAiRun] = useState<RawInspectorAiRunDetail>();
  const [sourceError, setSourceError] = useState<string>();
  const [aiError, setAiError] = useState<string>();

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
      onFiltersChange={setFilters}
    />
  );
}
