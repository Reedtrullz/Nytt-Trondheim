import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import type { BootstrapPayload } from "@nytt/shared";
import { api } from "./api.js";
import { HomePage } from "./pages/HomePage.js";
import { OperationsPage } from "./pages/OperationsPage.js";
import { SavedPage } from "./pages/SavedPage.js";
import { SituationPage } from "./pages/SituationPage.js";
import { SituationsPage } from "./pages/SituationsPage.js";
import { TrafficMapPage } from "./pages/TrafficMapPage.js";

function Header() {
  const [logoutError, setLogoutError] = useState<string>();

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
          <NavLink to="/lagret">Lagret</NavLink>
          <NavLink to="/drift">Drift</NavLink>
        </nav>
        <label className="search">
          <span className="sr-only">Søk i saker</span>
          <input
            placeholder="Søk i saker"
            onChange={(event) =>
              window.dispatchEvent(new CustomEvent("nytt-search", { detail: event.target.value }))
            }
          />
          <span aria-hidden="true">⌕</span>
        </label>
        <div className="refreshed">Oppdatert nå</div>
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

  useEffect(() => {
    api
      .bootstrap()
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <>
      <Header />
      {error ? <div className="fatal-error">{error}</div> : null}
      {!data ? (
        <main className="loading">Henter siste nytt...</main>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage initialData={data} />} />
          <Route path="/situasjoner" element={<SituationsPage />} />
          <Route path="/situasjoner/:id" element={<SituationPage />} />
          <Route path="/trafikk" element={<TrafficMapPage />} />
          <Route path="/lagret" element={<SavedPage />} />
          <Route path="/drift" element={<OperationsPage />} />
        </Routes>
      )}
    </>
  );
}
