import { type FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, api } from "../api.js";

type SubmitState = "idle" | "submitting" | "sent";

function queryNotice(search: string) {
  const parameters = new URLSearchParams(search);
  if (parameters.get("auth") === "denied") {
    return {
      tone: "alert" as const,
      text: "GitHub-kontoen er ikke på tilgangslisten ennå.",
    };
  }
  if (parameters.get("access") === "verified") {
    return {
      tone: "success" as const,
      text: "E-posten er bekreftet. Forespørselen venter nå på vurdering.",
    };
  }
  if (parameters.get("access") === "invalid") {
    return {
      tone: "alert" as const,
      text: "Bekreftelseslenken er ugyldig eller utløpt. Send inn forespørselen på nytt.",
    };
  }
  if (parameters.get("email") === "invalid") {
    return {
      tone: "alert" as const,
      text: "Innloggingslenken er ugyldig, utløpt eller allerede brukt.",
    };
  }
  return undefined;
}

function errorMessage(reason: unknown, fallback: string) {
  if (reason instanceof ApiError && reason.status === 429) {
    return "For mange forespørsler. Prøv igjen om litt.";
  }
  return reason instanceof Error ? reason.message : fallback;
}

export function AccessPage() {
  const location = useLocation();
  const notice = useMemo(() => queryNotice(location.search), [location.search]);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginWebsite, setLoginWebsite] = useState("");
  const [loginState, setLoginState] = useState<SubmitState>("idle");
  const [loginError, setLoginError] = useState<string>();
  const [displayName, setDisplayName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [requestState, setRequestState] = useState<SubmitState>("idle");
  const [requestError, setRequestError] = useState<string>();

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(undefined);
    setLoginState("submitting");
    try {
      await api.requestEmailLogin({
        email: loginEmail,
        ...(loginWebsite ? { website: loginWebsite } : {}),
      });
      setLoginState("sent");
    } catch (reason) {
      setLoginState("idle");
      setLoginError(errorMessage(reason, "Kunne ikke sende innloggingslenken."));
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError(undefined);
    setRequestState("submitting");
    try {
      await api.requestAccess({
        displayName,
        email: requestEmail,
        ...(message.trim() ? { message } : {}),
        ...(website ? { website } : {}),
      });
      setRequestState("sent");
      setMessage("");
    } catch (reason) {
      setRequestState("idle");
      setRequestError(errorMessage(reason, "Kunne ikke sende tilgangsforespørselen."));
    }
  }

  return (
    <main className="access-page">
      <section className="access-panel" aria-labelledby="access-heading">
        <p className="access-kicker">Nytt Trondheim</p>
        <h1 id="access-heading">Logg inn</h1>
        <p className="access-copy">
          Nytt Trondheim er i lukket beta. GitHub er eierinnlogging, mens godkjente lesere bruker
          engangslenke på e-post.
        </p>
        {notice ? (
          <p
            className={notice.tone === "success" ? "access-success" : "access-alert"}
            role="status"
          >
            {notice.text}
          </p>
        ) : null}
        <div className="access-options">
          <section aria-labelledby="owner-login-heading">
            <h2 id="owner-login-heading">Eier</h2>
            <a className="access-github" href="/auth/github">
              Logg inn med GitHub
            </a>
          </section>
          <section aria-labelledby="email-login-heading">
            <h2 id="email-login-heading">Lesetilgang</h2>
            <form className="access-form compact" onSubmit={(event) => void submitLogin(event)}>
              <label>
                E-post
                <input
                  autoComplete="email"
                  maxLength={254}
                  required
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                />
              </label>
              <label className="access-honey" aria-hidden="true">
                Nettside
                <input
                  tabIndex={-1}
                  value={loginWebsite}
                  onChange={(event) => setLoginWebsite(event.target.value)}
                />
              </label>
              <button type="submit" disabled={loginState === "submitting"}>
                {loginState === "submitting" ? "Sender..." : "Send innloggingslenke"}
              </button>
              {loginError ? (
                <p className="access-alert" role="alert">
                  {loginError}
                </p>
              ) : null}
              {loginState === "sent" ? (
                <p className="access-success" role="status">
                  Hvis e-posten er godkjent, får du en innloggingslenke om litt.
                </p>
              ) : null}
            </form>
          </section>
        </div>
        <section className="access-request-section" aria-labelledby="request-heading">
          <h2 id="request-heading">Be om tilgang</h2>
          <p>
            Registrering er en tilgangsforespørsel. Du bekrefter e-posten først, og eier godkjenner
            før innlogging åpnes.
          </p>
          <form className="access-form" onSubmit={(event) => void submitRequest(event)}>
            <label>
              Navn
              <input
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              E-post
              <input
                autoComplete="email"
                maxLength={254}
                required
                type="email"
                value={requestEmail}
                onChange={(event) => setRequestEmail(event.target.value)}
              />
            </label>
            <label>
              Hvorfor trenger du tilgang?
              <textarea
                maxLength={1000}
                rows={5}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <label className="access-honey" aria-hidden="true">
              Nettside
              <input
                tabIndex={-1}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={requestState === "submitting" || requestState === "sent"}
            >
              {requestState === "sent"
                ? "Forespørsel sendt"
                : requestState === "submitting"
                  ? "Sender..."
                  : "Be om tilgang"}
            </button>
            {requestError ? (
              <p className="access-alert" role="alert">
                {requestError}
              </p>
            ) : null}
            {requestState === "sent" ? (
              <p className="access-success" role="status">
                Sjekk e-posten din for bekreftelseslenke.
              </p>
            ) : null}
          </form>
        </section>
        <Link className="access-home-link" to="/">
          Til forsiden
        </Link>
      </section>
    </main>
  );
}
