import type {
  Attachment,
  ArticlePage,
  BootstrapPayload,
  MapFeature,
  OperationsStatus,
  SessionPayload,
  Situation,
  SituationPage,
  SituationWorkspace,
  SourceItem,
  SourceItemFilters,
  SourceItemPage,
  SourceItemRelationship,
  WorkspaceNote,
  WorkspaceTask,
} from "@nytt/shared";

let csrfTokenPromise: Promise<string> | undefined;

async function csrfToken(): Promise<string> {
  csrfTokenPromise ??= fetch("/api/session", { credentials: "include" }).then(async (response) => {
    if (!response.ok) throw new Error("Innlogging kreves");
    return ((await response.json()) as SessionPayload).csrfToken;
  });
  return csrfTokenPromise;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const unsafe = init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method);
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(unsafe ? { "X-CSRF-Token": await csrfToken() } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (response.status === 401) {
    window.location.href = "/auth/github";
    throw new Error("Innlogging kreves");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Forespørselen feilet");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function situationPath(id: string) {
  return `/api/situations/${encodeURIComponent(id)}`;
}

export const api = {
  bootstrap: () => request<BootstrapPayload>("/api/bootstrap"),
  articles: (
    query: { scope?: string; category?: string; q?: string; cursor?: string; limit?: number } = {},
  ) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value && value !== "Alle") parameters.set(key, String(value));
    }
    return request<ArticlePage>(`/api/articles?${parameters.toString()}`);
  },
  sourceItems: (query: SourceItemFilters = {}) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    return request<SourceItemPage>(`/api/source-items?${parameters.toString()}`);
  },
  situationSourceItems: (id: string) => request<SourceItem[]>(`${situationPath(id)}/source-items`),
  linkSourceItem: (
    id: string,
    sourceItemId: string,
    relationship: SourceItemRelationship = "supports",
  ) =>
    request<SourceItem>(`${situationPath(id)}/source-items/${encodeURIComponent(sourceItemId)}`, {
      method: "POST",
      body: JSON.stringify({ relationship }),
    }),
  unlinkSourceItem: (id: string, sourceItemId: string) =>
    request<void>(`${situationPath(id)}/source-items/${encodeURIComponent(sourceItemId)}`, {
      method: "DELETE",
    }),
  situations: (
    query: {
      status?: Situation["status"];
      saved?: boolean;
      includeDismissed?: boolean;
      cursor?: string;
    } = {},
  ) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    return request<SituationPage>(`/api/situations?${parameters.toString()}`);
  },
  savedArticles: () => request<ArticlePage["items"]>("/api/saved/articles"),
  operations: () => request<OperationsStatus>("/api/operations/status"),
  workspace: (id: string) => request<SituationWorkspace>(situationPath(id)),
  saveArticle: (id: string, saved: boolean) =>
    request<void>(`/api/saved/articles/${id}`, { method: saved ? "PUT" : "DELETE" }),
  saveSituation: (id: string, saved: boolean) =>
    request<void>(`${situationPath(id)}/saved`, { method: saved ? "PUT" : "DELETE" }),
  setSituationStatus: (
    id: string,
    status: "active" | "resolved" | "dismissed",
    dismissalReason?: "false_positive" | "owner_dismissed",
  ) =>
    request<SituationWorkspace["situation"]>(`${situationPath(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, dismissalReason }),
    }),
  addFeature: (id: string, feature: Pick<MapFeature, "geometry" | "properties">) =>
    request<MapFeature>(`${situationPath(id)}/features`, {
      method: "POST",
      body: JSON.stringify({ geometry: feature.geometry, properties: feature.properties }),
    }),
  updateFeature: (id: string, featureId: string, label: string) =>
    request<MapFeature>(`${situationPath(id)}/features/${featureId}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),
  deleteFeature: (id: string, featureId: string) =>
    request<void>(`${situationPath(id)}/features/${featureId}`, { method: "DELETE" }),
  addTask: (id: string, text: string) =>
    request<WorkspaceTask>(`${situationPath(id)}/tasks`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  toggleTask: (id: string, taskId: string, completed: boolean) =>
    request<WorkspaceTask>(`${situationPath(id)}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    }),
  updateTask: (id: string, taskId: string, text: string) =>
    request<WorkspaceTask>(`${situationPath(id)}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ text }),
    }),
  deleteTask: (id: string, taskId: string) =>
    request<void>(`${situationPath(id)}/tasks/${taskId}`, { method: "DELETE" }),
  addNote: (id: string, text: string) =>
    request<WorkspaceNote>(`${situationPath(id)}/notes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  deleteNote: (id: string, noteId: string) =>
    request<void>(`${situationPath(id)}/notes/${noteId}`, { method: "DELETE" }),
  updateNote: (id: string, noteId: string, text: string) =>
    request<WorkspaceNote>(`${situationPath(id)}/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ text }),
    }),
  addAttachment: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Attachment>(`${situationPath(id)}/attachments`, { method: "POST", body });
  },
  deleteAttachment: (id: string, attachmentId: string) =>
    request<void>(`${situationPath(id)}/attachments/${attachmentId}`, { method: "DELETE" }),
  exportWorkspace: async (id: string) => {
    const response = await fetch(`${situationPath(id)}/exports`, {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": await csrfToken() },
    });
    if (!response.ok) throw new Error("Eksporten kunne ikke opprettes");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${id}-arbeidsmappe.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  },
  logout: () => request<void>("/auth/logout", { method: "POST" }),
};
