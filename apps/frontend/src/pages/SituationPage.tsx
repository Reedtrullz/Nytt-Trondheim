import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type PrivateMapFeatureInput,
  type SituationWorkspace,
  type SourceItem,
  type SourceItemRelationship,
} from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon } from "../components/Icons.js";
import { SituationMap } from "../components/MapViews.js";
import { SituationExplanationPanel } from "../components/situations/SituationExplanation.js";
import { SituationSourceItemsPanel } from "../components/situations/SituationSourceItemsPanel.js";
import { safeExternalUrl } from "../safeExternalUrl.js";
import { formatSituationTimestamp } from "../situationTime.js";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(value));
}

export function SituationPage({ canManage = true }: { canManage?: boolean }) {
  const { id = "" } = useParams();
  const [workspace, setWorkspace] = useState<SituationWorkspace>();
  const [sourceItems, setSourceItems] = useState<SourceItem[]>([]);
  const [sourceItemsLoading, setSourceItemsLoading] = useState(false);
  const [sourceItemsError, setSourceItemsError] = useState<string>();
  const [sourceItemsRetry, setSourceItemsRetry] = useState(0);
  const [sourceItemSearch, setSourceItemSearch] = useState("");
  const [sourceItemRelationship, setSourceItemRelationship] =
    useState<SourceItemRelationship>("supports");
  const [sourceItemCandidates, setSourceItemCandidates] = useState<SourceItem[]>([]);
  const [sourceItemCandidatesLoading, setSourceItemCandidatesLoading] = useState(false);
  const [sourceItemCandidatesError, setSourceItemCandidatesError] = useState<string>();
  const [linkingSourceItemId, setLinkingSourceItemId] = useState<string>();
  const [taskText, setTaskText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingSituation, setSavingSituation] = useState(false);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();

  useEffect(() => {
    let ignore = false;

    setWorkspace(undefined);
    setError(undefined);

    void api
      .workspace(id)
      .then((workspaceResult) => {
        if (!ignore) setWorkspace(workspaceResult);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });

    return () => {
      ignore = true;
    };
  }, [id]);

  useEffect(() => {
    let ignore = false;

    setSourceItems([]);
    setSourceItemsError(undefined);
    setSourceItemsLoading(true);

    void api
      .situationSourceItems(id)
      .then((sourceItemResult) => {
        if (!ignore) setSourceItems(sourceItemResult);
      })
      .catch((reason: Error) => {
        if (!ignore) setSourceItemsError(reason.message);
      })
      .finally(() => {
        if (!ignore) setSourceItemsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [id, sourceItemsRetry]);

  function retrySourceItems() {
    setSourceItemsRetry((attempt) => attempt + 1);
  }

  async function loadSourceItemCandidates() {
    if (!canManage) return;
    setSourceItemCandidatesLoading(true);
    setSourceItemCandidatesError(undefined);
    try {
      const linkedIds = new Set(sourceItems.map((item) => item.id));
      const page = await api.sourceItems({
        q: sourceItemSearch.trim() || undefined,
        unlinked: true,
        limit: 10,
      });
      setSourceItemCandidates(page.items.filter((item) => !linkedIds.has(item.id)));
    } catch (reason) {
      setSourceItemCandidatesError(
        reason instanceof Error ? reason.message : "Kunne ikke søke kildeelementer",
      );
    } finally {
      setSourceItemCandidatesLoading(false);
    }
  }

  if (error) return <main className="loading">Kunne ikke åpne situasjonsrom: {error}</main>;
  if (!workspace) return <main className="loading">Åpner situasjonsrom...</main>;
  const situation = workspace.situation;
  const statusLabel =
    situation.status === "preliminary"
      ? "Foreløpig"
      : situation.status === "resolved"
        ? "Avsluttet"
        : situation.status === "dismissed"
          ? "Avvist som feilkobling"
          : "Pågår";

  async function performAction<T>(
    request: () => Promise<T>,
    apply: (value: T) => void,
    message?: string,
  ): Promise<boolean> {
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      const value = await request();
      apply(value);
      if (message) setActionMessage(message);
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Handlingen feilet");
      return false;
    }
  }

  async function createFeature(
    geometry: PrivateMapFeatureInput["geometry"],
    properties: PrivateMapFeatureInput["properties"],
  ): Promise<boolean> {
    return performAction(
      () =>
        api.addFeature(id, {
          geometry,
          properties,
        }),
      (feature) =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                situation: {
                  ...current.situation,
                  features: [...current.situation.features, feature],
                },
              }
            : current,
        ),
      "Privat markering lagret.",
    );
  }

  async function updateFeature(featureId: string, label: string) {
    await performAction(
      () => api.updateFeature(id, featureId, label),
      (feature) =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                situation: {
                  ...current.situation,
                  features: current.situation.features.map((item) =>
                    item.id === feature.id ? feature : item,
                  ),
                },
              }
            : current,
        ),
      "Privat markering oppdatert.",
    );
  }

  async function deleteFeature(featureId: string) {
    await performAction(
      () => api.deleteFeature(id, featureId),
      () =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                situation: {
                  ...current.situation,
                  features: current.situation.features.filter(
                    (feature) => feature.id !== featureId,
                  ),
                },
              }
            : current,
        ),
      "Privat markering slettet.",
    );
  }

  async function createTask() {
    if (!taskText.trim()) return;
    await performAction(
      () => api.addTask(id, taskText),
      (task) => {
        setWorkspace((current) =>
          current ? { ...current, tasks: [...current.tasks, task] } : current,
        );
        setTaskText("");
      },
    );
  }

  async function toggleTask(taskId: string, completed: boolean) {
    await performAction(
      () => api.toggleTask(id, taskId, completed),
      (task) =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
              }
            : current,
        ),
    );
  }

  async function addNote() {
    if (!noteText.trim()) return;
    await performAction(
      () => api.addNote(id, noteText),
      (note) => {
        setWorkspace((current) =>
          current ? { ...current, notes: [...current.notes, note] } : current,
        );
        setNoteText("");
      },
    );
  }

  async function uploadAttachment(file?: File) {
    if (!file) return;
    setUploading(true);
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      const attachment = await api.addAttachment(id, file);
      setWorkspace((current) =>
        current ? { ...current, attachments: [...current.attachments, attachment] } : current,
      );
      setActionMessage("Vedlegget er lastet opp.");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Opplastingen feilet");
    } finally {
      setUploading(false);
    }
  }

  async function exportWorkspace() {
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      await api.exportWorkspace(id);
      setActionMessage("Arbeidsmappen er eksportert.");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Eksporten feilet");
    }
  }

  async function saveSituation() {
    if (savingSituation) return;
    const saved = !situation.saved;
    setSavingSituation(true);
    try {
      await performAction(
        () => api.saveSituation(id, saved),
        () =>
          setWorkspace((current) =>
            current ? { ...current, situation: { ...current.situation, saved } } : current,
          ),
      );
    } finally {
      setSavingSituation(false);
    }
  }

  async function linkSourceItemToSituation(sourceItemId: string) {
    if (!canManage || linkingSourceItemId) return;
    setLinkingSourceItemId(sourceItemId);
    try {
      await performAction(
        () => api.linkSourceItem(id, sourceItemId, sourceItemRelationship),
        (linked) => {
          setSourceItems((current) => [linked, ...current.filter((item) => item.id !== linked.id)]);
          setSourceItemCandidates((current) => current.filter((item) => item.id !== linked.id));
        },
        "Kildeelementet er koblet til situasjonen.",
      );
    } finally {
      setLinkingSourceItemId(undefined);
    }
  }

  async function unlinkSourceItemFromSituation(sourceItemId: string) {
    if (!canManage) return;
    await performAction(
      () => api.unlinkSourceItem(id, sourceItemId),
      () => setSourceItems((current) => current.filter((item) => item.id !== sourceItemId)),
      "Kildeelementet er koblet fra situasjonen.",
    );
  }

  async function resolveSituation() {
    await performAction(
      () => api.setSituationStatus(id, "resolved"),
      (updated) =>
        setWorkspace((current) => (current ? { ...current, situation: updated } : current)),
      "Situasjonen er markert som avsluttet.",
    );
  }

  async function dismissSituation() {
    await performAction(
      () => api.setSituationStatus(id, "dismissed", "false_positive"),
      (updated) =>
        setWorkspace((current) => (current ? { ...current, situation: updated } : current)),
      "Situasjonen er avvist som feilkobling.",
    );
  }

  async function deleteTask(taskId: string) {
    await performAction(
      () => api.deleteTask(id, taskId),
      () =>
        setWorkspace((current) =>
          current
            ? { ...current, tasks: current.tasks.filter((task) => task.id !== taskId) }
            : current,
        ),
    );
  }

  async function updateTask(taskId: string, text: string) {
    await performAction(
      () => api.updateTask(id, taskId, text),
      (task) =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
              }
            : current,
        ),
    );
  }

  async function deleteNote(noteId: string) {
    await performAction(
      () => api.deleteNote(id, noteId),
      () =>
        setWorkspace((current) =>
          current
            ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) }
            : current,
        ),
    );
  }

  async function updateNote(noteId: string, text: string) {
    await performAction(
      () => api.updateNote(id, noteId, text),
      (note) =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                notes: current.notes.map((item) => (item.id === note.id ? note : item)),
              }
            : current,
        ),
    );
  }

  async function deleteAttachment(attachmentId: string) {
    await performAction(
      () => api.deleteAttachment(id, attachmentId),
      () =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                attachments: current.attachments.filter(
                  (attachment) => attachment.id !== attachmentId,
                ),
              }
            : current,
        ),
      "Vedlegget er slettet.",
    );
  }

  return (
    <main className="situation-page">
      <Link className="back" to="/">
        ← Tilbake til siste nytt
      </Link>
      <header className="incident-header">
        <div>
          <p className="label">Situasjonsrom</p>
          <h1>{situation.title}</h1>
          <p className="incident-intro">{situation.summary}</p>
        </div>
        <div className="incident-state">
          <span className="status">{statusLabel}</span>
          <strong>Sist oppdatert {formatSituationTimestamp(situation.updatedAt)}</strong>
          <small>Hendelsen startet {formatSituationTimestamp(situation.createdAt)}</small>
          <small>{situation.verificationStatus}</small>
          {canManage ? (
            <>
              <button onClick={() => void saveSituation()} disabled={savingSituation}>
                {situation.saved ? "Fjern lagring" : "Lagre situasjon"}
              </button>
              {situation.status !== "resolved" && situation.status !== "dismissed" ? (
                <button onClick={() => void resolveSituation()}>Marker avsluttet</button>
              ) : null}
              {situation.status !== "dismissed" ? (
                <button className="dismiss" onClick={() => void dismissSituation()}>
                  Avvis feilkobling
                </button>
              ) : null}
            </>
          ) : null}
          {situation.dismissalReason ? (
            <small>Begrunnelse: Feilkobling i automatisk gruppering</small>
          ) : null}
        </div>
      </header>
      <SituationExplanationPanel explanation={workspace.explanation} />
      <div className="situation-layout">
        <SituationMap
          situation={situation}
          onCreateFeature={canManage ? createFeature : undefined}
          onUpdateFeature={canManage ? updateFeature : undefined}
          onDeleteFeature={canManage ? deleteFeature : undefined}
        />
        <aside className="intelligence">
          <section>
            <h2>Dette vet vi nå</h2>
            {situation.evidence.map((evidence) => {
              const sourceUrl = safeExternalUrl(evidence.sourceUrl);
              return (
                <div className="fact" key={evidence.id}>
                  <p>{evidence.claim}</p>
                  <span>
                    {evidence.sourceLabel} · {formatTime(evidence.publishedAt)}
                  </span>
                  {sourceUrl ? (
                    <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
                      Se originalmelding
                    </a>
                  ) : null}
                </div>
              );
            })}
          </section>
          <section className="timeline">
            <h2>Utvikling</h2>
            {situation.timeline.map((entry) => (
              <article key={entry.id}>
                <time>{formatTime(entry.timestamp)}</time>
                <strong>{entry.title}</strong>
                <p>{entry.detail}</p>
                <span>{entry.sourceLabel}</span>
              </article>
            ))}
          </section>
          <SituationSourceItemsPanel
            sourceItems={sourceItems}
            loading={sourceItemsLoading}
            error={sourceItemsError}
            canManage={canManage}
            search={sourceItemSearch}
            relationship={sourceItemRelationship}
            candidates={sourceItemCandidates}
            candidatesLoading={sourceItemCandidatesLoading}
            candidatesError={sourceItemCandidatesError}
            linkingSourceItemId={linkingSourceItemId}
            onRetry={retrySourceItems}
            onSearchChange={setSourceItemSearch}
            onRelationshipChange={setSourceItemRelationship}
            onLoadCandidates={() => void loadSourceItemCandidates()}
            onLink={(sourceItemId) => void linkSourceItemToSituation(sourceItemId)}
            onUnlink={(sourceItemId) => void unlinkSourceItemFromSituation(sourceItemId)}
          />
          <section className="related">
            <h2>Relaterte saker</h2>
            {workspace.relatedArticles.map((article) => {
              const articleUrl = safeExternalUrl(article.url);
              const content = (
                <>
                  <small>
                    {article.sourceLabel} · {formatTime(article.publishedAt)}
                  </small>
                  {article.title}
                </>
              );
              return articleUrl ? (
                <a key={article.id} href={articleUrl} target="_blank" rel="noreferrer noopener">
                  {content}
                </a>
              ) : (
                <article key={article.id}>{content}</article>
              );
            })}
          </section>
        </aside>
      </div>
      {canManage ? (
        <section className="workspace-panel">
          {actionError ? <p className="workspace-error">{actionError}</p> : null}
          {actionMessage ? <p className="workspace-success">{actionMessage}</p> : null}
          <div className="tasks">
            <h2>Oppgaver</h2>
            {workspace.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={toggleTask}
                onUpdate={updateTask}
                onDelete={deleteTask}
              />
            ))}
            <div className="inline-form">
              <input
                value={taskText}
                onChange={(event) => setTaskText(event.target.value)}
                placeholder="Ny oppgave"
              />
              <button onClick={() => void createTask()}>Legg til</button>
            </div>
          </div>
          <div className="notes">
            <h2>Notater</h2>
            {workspace.notes.map((note) => (
              <NoteRow key={note.id} note={note} onUpdate={updateNote} onDelete={deleteNote} />
            ))}
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Skriv privat notat..."
            />
            <button onClick={() => void addNote()}>Legg til notat</button>
          </div>
          <div className="attachments">
            <h2>Vedlegg</h2>
            {workspace.attachments.length ? (
              workspace.attachments.map((attachment) => (
                <div className="workspace-item" key={attachment.id}>
                  <a
                    className="muted"
                    href={`/api/situations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}`}
                  >
                    {attachment.filename}
                  </a>
                  <button className="remove" onClick={() => void deleteAttachment(attachment.id)}>
                    Slett
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">Ingen vedlegg lastet opp</p>
            )}
            <label className="upload">
              {uploading ? "Laster opp..." : "Legg til vedlegg"}
              <input
                type="file"
                disabled={uploading}
                onChange={(event) => void uploadAttachment(event.target.files?.[0])}
              />
            </label>
            <button className="export" onClick={() => void exportWorkspace()}>
              Eksporter arbeidsmappe <ArrowIcon />
            </button>
            <p className="private-note">Privat eksport med PDF, GeoJSON og kildedata.</p>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function TaskRow({
  task,
  onToggle,
  onUpdate,
  onDelete,
}: {
  task: SituationWorkspace["tasks"][number];
  onToggle: (id: string, completed: boolean) => Promise<void>;
  onUpdate: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState(task.text);
  return (
    <div className="workspace-item">
      <input
        aria-label={`Fullfør ${task.text}`}
        type="checkbox"
        checked={task.completed}
        onChange={(event) => void onToggle(task.id, event.target.checked)}
      />
      <input
        aria-label={`Rediger oppgave: ${task.text}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button onClick={() => void onUpdate(task.id, text)}>Lagre</button>
      <button className="remove" onClick={() => void onDelete(task.id)}>
        Slett
      </button>
    </div>
  );
}

function NoteRow({
  note,
  onUpdate,
  onDelete,
}: {
  note: SituationWorkspace["notes"][number];
  onUpdate: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState(note.text);
  return (
    <div className="workspace-item">
      <input
        aria-label="Rediger notat"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button onClick={() => void onUpdate(note.id, text)}>Lagre</button>
      <button className="remove" onClick={() => void onDelete(note.id)}>
        Slett
      </button>
    </div>
  );
}
