import type {
  Attachment,
  BootstrapPayload,
  MapFeature,
  SituationWorkspace,
  WorkspaceNote,
  WorkspaceTask,
} from "@nytt/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
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

export const api = {
  bootstrap: () => request<BootstrapPayload>("/api/bootstrap"),
  workspace: (id: string) => request<SituationWorkspace>(`/api/situations/${id}`),
  saveArticle: (id: string, saved: boolean) =>
    request<void>(`/api/saved/${id}`, { method: "PUT", body: JSON.stringify({ saved }) }),
  addFeature: (id: string, feature: Pick<MapFeature, "geometry" | "properties">) =>
    request<MapFeature>(`/api/situations/${id}/features`, {
      method: "POST",
      body: JSON.stringify({ geometry: feature.geometry, properties: feature.properties }),
    }),
  addTask: (id: string, text: string) =>
    request<WorkspaceTask>(`/api/situations/${id}/tasks`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  toggleTask: (id: string, taskId: string, completed: boolean) =>
    request<WorkspaceTask>(`/api/situations/${id}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    }),
  addNote: (id: string, text: string) =>
    request<WorkspaceNote>(`/api/situations/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  addAttachment: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Attachment>(`/api/situations/${id}/attachments`, { method: "POST", body });
  },
};
