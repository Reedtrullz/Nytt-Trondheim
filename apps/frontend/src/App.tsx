import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import type { BootstrapPayload } from "@nytt/shared";
import { api } from "./api.js";
import { HomePage } from "./pages/HomePage.js";
import { SituationPage } from "./pages/SituationPage.js";

function Header() {
  return (
    <header className="site-header">
      <div className="masthead">
        <Link className="brand" to="/">
          Nytt Trondheim
        </Link>
        <nav aria-label="Hovedmeny">
          <NavLink to="/">Siste nytt</NavLink>
          <NavLink to="/situasjoner/skogbrann-bymarka">Situasjonsrom</NavLink>
          <a href="#lagret">Lagret</a>
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
      </div>
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
          <Route path="/situasjoner/:id" element={<SituationPage />} />
        </Routes>
      )}
    </>
  );
}
