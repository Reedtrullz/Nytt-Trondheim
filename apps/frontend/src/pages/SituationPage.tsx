import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MapFeature, SituationWorkspace } from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon } from "../components/Icons.js";
import { SituationMap } from "../components/MapViews.js";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SituationPage() {
  const { id = "" } = useParams();
  const [workspace, setWorkspace] = useState<SituationWorkspace>();
  const [taskText, setTaskText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void api.workspace(id).then(setWorkspace);
  }, [id]);

  if (!workspace) return <main className="loading">Åpner situasjonsrom...</main>;
  const situation = workspace.situation;
  const statusLabel = situation.status === "preliminary" ? "Foreløpig" : "Pågår";

  async function createFeature(geometry: MapFeature["geometry"], label: string) {
    const feature = await api.addFeature(id, {
      geometry,
      properties: { label, provenance: "private_annotation", updatedAt: new Date().toISOString() },
    });
    setWorkspace((current) =>
      current
        ? {
            ...current,
            situation: { ...current.situation, features: [...current.situation.features, feature] },
          }
        : current,
    );
  }

  async function createTask() {
    if (!taskText.trim()) return;
    const task = await api.addTask(id, taskText);
    setWorkspace((current) =>
      current ? { ...current, tasks: [...current.tasks, task] } : current,
    );
    setTaskText("");
  }

  async function toggleTask(taskId: string, completed: boolean) {
    const task = await api.toggleTask(id, taskId, completed);
    setWorkspace((current) =>
      current
        ? { ...current, tasks: current.tasks.map((item) => (item.id === task.id ? task : item)) }
        : current,
    );
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const note = await api.addNote(id, noteText);
    setWorkspace((current) =>
      current ? { ...current, notes: [...current.notes, note] } : current,
    );
    setNoteText("");
  }

  async function uploadAttachment(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const attachment = await api.addAttachment(id, file);
      setWorkspace((current) =>
        current ? { ...current, attachments: [...current.attachments, attachment] } : current,
      );
    } finally {
      setUploading(false);
    }
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
          <strong>Sist oppdatert {formatTime(situation.updatedAt)}</strong>
          <small>{situation.verificationStatus}</small>
          <button>Lagre situasjon</button>
        </div>
      </header>
      <div className="situation-layout">
        <SituationMap situation={situation} onCreateFeature={createFeature} />
        <aside className="intelligence">
          <section>
            <h2>Dette vet vi nå</h2>
            {situation.evidence.map((evidence) => (
              <div className="fact" key={evidence.id}>
                <p>{evidence.claim}</p>
                <span>
                  {evidence.sourceLabel} · {formatTime(evidence.publishedAt)}
                </span>
                <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">
                  Se originalmelding
                </a>
              </div>
            ))}
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
          <section className="related">
            <h2>Relaterte saker</h2>
            {workspace.relatedArticles.map((article) => (
              <a key={article.id} href={article.url} target="_blank" rel="noreferrer">
                <small>
                  {article.sourceLabel} · {formatTime(article.publishedAt)}
                </small>
                {article.title}
              </a>
            ))}
          </section>
        </aside>
      </div>
      <section className="workspace-panel">
        <div className="tasks">
          <h2>Oppgaver</h2>
          {workspace.tasks.map((task) => (
            <label key={task.id}>
              <input
                type="checkbox"
                checked={task.completed}
                onChange={(event) => void toggleTask(task.id, event.target.checked)}
              />
              <span>{task.text}</span>
            </label>
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
            <p key={note.id}>{note.text}</p>
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
              <p className="muted" key={attachment.id}>
                {attachment.filename}
              </p>
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
          <a className="export" href={`/api/situations/${id}/export`}>
            Eksporter arbeidsmappe <ArrowIcon />
          </a>
          <p className="private-note">Privat eksport med PDF, GeoJSON og kildedata.</p>
        </div>
      </section>
    </main>
  );
}
