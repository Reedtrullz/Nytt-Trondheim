import type {
  AccessRequestDecisionInput,
  AccessRequestInput,
  AccessRequestPage,
  AccessRequestQueryInput,
  AccessRequestSubmissionResponse,
  AppUser,
  Attachment,
  ArticlePage,
  ArticleTopic,
  BootstrapPayload,
  CoverageBundlePage,
  CoverageBundleQueryInput,
  EmailLoginRequestInput,
  MapFeature,
  OperationsTimelineQuery,
  OperationsTimelineResponse,
  OperationsStatus,
  PrivateAnnotationUpdateRequest,
  PrivateMapFeatureInput,
  SessionPayload,
  Situation,
  SituationMapWorkspace,
  SituationPage,
  SituationWorkspace,
  SourceAuditFilterQuery,
  SourceAuditWorkspaceResponse,
  SourceItem,
  SourceItemFilters,
  SourceItemPage,
  SourceItemRelationship,
  UserGrantInput,
  UserPage,
  UserUpdateInput,
  WorldCupDashboardPayload,
  WorkspaceNote,
  WorkspaceTask,
} from "@nytt/shared";

let csrfTokenPromise: Promise<string> | undefined;

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter?: string;

  constructor(message: string, status: number, retryAfter?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function csrfToken(): Promise<string> {
  csrfTokenPromise ??= fetch("/api/session", { credentials: "include" })
    .then(async (response) => {
      if (response.status === 401) {
        redirectToLogin();
        throw new ApiError("Innlogging kreves", 401);
      }
      if (!response.ok) {
        throw await apiErrorFromResponse(response);
      }
      return ((await response.json()) as SessionPayload).csrfToken;
    })
    .catch((error) => {
      csrfTokenPromise = undefined;
      throw error;
    });
  return csrfTokenPromise;
}

function redirectToLogin() {
  if (typeof window !== "undefined") {
    window.location.href = "/logg-inn";
  }
}

async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const retryAfter = response.headers.get("Retry-After") ?? undefined;
  if (response.status === 429) {
    return new ApiError("For mange forespørsler. Prøv igjen om litt.", 429, retryAfter);
  }
  const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
    error?: string;
  };
  return new ApiError(body.error ?? "Forespørselen feilet", response.status, retryAfter);
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
    redirectToLogin();
    throw new ApiError("Innlogging kreves", 401);
  }
  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function publicJsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    ...init,
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function situationPath(id: string) {
  return `/api/situations/${encodeURIComponent(id)}`;
}

export const api = {
  requestAccess: (input: AccessRequestInput & { website?: string }) =>
    publicJsonRequest<AccessRequestSubmissionResponse>("/api/access-requests", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  requestEmailLogin: (input: EmailLoginRequestInput & { website?: string }) =>
    publicJsonRequest<AccessRequestSubmissionResponse>("/auth/email/request", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  accessRequests: (query: AccessRequestQueryInput = { limit: 50 }) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "number") {
        parameters.set(key, String(value));
      } else if (typeof value === "string" && value.length > 0) {
        parameters.set(key, value);
      }
    }
    const search = parameters.toString();
    return request<AccessRequestPage>(`/api/access-requests${search ? `?${search}` : ""}`);
  },
  decideAccessRequest: (id: string, input: AccessRequestDecisionInput) =>
    request<AccessRequestPage["items"][number]>(`/api/access-requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  users: () => request<UserPage>("/api/users"),
  grantUserAccess: (input: UserGrantInput) =>
    request<AppUser>("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateUser: (id: string, input: UserUpdateInput) =>
    request<AppUser>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  session: () => request<SessionPayload>("/api/session"),
  bootstrap: () => request<BootstrapPayload>("/api/bootstrap"),
  articles: (
    query: {
      scope?: string;
      category?: string;
      topic?: ArticleTopic;
      q?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value && value !== "Alle") parameters.set(key, String(value));
    }
    return request<ArticlePage>(`/api/articles?${parameters.toString()}`);
  },
  worldCupDashboard: () => request<WorldCupDashboardPayload>("/api/sport/world-cup"),
  sourceItems: (query: SourceItemFilters = {}) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    return request<SourceItemPage>(`/api/source-items?${parameters.toString()}`);
  },
  sourceAudit: (query: SourceAuditFilterQuery = {}) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value) && value.length > 0) {
        parameters.set(key, value.join(","));
      } else if (typeof value === "boolean" || typeof value === "number") {
        parameters.set(key, String(value));
      } else if (typeof value === "string" && value.length > 0) {
        parameters.set(key, value);
      }
    }
    const search = parameters.toString();
    return request<SourceAuditWorkspaceResponse>(
      `/api/operations/source-audit${search ? `?${search}` : ""}`,
    );
  },
  coverageBundles: (query: CoverageBundleQueryInput = { limit: 30 }) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "number") {
        parameters.set(key, String(value));
      } else if (typeof value === "string" && value.length > 0) {
        parameters.set(key, value);
      }
    }
    const search = parameters.toString();
    return request<CoverageBundlePage>(
      `/api/operations/coverage-bundles${search ? `?${search}` : ""}`,
    );
  },
  operationsTimeline: (query: OperationsTimelineQuery = {}) => {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value) && value.length > 0) {
        parameters.set(key, value.join(","));
      } else if (typeof value === "boolean" || typeof value === "number") {
        parameters.set(key, String(value));
      } else if (typeof value === "string" && value.length > 0) {
        parameters.set(key, value);
      }
    }
    const search = parameters.toString();
    return request<OperationsTimelineResponse>(
      `/api/operations/timeline${search ? `?${search}` : ""}`,
    );
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
  situationMapWorkspace: (
    query: {
      statuses?: Situation["status"][];
      sources?: string[];
      provenances?: string[];
      confidenceLevels?: string[];
      includePrivateAnnotations?: boolean;
      q?: string;
    } = {},
  ) => {
    const parameters = new URLSearchParams();
    if (query.statuses?.length) parameters.set("statuses", query.statuses.join(","));
    if (query.sources?.length) parameters.set("sources", query.sources.join(","));
    if (query.provenances?.length) parameters.set("provenances", query.provenances.join(","));
    if (query.confidenceLevels?.length) {
      parameters.set("confidenceLevels", query.confidenceLevels.join(","));
    }
    if (query.includePrivateAnnotations !== undefined) {
      parameters.set("includePrivateAnnotations", String(query.includePrivateAnnotations));
    }
    if (query.q) parameters.set("q", query.q);
    const search = parameters.toString();
    return request<SituationMapWorkspace>(
      `/api/situations/workspace-map${search ? `?${search}` : ""}`,
    );
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
  addFeature: (id: string, feature: PrivateMapFeatureInput) =>
    request<MapFeature>(`${situationPath(id)}/features`, {
      method: "POST",
      body: JSON.stringify({ geometry: feature.geometry, properties: feature.properties }),
    }),
  updateFeature: (id: string, featureId: string, update: string | PrivateAnnotationUpdateRequest) =>
    request<MapFeature>(`${situationPath(id)}/features/${featureId}`, {
      method: "PATCH",
      body: JSON.stringify(typeof update === "string" ? { label: update } : update),
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
    if (response.status === 401) {
      redirectToLogin();
      throw new ApiError("Innlogging kreves", 401);
    }
    if (!response.ok) throw await apiErrorFromResponse(response);
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${id}-arbeidsmappe.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  },
  logout: async () => {
    await request<void>("/auth/logout", { method: "POST" });
    csrfTokenPromise = undefined;
  },
};
