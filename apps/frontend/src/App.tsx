import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { BootstrapPayload } from "@nytt/shared";
import { ApiError, api } from "./api.js";
import { headerFreshnessLabel } from "./freshness.js";
import { buildHomeSearch, parseHomeFilters } from "./homeFilters.js";
import { HomePage } from "./pages/HomePage.js";
import { CoverageBundlesPage } from "./pages/CoverageBundlesPage.js";
import { OperationsPage } from "./pages/OperationsPage.js";
import { OperationsTimelinePage } from "./pages/OperationsTimelinePage.js";
import { SavedPage } from "./pages/SavedPage.js";
import { SourceAuditPage } from "./pages/SourceAuditPage.js";
import { SituationPage } from "./pages/SituationPage.js";
import { SituationsPage } from "./pages/SituationsPage.js";
import { TrafficMapPage } from "./pages/TrafficMapPage.js";
import { WeatherPage } from "./pages/WeatherPage.js";

function Header({ freshnessLabel }: { freshnessLabel: string }) {
  const [logoutError, setLogoutError] = useState<string>();
  const navigate = useNavigate();
  const location = useLocation();
  const filters = useMemo(
    () => parseHomeFilters(location.pathname === "/" ? location.search : ""),
    [location.pathname, location.search],
  );

  function searchChanged(event: ChangeEvent<HTMLInputElement>) {
    const q = event.target.value;
    const nextSearch = buildHomeSearch({
      ...filters,
      q,
      scope: location.pathname === "/" ? filters.scope : "trondheim",
      category: location.pathname === "/" ? filters.category : "Alle",
    });
    navigate({ pathname: "/", search: nextSearch });
  }

  async function logout() {
    setLogoutError(undefined);
    try {
      await api.logout();
      window.location.href = "/auth/github";
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : "Utlogging feilet");
    }
  }

  return (
    <header className="site-header">
      <div className="masthead">
        <Link className="brand" to="/">
          Nytt Trondheim
        </Link>
        <nav aria-label="Hovedmeny">
          <NavLink to="/">Siste nytt</NavLink>
          <NavLink to="/situasjoner">Situasjonsrom</NavLink>
          <NavLink to="/trafikk">Trafikkart</NavLink>
          <NavLink to="/vaer">Vær</NavLink>
          <NavLink to="/lagret">Lagret</NavLink>
          <NavLink to="/drift">Drift</NavLink>
        </nav>
        <label className="search">
          <span className="sr-only">Søk i saker</span>
          <input placeholder="Søk i saker" value={filters.q} onChange={searchChanged} />
          <span aria-hidden="true">⌕</span>
        </label>
        <div className="refreshed">{freshnessLabel}</div>
        <button className="logout" onClick={() => void logout()}>
          Logg ut
        </button>
      </div>
      {logoutError ? <p className="header-error">{logoutError}</p> : null}
    </header>
  );
}

export function App() {
  const [data, setData] = useState<BootstrapPayload>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    api
      .bootstrap()
      .then((payload) => {
        if (!ignore) setData(payload);
      })
      .catch((reason: Error) => {
        if (!ignore) {
          setData(undefined);
          setError(
            reason instanceof ApiError && reason.status === 429
              ? "For mange forespørsler. Prøv igjen om litt."
              : reason.message,
          );
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [attempt]);

  const freshnessLabel = headerFreshnessLabel(data?.sourceHealth ?? []);

  return (
    <>
      <Header freshnessLabel={freshnessLabel} />
      {loading ? <main className="loading">Henter siste nytt...</main> : null}
      {!loading && error ? (
        <main className="fatal-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Prøv igjen
          </button>
        </main>
      ) : null}
      {!loading && data ? (
        <Routes>
          <Route path="/" element={<HomePage initialData={data} />} />
          <Route path="/situasjoner" element={<SituationsPage />} />
          <Route path="/situasjoner/:id" element={<SituationPage />} />
          <Route path="/trafikk" element={<TrafficMapPage />} />
          <Route path="/vaer" element={<WeatherPage />} />
          <Route path="/lagret" element={<SavedPage />} />
          <Route path="/drift" element={<OperationsPage />} />
          <Route path="/drift/dekning" element={<CoverageBundlesPage />} />
          <Route path="/drift/kilder" element={<SourceAuditPage />} />
          <Route path="/drift/tidslinje" element={<OperationsTimelinePage />} />
        </Routes>
      ) : null}
    </>
  );
}
