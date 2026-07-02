import { type FormEvent, useEffect, useState } from "react";
import type {
  AccessRequest,
  AccessRequestDecisionInput,
  AccessRequestPage as AccessRequestPagePayload,
  AccessRequestStatus,
  AppUser,
  UserGrantInput,
  UserPage,
  UserUpdateInput,
} from "@nytt/shared";
import { ApiError, api } from "../api.js";

const statusFilters: Array<AccessRequestStatus | "all"> = [
  "all",
  "unverified",
  "pending",
  "approved",
  "rejected",
];

function time(value?: string) {
  if (!value) return "Aldri";
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Oslo",
  }).format(new Date(value));
}

function statusLabel(status: AccessRequest["status"]) {
  const labels: Record<AccessRequest["status"], string> = {
    unverified: "Ubekreftet",
    pending: "Venter",
    approved: "Godkjent",
    rejected: "Avvist",
  };
  return labels[status];
}

function userStatusLabel(status: AppUser["status"]) {
  return status === "active" ? "Aktiv" : "Tilbakekalt";
}

function roleLabel(role: AppUser["role"]) {
  return role === "owner" ? "Eier" : "Leser";
}

function viewerAccessSummary(users?: UserPage, fallbackApproved = 0) {
  if (!users) return { active: fallbackApproved, revoked: 0 };
  return users.items.reduce(
    (summary, user) => {
      if (user.role !== "viewer") return summary;
      if (user.status === "active") summary.active += 1;
      if (user.status === "revoked") summary.revoked += 1;
      return summary;
    },
    { active: 0, revoked: 0 },
  );
}

function viewerAccessLabel(summary: { active: number; revoked: number }) {
  const active = summary.active === 1 ? "1 aktiv leser" : `${summary.active} aktive lesere`;
  return `${active} · ${summary.revoked} tilbakekalt`;
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function DirectGrantForm({
  busy,
  onGrantAccess,
}: {
  busy?: boolean;
  onGrantAccess?: (input: UserGrantInput) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { displayName: displayName.trim(), email: email.trim().toLowerCase() };
    if (!input.displayName || !input.email || !onGrantAccess) return;
    onGrantAccess(input);
  }

  return (
    <section className="direct-access-grant" aria-labelledby="direct-access-grant-heading">
      <header>
        <div>
          <p className="label">Direkte tilgang</p>
          <h2 id="direct-access-grant-heading">Gi tilgang uten forespørsel</h2>
        </div>
      </header>
      <form onSubmit={submit}>
        <label>
          <span>Navn</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            minLength={2}
            maxLength={120}
            required
          />
        </label>
        <label>
          <span>E-post</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            required
          />
        </label>
        <button type="submit" disabled={busy || !onGrantAccess}>
          Gi tilgang
        </button>
      </form>
    </section>
  );
}

export function AccessRequestsDashboard({
  page,
  users,
  status = "all",
  busyId,
  successMessage,
  onFilter,
  onDecision,
  onGrantAccess,
  onUserUpdate,
}: {
  page: AccessRequestPagePayload;
  users?: UserPage;
  status?: AccessRequestStatus | "all";
  busyId?: string;
  successMessage?: string;
  onFilter?: (status: AccessRequestStatus | "all") => void;
  onDecision?: (id: string, input: AccessRequestDecisionInput) => void;
  onGrantAccess?: (input: UserGrantInput) => void;
  onUserUpdate?: (id: string, input: UserUpdateInput) => void;
}) {
  const viewerSummary = viewerAccessSummary(users, page.summary.approved);

  return (
    <main className="access-requests-page">
      <header className="page-heading">
        <p className="label">Privat kommandosenter</p>
        <h1>Tilgangsforespørsler</h1>
        <p>
          {page.summary.pending} venter på vurdering. {page.summary.unverified} mangler
          e-postbekreftelse.
        </p>
      </header>
      {successMessage ? (
        <div className="inline-success" role="status">
          {successMessage}
        </div>
      ) : null}
      <section className="access-request-summary" aria-label="Tilgangsoppsummering">
        <article>
          <strong>{page.summary.unverified}</strong>
          <span>Ubekreftet</span>
        </article>
        <article>
          <strong>{page.summary.pending}</strong>
          <span>Venter</span>
        </article>
        <article>
          <strong>{viewerSummary.active}</strong>
          <span>Godkjente lesere</span>
        </article>
        <article>
          <strong>{page.summary.rejected}</strong>
          <span>Avvist</span>
        </article>
      </section>
      {onFilter ? (
        <div className="access-request-filters" aria-label="Filtrer tilgangsforespørsler">
          {statusFilters.map((item) => (
            <button
              type="button"
              key={item}
              className={status === item ? "selected" : undefined}
              aria-pressed={status === item}
              onClick={() => onFilter(item)}
            >
              {item === "all" ? "Alle" : statusLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
      <DirectGrantForm busy={busyId === "grant-access"} onGrantAccess={onGrantAccess} />
      <section className="access-request-list" aria-label="Forespørsler">
        {page.items.length === 0 ? (
          <p className="empty-panel">Ingen tilgangsforespørsler matcher filteret.</p>
        ) : null}
        {page.items.map((request) => (
          <article key={request.id} className="access-request-row">
            <div>
              <p className="label">{statusLabel(request.status)}</p>
              <h2>{request.displayName}</h2>
              <a href={`mailto:${request.email}`}>{request.email}</a>
            </div>
            <p>{request.message || "Ingen melding."}</p>
            <dl>
              <div>
                <dt>Sendt</dt>
                <dd>{time(request.requestedAt)}</dd>
              </div>
              <div>
                <dt>Bekreftet</dt>
                <dd>{time(request.emailVerifiedAt)}</dd>
              </div>
              {request.reviewedAt ? (
                <div>
                  <dt>Vurdert</dt>
                  <dd>{time(request.reviewedAt)}</dd>
                </div>
              ) : null}
            </dl>
            {request.status === "pending" && onDecision ? (
              <div className="access-request-actions">
                <ActionButton
                  disabled={busyId === request.id}
                  onClick={() => onDecision(request.id, { status: "approved" })}
                >
                  Godkjenn
                </ActionButton>
                <ActionButton
                  disabled={busyId === request.id}
                  onClick={() => onDecision(request.id, { status: "rejected" })}
                >
                  Avvis
                </ActionButton>
              </div>
            ) : null}
            {request.status === "unverified" ? (
              <p className="muted">Venter på e-postbekreftelse før eier kan vurdere.</p>
            ) : null}
          </article>
        ))}
      </section>
      {users ? (
        <section className="user-admin-list" aria-label="Brukere">
          <header>
            <div>
              <p className="label">Brukere</p>
              <h2>Godkjente kontoer</h2>
            </div>
            <span>{viewerAccessLabel(viewerSummary)}</span>
          </header>
          {users.items.map((user) => (
            <article key={user.id} className="user-admin-row">
              <div>
                <p className="label">
                  {roleLabel(user.role)} · {userStatusLabel(user.status)}
                </p>
                <h3>{user.displayName}</h3>
                {user.email ? (
                  <a href={`mailto:${user.email}`}>{user.email}</a>
                ) : (
                  <span>GitHub</span>
                )}
              </div>
              <dl>
                <div>
                  <dt>Sist innlogget</dt>
                  <dd>{time(user.lastLoginAt)}</dd>
                </div>
                <div>
                  <dt>Oppdatert</dt>
                  <dd>{time(user.updatedAt)}</dd>
                </div>
              </dl>
              {user.role === "viewer" && onUserUpdate ? (
                <div className="access-request-actions">
                  {user.status === "active" ? (
                    <ActionButton
                      disabled={busyId === user.id}
                      onClick={() => onUserUpdate(user.id, { status: "revoked" })}
                    >
                      Tilbakekall
                    </ActionButton>
                  ) : (
                    <ActionButton
                      disabled={busyId === user.id}
                      onClick={() => onUserUpdate(user.id, { status: "active" })}
                    >
                      Gjenåpne
                    </ActionButton>
                  )}
                  <ActionButton
                    disabled={busyId === user.id || user.status !== "active"}
                    onClick={() => onUserUpdate(user.id, { resendInvite: true })}
                  >
                    Send lenke
                  </ActionButton>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}

export function AccessRequestsPage() {
  const [page, setPage] = useState<AccessRequestPagePayload>();
  const [users, setUsers] = useState<UserPage>();
  const [status, setStatus] = useState<AccessRequestStatus | "all">("pending");
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    setError(undefined);
    const query = status === "all" ? { limit: 100 } : { status, limit: 100 };
    Promise.all([api.accessRequests(query), api.users()])
      .then(([requestPage, userPage]) => {
        if (!ignore) {
          setPage(requestPage);
          setUsers(userPage);
        }
      })
      .catch((reason: Error) => {
        if (!ignore) {
          setError(
            reason instanceof ApiError && reason.status === 429
              ? "For mange forespørsler. Prøv igjen om litt."
              : reason.message,
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [attempt, status]);

  async function decide(id: string, input: AccessRequestDecisionInput) {
    setBusyId(id);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      await api.decideAccessRequest(id, input);
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason, "Kunne ikke oppdatere forespørselen."));
    } finally {
      setBusyId(undefined);
    }
  }

  async function grantUserAccess(input: UserGrantInput) {
    setBusyId("grant-access");
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      const user = await api.grantUserAccess(input);
      setSuccessMessage(`Tilgang er åpnet for ${user.email ?? user.displayName}.`);
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason, "Kunne ikke gi tilgang."));
    } finally {
      setBusyId(undefined);
    }
  }

  async function updateUser(id: string, input: UserUpdateInput) {
    setBusyId(id);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      await api.updateUser(id, input);
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason, "Kunne ikke oppdatere brukeren."));
    } finally {
      setBusyId(undefined);
    }
  }

  if (error && !page) {
    return (
      <main className="access-requests-page fatal-error" role="alert">
        {error}
      </main>
    );
  }
  if (!page) return <main className="access-requests-page">Henter tilgangsforespørsler...</main>;
  return (
    <>
      {error ? (
        <div className="floating-error" role="alert">
          {error}
        </div>
      ) : null}
      <AccessRequestsDashboard
        page={page}
        users={users}
        status={status}
        busyId={busyId}
        successMessage={successMessage}
        onFilter={setStatus}
        onDecision={(id, input) => void decide(id, input)}
        onGrantAccess={(input) => void grantUserAccess(input)}
        onUserUpdate={(id, input) => void updateUser(id, input)}
      />
    </>
  );
}

function errorMessage(reason: unknown, fallback: string) {
  if (reason instanceof ApiError && reason.status === 429) {
    return "For mange forespørsler. Prøv igjen om litt.";
  }
  return reason instanceof Error ? reason.message : fallback;
}
