import {
  lazy,
  Suspense,
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { BootstrapPayload, SessionPayload } from "@nytt/shared";
import { ApiError, api } from "./api.js";
import { headerFreshnessLabel } from "./freshness.js";
import { buildHomeSearch, parseHomeFilters } from "./homeFilters.js";
import { AccessPage } from "./pages/AccessPage.js";
import { HomePage } from "./pages/HomePage.js";

const AccessRequestsPage = lazy(() =>
  import("./pages/AccessRequestsPage.js").then((module) => ({
    default: module.AccessRequestsPage,
  })),
);
const CoverageBundlesPage = lazy(() =>
  import("./pages/CoverageBundlesPage.js").then((module) => ({
    default: module.CoverageBundlesPage,
  })),
);
const CommandBriefingPage = lazy(() =>
  import("./pages/CommandBriefingPage.js").then((module) => ({
    default: module.CommandBriefingPage,
  })),
);
const OperationsPage = lazy(() =>
  import("./pages/OperationsPage.js").then((module) => ({ default: module.OperationsPage })),
);
const OperationsTimelinePage = lazy(() =>
  import("./pages/OperationsTimelinePage.js").then((module) => ({
    default: module.OperationsTimelinePage,
  })),
);
const NotificationTriggerCandidatesPage = lazy(() =>
  import("./pages/NotificationTriggerCandidatesPage.js").then((module) => ({
    default: module.NotificationTriggerCandidatesPage,
  })),
);
const NotificationSettingsPage = lazy(() =>
  import("./pages/NotificationSettingsPage.js").then((module) => ({
    default: module.NotificationSettingsPage,
  })),
);
const RawDataInspectorPage = lazy(() =>
  import("./pages/RawDataInspectorPage.js").then((module) => ({
    default: module.RawDataInspectorPage,
  })),
);
const SavedPage = lazy(() =>
  import("./pages/SavedPage.js").then((module) => ({ default: module.SavedPage })),
);
const SourceAuditPage = lazy(() =>
  import("./pages/SourceAuditPage.js").then((module) => ({ default: module.SourceAuditPage })),
);
const SpatialAnalyticsPage = lazy(() =>
  import("./pages/SpatialAnalyticsPage.js").then((module) => ({
    default: module.SpatialAnalyticsPage,
  })),
);
const SportPage = lazy(() =>
  import("./pages/SportPage.js").then((module) => ({ default: module.SportPage })),
);
const SituationPage = lazy(() =>
  import("./pages/SituationPage.js").then((module) => ({ default: module.SituationPage })),
);
const SituationsPage = lazy(() =>
  import("./pages/SituationsPage.js").then((module) => ({ default: module.SituationsPage })),
);
const TrafficMapPage = lazy(() =>
  import("./pages/TrafficMapPage.js").then((module) => ({ default: module.TrafficMapPage })),
);
const WeatherPage = lazy(() =>
  import("./pages/WeatherPage.js").then((module) => ({ default: module.WeatherPage })),
);

function Header({
  freshnessLabel,
  user,
}: {
  freshnessLabel: string;
  user: SessionPayload["user"];
}) {
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
      window.location.href = "/logg-inn";
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : "Utlogging feilet");
    }
  }

  const isOwner = user.role === "owner";

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
          <NavLink to="/sport">Sport</NavLink>
          <NavLink to="/varsler">Varsler</NavLink>
          {isOwner ? <NavLink to="/lagret">Lagret</NavLink> : null}
          {isOwner ? <NavLink to="/command">Kommandosenter</NavLink> : null}
        </nav>
        <label className="search">
          <span className="sr-only">Søk i saker</span>
          <input placeholder="Søk i saker" value={filters.q} onChange={searchChanged} />
          <span aria-hidden="true">⌕</span>
        </label>
        <div className="refreshed">{freshnessLabel}</div>
        <div className="session-role">
          {user.role === "owner" ? "Eier" : "Lesetilgang"} · {user.displayName}
        </div>
        <button className="logout" onClick={() => void logout()}>
          Logg ut
        </button>
      </div>
      {logoutError ? <p className="header-error">{logoutError}</p> : null}
    </header>
  );
}

function ForbiddenPage() {
  return (
    <main className="status-page">
      <p className="label">403</p>
      <h1>Dette krever eiertilgang</h1>
      <p>Du har lesetilgang til forsiden, nyheter, trafikk, vær og offentlige situasjonsrom.</p>
      <Link className="primary-link" to="/">
        Til forsiden
      </Link>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="status-page">
      <p className="label">404</p>
      <h1>Fant ikke siden</h1>
      <p>Siden finnes ikke i denne versjonen av Nytt Trondheim.</p>
      <Link className="primary-link" to="/">
        Til forsiden
      </Link>
    </main>
  );
}

function OwnerOnly({ isOwner, children }: { isOwner: boolean; children: ReactNode }) {
  if (!isOwner) return <ForbiddenPage />;
  return <>{children}</>;
}

function LoadingPage({ message }: { message: string }) {
  return (
    <main className="loading">
      <h1>Nytt Trondheim</h1>
      <p>{message}</p>
    </main>
  );
}

export type AuthenticatedShellApi = Pick<typeof api, "bootstrap" | "session">;

export async function loadAuthenticatedShellData(client: AuthenticatedShellApi = api) {
  const [sessionPayload, bootstrapPayload] = await Promise.all([
    client.session(),
    client.bootstrap(),
  ]);
  return { sessionPayload, bootstrapPayload };
}

function LegacyCommandRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function AuthenticatedApp() {
  const [data, setData] = useState<BootstrapPayload>();
  const [session, setSession] = useState<SessionPayload>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    const sessionRequest = api.session().then((sessionPayload) => {
      if (!ignore) {
        setSession(sessionPayload);
      }
      return sessionPayload;
    });
    const bootstrapRequest = api.bootstrap().then((bootstrapPayload) => {
      if (!ignore) {
        setData(bootstrapPayload);
      }
      return bootstrapPayload;
    });
    Promise.all([sessionRequest, bootstrapRequest])
      .then(([sessionPayload, bootstrapPayload]) => {
        if (!ignore) {
          setSession(sessionPayload);
          setData(bootstrapPayload);
        }
      })
      .catch((reason: Error) => {
        if (!ignore) {
          setData(undefined);
          setSession(undefined);
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
  const isOwner = session?.user.role === "owner";
  const ownerOnly = (children: ReactNode) => <OwnerOnly isOwner={isOwner}>{children}</OwnerOnly>;

  return (
    <>
      {session ? <Header freshnessLabel={freshnessLabel} user={session.user} /> : null}
      {loading ? <LoadingPage message="Henter siste nytt..." /> : null}
      {!loading && error ? (
        <main className="fatal-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Prøv igjen
          </button>
        </main>
      ) : null}
      {!loading && data && session ? (
        <Suspense fallback={<LoadingPage message="Henter siden..." />}>
          <Routes>
            <Route path="/" element={<HomePage initialData={data} canSave={isOwner} />} />
            <Route path="/situasjoner" element={<SituationsPage canSeePrivate={isOwner} />} />
            <Route path="/situasjoner/:id" element={<SituationPage canManage={isOwner} />} />
            <Route path="/trafikk" element={<TrafficMapPage />} />
            <Route path="/vaer" element={<WeatherPage />} />
            <Route path="/sport" element={<SportPage initialArticles={data.articles} />} />
            <Route path="/varsler" element={<NotificationSettingsPage />} />
            <Route path="/lagret" element={ownerOnly(<SavedPage />)} />
            <Route path="/command" element={ownerOnly(<OperationsPage />)} />
            <Route path="/command/brief" element={ownerOnly(<CommandBriefingPage />)} />
            <Route path="/command/tilgang" element={ownerOnly(<AccessRequestsPage />)} />
            <Route path="/command/dekning" element={ownerOnly(<CoverageBundlesPage />)} />
            <Route path="/command/kilder" element={ownerOnly(<SourceAuditPage />)} />
            <Route
              path="/command/varsler"
              element={ownerOnly(<NotificationTriggerCandidatesPage />)}
            />
            <Route path="/command/romlig" element={ownerOnly(<SpatialAnalyticsPage />)} />
            <Route path="/command/radata" element={ownerOnly(<RawDataInspectorPage />)} />
            <Route path="/command/tidslinje" element={ownerOnly(<OperationsTimelinePage />)} />
            <Route path="/drift" element={<LegacyCommandRedirect to="/command" />} />
            <Route path="/drift/brief" element={<LegacyCommandRedirect to="/command/brief" />} />
            <Route
              path="/drift/tilgang"
              element={<LegacyCommandRedirect to="/command/tilgang" />}
            />
            <Route
              path="/drift/dekning"
              element={<LegacyCommandRedirect to="/command/dekning" />}
            />
            <Route path="/drift/kilder" element={<LegacyCommandRedirect to="/command/kilder" />} />
            <Route
              path="/drift/varsler"
              element={<LegacyCommandRedirect to="/command/varsler" />}
            />
            <Route path="/drift/romlig" element={<LegacyCommandRedirect to="/command/romlig" />} />
            <Route path="/drift/radata" element={<LegacyCommandRedirect to="/command/radata" />} />
            <Route
              path="/drift/tidslinje"
              element={<LegacyCommandRedirect to="/command/tidslinje" />}
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      ) : null}
    </>
  );
}

export function App() {
  const location = useLocation();
  if (location.pathname === "/logg-inn" || location.pathname === "/registrer") {
    return <AccessPage />;
  }
  return <AuthenticatedApp />;
}
