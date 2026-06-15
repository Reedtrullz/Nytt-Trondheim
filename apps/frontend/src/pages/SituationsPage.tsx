import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { MapFirstSituation, Provenance, SourceConfidenceLevel } from "@nytt/shared";
import { api } from "../api.js";
import { MapAccessibility } from "../components/map/MapAccessibility.js";
import { SituationWorkspaceLayer } from "../components/map/SituationWorkspaceLayer.js";
import { boundsFromLatLngs, latLngsFromGeometry, type LeafletBounds } from "../mapCoordinates.js";
import { resolveSelectedSituation } from "../situationMapSelection.js";
import { formatSituationTimestamp } from "../situationTime.js";
import {
  buildSituationWorkspaceSearch,
  parseSituationWorkspaceFilters,
  toggleFilterValue,
  workspaceConfidenceOptions,
  workspaceProvenanceOptions,
  workspaceQueryFromFilters,
  workspaceSourceOptions,
  workspaceStatusOptions,
  type SituationWorkspaceFilters,
} from "../situationWorkspaceFilters.js";

const trondheimCenter: [number, number] = [63.4305, 10.3951];
const tiles = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";

function boundsFromSituation(situation?: MapFirstSituation): LeafletBounds | undefined {
  if (!situation) return undefined;
  const primaryFeatureBounds = situation.primaryFeature
    ? boundsFromLatLngs(latLngsFromGeometry(situation.primaryFeature.geometry))
    : undefined;
  if (primaryFeatureBounds) return primaryFeatureBounds;
  return boundsFromLatLngs(
    situation.features.flatMap((feature) => latLngsFromGeometry(feature.geometry)),
  );
}

function SituationMapFocus({ situation }: { situation?: MapFirstSituation }) {
  const map = useMap();
  const bounds = boundsFromSituation(situation);

  useEffect(() => {
    if (!bounds) return;
    if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
      map.flyTo(bounds[0], Math.max(map.getZoom(), 12), { duration: 0.45 });
      return;
    }
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
  }, [bounds?.[0][0], bounds?.[0][1], bounds?.[1][0], bounds?.[1][1], map]);

  return null;
}

function statusLabel(status: MapFirstSituation["status"]) {
  switch (status) {
    case "active":
      return "Pågår";
    case "resolved":
      return "Avsluttet";
    case "dismissed":
      return "Avvist";
    default:
      return "Foreløpig";
  }
}

function confidenceTone(level: SourceConfidenceLevel) {
  if (level === "confirmed") return "confirmed";
  if (level === "likely") return "likely";
  if (level === "speculative") return "speculative";
  return "uncertain";
}

function provenanceTone(provenance: Provenance) {
  return provenance.replace("_", "-");
}

function focusSituationButton(index: number) {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-situation-row]");
  buttons[index]?.focus();
}

function handleSituationKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  total: number,
) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusSituationButton(Math.min(total - 1, index + 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusSituationButton(Math.max(0, index - 1));
  } else if (event.key === "Home") {
    event.preventDefault();
    focusSituationButton(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusSituationButton(total - 1);
  }
}

function applySearch(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  filters: SituationWorkspaceFilters,
  replace = true,
) {
  const search = buildSituationWorkspaceSearch(filters);
  setSearchParams(search.startsWith("?") ? search.slice(1) : search, { replace });
}

function FilterCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function SituationFilterPanel({
  filters,
  onChange,
}: {
  filters: SituationWorkspaceFilters;
  onChange: (filters: SituationWorkspaceFilters) => void;
}) {
  function patch(next: Partial<SituationWorkspaceFilters>) {
    onChange({ ...filters, ...next, selectedSituationId: undefined });
  }

  function searchChanged(event: ChangeEvent<HTMLInputElement>) {
    patch({ q: event.target.value });
  }

  return (
    <aside className="situation-workspace-filter">
      <header>
        <p className="label">Situasjonsrom</p>
        <h2>Kilder og visning</h2>
      </header>
      <label className="workspace-search">
        <span className="sr-only">Søk i situasjoner</span>
        <input placeholder="Søk i situasjoner" value={filters.q} onChange={searchChanged} />
      </label>
      <section>
        <h3>Status</h3>
        {workspaceStatusOptions.map((option) => (
          <FilterCheckbox
            key={option.value}
            checked={filters.statuses.includes(option.value)}
            label={option.label}
            onChange={() => patch({ statuses: toggleFilterValue(filters.statuses, option.value) })}
          />
        ))}
      </section>
      <section>
        <h3>Kilder</h3>
        {workspaceSourceOptions.map((option) => (
          <FilterCheckbox
            key={option.value}
            checked={filters.sources.includes(option.value)}
            label={option.label}
            onChange={() => patch({ sources: toggleFilterValue(filters.sources, option.value) })}
          />
        ))}
      </section>
      <section>
        <h3>Proveniens</h3>
        {workspaceProvenanceOptions.map((option) => (
          <FilterCheckbox
            key={option.value}
            checked={filters.provenances.includes(option.value)}
            label={option.label}
            onChange={() =>
              patch({ provenances: toggleFilterValue(filters.provenances, option.value) })
            }
          />
        ))}
      </section>
      <details>
        <summary>Konfidens</summary>
        {workspaceConfidenceOptions.map((option) => (
          <FilterCheckbox
            key={option.value}
            checked={filters.confidenceLevels.includes(option.value)}
            label={option.label}
            onChange={() =>
              patch({
                confidenceLevels: toggleFilterValue(filters.confidenceLevels, option.value),
              })
            }
          />
        ))}
      </details>
      <label className="workspace-private-toggle">
        <input
          type="checkbox"
          checked={filters.includePrivateAnnotations}
          onChange={(event) => patch({ includePrivateAnnotations: event.target.checked })}
        />
        Vis private markeringer
      </label>
      <button
        type="button"
        onClick={() =>
          onChange({
            q: "",
            statuses: ["preliminary", "active"],
            sources: [],
            provenances: [],
            confidenceLevels: [],
            includePrivateAnnotations: true,
          })
        }
      >
        Nullstill filtre
      </button>
    </aside>
  );
}

function SituationList({
  situations,
  selectedId,
  onSelect,
}: {
  situations: MapFirstSituation[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="situation-workspace-list" aria-label="Situasjoner i kartet">
      <header>
        <h2>Situasjoner</h2>
        <span>{situations.length}</span>
      </header>
      {situations.length === 0 ? <p>Ingen situasjoner matcher filtrene.</p> : null}
      <ol>
        {situations.map((situation, index) => (
          <li key={situation.id}>
            <button
              type="button"
              className={situation.id === selectedId ? "selected" : undefined}
              aria-pressed={situation.id === selectedId}
              data-situation-row
              onClick={() => onSelect(situation.id)}
              onKeyDown={(event) => handleSituationKeyDown(event, index, situations.length)}
            >
              <span className={`case-status ${situation.status}`}>
                {statusLabel(situation.status)}
              </span>
              <strong>{situation.title}</strong>
              <small>
                {situation.locationLabel} · {situation.sourceConfidence.label}
              </small>
              <span className="situation-row-badges">
                {situation.provenanceSummary.slice(0, 3).map((summary) => (
                  <span
                    key={summary.provenance}
                    className={`trust-badge provenance-${provenanceTone(summary.provenance)}`}
                  >
                    {summary.label}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TimelinePanel({
  timeline,
  loading,
  error,
  onRetry,
}: {
  timeline: NonNullable<Awaited<ReturnType<typeof api.situationMapWorkspace>>>["timeline"];
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <section className="situation-timeline-panel">
      <header>
        <div>
          <p className="label">Tidslinje</p>
          <h2>Kildefiltrert utvikling</h2>
        </div>
        <span>{timeline.length}</span>
      </header>
      {error ? (
        <div className="workspace-state error" role="alert">
          <p>Kunne ikke hente tidslinje: {error}</p>
          <button type="button" onClick={onRetry}>
            Prøv igjen
          </button>
        </div>
      ) : loading ? (
        <p className="workspace-state">Henter tidslinje ...</p>
      ) : timeline.length === 0 ? (
        <p className="workspace-state">Ingen tidslinjepunkter matcher filtrene.</p>
      ) : (
        <ol>
          {timeline.map((entry) => (
            <li key={entry.id}>
              <time>{formatSituationTimestamp(entry.timestamp)}</time>
              <strong>{entry.title}</strong>
              <p>{entry.detail}</p>
              <span>{entry.sourceLabel}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SituationDetailDrawer({
  situation,
  selectionMissing,
  selectedFromUrl,
  onClose,
}: {
  situation?: MapFirstSituation;
  selectionMissing: boolean;
  selectedFromUrl: boolean;
  onClose: () => void;
}) {
  if (!situation) {
    return (
      <aside className="situation-detail-drawer empty" aria-label="Situasjonsdetaljer">
        <p>
          {selectionMissing
            ? "Valgt situasjon finnes ikke i dette filteret."
            : "Velg en situasjon i kartet eller listen for detaljer."}
        </p>
        {selectionMissing ? (
          <button type="button" onClick={onClose}>
            Tøm valgt situasjon
          </button>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="situation-detail-drawer" aria-label="Situasjonsdetaljer">
      <header>
        <div>
          <p className="label">Detaljer</p>
          <h2>{situation.title}</h2>
        </div>
        {selectedFromUrl ? (
          <button type="button" onClick={onClose} aria-label="Lukk situasjonsdetaljer">
            Lukk
          </button>
        ) : null}
      </header>
      <div className="situation-detail-badges">
        <span className={`status ${situation.status}`}>{statusLabel(situation.status)}</span>
        <span
          className={`trust-badge confidence-${confidenceTone(situation.sourceConfidence.level)}`}
        >
          {situation.sourceConfidence.label}
        </span>
        {situation.hasPrivateAnnotations ? (
          <span className="trust-badge">Privat markering</span>
        ) : null}
      </div>
      <p>{situation.summary}</p>
      <dl>
        <div>
          <dt>Sted</dt>
          <dd>{situation.locationLabel}</dd>
        </div>
        <div>
          <dt>Oppdatert</dt>
          <dd>{formatSituationTimestamp(situation.updatedAt)}</dd>
        </div>
        <div>
          <dt>Kildestyrke</dt>
          <dd>{situation.sourceConfidence.rationale}</dd>
        </div>
      </dl>
      <section>
        <h3>Proveniens</h3>
        <ul className="situation-provenance-list">
          {situation.provenanceSummary.map((summary) => (
            <li key={summary.provenance}>
              <strong>{summary.label}</strong>
              <span>
                {summary.confidence.label} · {summary.sourceIds.length} kilder
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Siste utvikling</h3>
        {situation.timelinePreview.length ? (
          <ol className="situation-preview-timeline">
            {situation.timelinePreview.map((entry) => (
              <li key={entry.id}>
                <time>{formatSituationTimestamp(entry.timestamp)}</time>
                <strong>{entry.title}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p>Ingen tidslinjepunkter i dette filteret.</p>
        )}
      </section>
      <Link className="primary-link" to={`/situasjoner/${situation.id}`}>
        Åpne arbeidsrom
      </Link>
      <Link
        className="secondary-link"
        to={`/drift/tidslinje?s=${encodeURIComponent(situation.id)}`}
      >
        Se i operasjonstidslinje
      </Link>
    </aside>
  );
}

export function SituationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const filters = useMemo(() => parseSituationWorkspaceFilters(searchText), [searchText]);
  const query = useMemo(() => workspaceQueryFromFilters(filters), [filters]);
  const [workspace, setWorkspace] =
    useState<Awaited<ReturnType<typeof api.situationMapWorkspace>>>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    setWorkspace(undefined);
    void api
      .situationMapWorkspace(query)
      .then((payload) => {
        if (!ignore) setWorkspace(payload);
      })
      .catch((reason: Error) => {
        if (!ignore) {
          setWorkspace(undefined);
          setError(reason.message);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [query, attempt]);

  const situations = workspace?.situations ?? [];
  const selectedSituationResult = resolveSelectedSituation(situations, filters.selectedSituationId);
  const selectedSituation = selectedSituationResult.selectedSituation;
  const selectionMissing = selectedSituationResult.selectionMissing && !loading && !error;
  const highPriorityCount = situations.filter(
    (situation) => situation.importance === "high",
  ).length;

  function updateFilters(next: SituationWorkspaceFilters) {
    applySearch(setSearchParams, next);
  }

  function selectSituation(id: string) {
    applySearch(setSearchParams, { ...filters, selectedSituationId: id }, false);
  }

  function clearSelectedSituation() {
    applySearch(setSearchParams, { ...filters, selectedSituationId: undefined }, false);
  }

  return (
    <main className="situation-workspace-page">
      <section className="situation-workspace-hero">
        <div>
          <p className="label">Situasjonsrom</p>
          <h1>Trondheim situasjonskart</h1>
          <p>Privat arbeidsflate for hendelser, kildegrunnlag, tidslinje og egne markeringer.</p>
        </div>
        <div className="situation-workspace-metrics" aria-label="Situasjonsstatus">
          <article>
            <strong>{loading ? "–" : situations.length}</strong>
            <span>Matcher filter</span>
          </article>
          <article>
            <strong>{loading ? "–" : highPriorityCount}</strong>
            <span>Høy viktighet</span>
          </article>
          <article>
            <strong>{loading ? "–" : (workspace?.privateAnnotations.length ?? 0)}</strong>
            <span>Private markeringer</span>
          </article>
          <article>
            <strong>{loading ? "–" : (workspace?.timeline.length ?? 0)}</strong>
            <span>Tidslinjepunkt</span>
          </article>
        </div>
      </section>

      <section className="situation-workspace-grid" aria-label="Situasjonskart og filtre">
        <div className="situation-workspace-sidebar">
          <SituationFilterPanel filters={filters} onChange={updateFilters} />
          <SituationList
            situations={situations}
            selectedId={selectedSituation?.id}
            onSelect={selectSituation}
          />
        </div>
        <div className="situation-overview-map-frame">
          <MapContainer
            center={trondheimCenter}
            zoom={11}
            className="situation-overview-map"
            scrollWheelZoom
          >
            <TileLayer attribution="© Kartverket" url={tiles} />
            <MapAccessibility label="Situasjonskart for Trondheim" />
            <SituationMapFocus situation={selectedSituation} />
            <SituationWorkspaceLayer
              situations={situations}
              selectedSituationId={selectedSituation?.id}
              onSelectSituation={selectSituation}
            />
          </MapContainer>
          {loading ? <p className="map-state">Henter situasjonskart ...</p> : null}
          {error ? (
            <div className="map-state error" role="alert">
              <p>Kunne ikke hente situasjonskart: {error}</p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                Prøv igjen
              </button>
            </div>
          ) : null}
          {!loading && !error && situations.length === 0 ? (
            <p className="map-state">
              Ingen markeringer i valgt filter. Utvid kilder eller status.
            </p>
          ) : null}
          {selectionMissing ? (
            <div className="map-state" role="status">
              <p>Valgt situasjon er ikke i gjeldende kartfilter.</p>
              <button type="button" onClick={clearSelectedSituation}>
                Tøm valgt situasjon
              </button>
            </div>
          ) : null}
        </div>
        <SituationDetailDrawer
          situation={selectedSituation}
          selectionMissing={selectionMissing}
          selectedFromUrl={Boolean(filters.selectedSituationId)}
          onClose={clearSelectedSituation}
        />
      </section>

      <section className="situation-workspace-bottom" aria-label="Tidslinje og detaljpanel">
        <TimelinePanel
          timeline={workspace?.timeline ?? []}
          loading={loading}
          error={error}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </section>
    </main>
  );
}
