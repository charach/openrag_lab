/**
 * Thin REST client. All endpoints are accessed through ``api.<thing>``;
 * the proxy in ``vite.config.ts`` strips the leading ``/api`` and forwards
 * to the FastAPI server on port 8000 in dev. In bundle mode the same prefix
 * lands on FastAPI's mounted router.
 */

const BASE = "/api";

export interface ApiError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

export class ApiException extends Error {
  readonly status: number;
  readonly error: ApiError;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.error = error;
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  const finalInit: RequestInit = { ...init };
  if (init?.json !== undefined) {
    headers.set("content-type", "application/json");
    finalInit.body = JSON.stringify(init.json);
  }
  finalInit.headers = headers;
  const resp = await fetch(`${BASE}${path}`, finalInit);
  if (resp.status === 204) return undefined as T;
  const contentType = resp.headers.get("content-type") || "";
  if (!resp.ok) {
    if (contentType.includes("application/json")) {
      const payload = (await resp.json()) as { error?: ApiError };
      if (payload.error) throw new ApiException(resp.status, payload.error);
    }
    throw new ApiException(resp.status, {
      code: "UNKNOWN",
      message: resp.statusText,
      recoverable: false,
    });
  }
  if (contentType.includes("application/json")) {
    return (await resp.json()) as T;
  }
  return (await resp.text()) as unknown as T;
}

export interface SystemProfileResponse {
  cpu: { cores: number; threads: number; model: string };
  ram: { total_gb: number; available_gb: number | null };
  gpu: {
    available: boolean;
    vendor: string | null;
    name: string | null;
    vram_gb: number | null;
    acceleration_backend: string;
    available_backends: string[];
  };
  os: { platform: string; version: string; arch: string };
  paths: { openrag_home: string };
  warnings: string[];
}

export interface PresetResponse {
  presets: Array<{
    id: string;
    name: string;
    available: boolean;
    recommended?: boolean;
    config: {
      embedder_id: string;
      chunking: { strategy: string; chunk_size: number; chunk_overlap: number };
      retrieval_strategy: string;
      top_k: number;
      llm_id: string | null;
    };
    rationale?: string;
  }>;
}

export interface WorkspaceConfig {
  embedder_id: string | null;
  chunking: { strategy: string | null; chunk_size: number | null; chunk_overlap: number | null };
  retrieval_strategy: string;
  top_k: number;
  llm_id: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  created_at: string;
  stats: {
    document_count: number;
    chunk_count: number;
    experiment_count: number;
  };
}

export interface DocumentItem {
  id: string;
  filename: string;
  format: string;
  size_bytes: number;
  content_hash: string;
  added_at: string;
  indexing_status: string;
}

export interface ChunkPreviewItem {
  sequence: number;
  content: string;
  char_offset: number;
  char_length: number;
  color_hint: string;
}

export interface ChunkPreviewResponse {
  config_key: string;
  chunks: ChunkPreviewItem[];
  stats: {
    total_chunks_estimated: number;
    avg_token_count: number;
    min_token_count: number;
    max_token_count: number;
  };
}

export interface IndexAcceptedResponse {
  task_id: string;
  experiment_id: string;
  config_fingerprint: string;
  estimated_duration_seconds: number;
  websocket_topic: string;
  external_calls: string[];
}

export interface ChatChunk {
  chunk_id: string;
  document_id: string;
  page: number | null;
  content: string;
  score: number;
  rank: number;
}

export interface ChatResponse {
  turn_id: string;
  mode?: "retrieval_only";
  retrieval: { latency_ms: number; chunks: ChatChunk[] };
  answer: string | null;
  citations: unknown[] | null;
  external_calls: string[];
}

export interface ExperimentSummary {
  id: string;
  config_fingerprint: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  scores: {
    faithfulness: number | null;
    answer_relevance: number | null;
    context_precision: number | null;
    context_recall: number | null;
  };
}

export const api = {
  systemProfile: (): Promise<SystemProfileResponse> => request("/system/profile"),
  systemPresets: (): Promise<PresetResponse> => request("/system/presets"),

  listWorkspaces: (): Promise<{ items: WorkspaceSummary[]; next_cursor: null }> =>
    request("/workspaces"),
  getWorkspace: (id: string): Promise<WorkspaceSummary & { config: WorkspaceConfig }> =>
    request(`/workspaces/${id}`),
  createWorkspace: (
    name: string,
    preset_id?: string,
  ): Promise<WorkspaceSummary & { config: unknown }> =>
    request("/workspaces", { method: "POST", json: { name, preset_id } }),
  renameWorkspace: (
    id: string,
    name: string,
  ): Promise<WorkspaceSummary & { config: unknown }> =>
    request(`/workspaces/${id}`, { method: "PATCH", json: { name } }),
  deleteWorkspace: (id: string): Promise<void> =>
    request(`/workspaces/${id}`, { method: "DELETE" }),

  listDocuments: (workspaceId: string): Promise<{ items: DocumentItem[]; next_cursor: null }> =>
    request(`/workspaces/${workspaceId}/documents`),

  uploadDocuments: async (
    workspaceId: string,
    files: File[],
  ): Promise<{ uploaded: DocumentItem[]; skipped: unknown[]; failed: unknown[] }> => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    const resp = await fetch(`${BASE}/workspaces/${workspaceId}/documents`, {
      method: "POST",
      body: fd,
    });
    if (!resp.ok) {
      const body = await resp.json();
      throw new ApiException(resp.status, body.error);
    }
    return resp.json();
  },

  chunkingPreview: (
    workspaceId: string,
    payload: {
      document_id?: string;
      config: { strategy: string; chunk_size: number; chunk_overlap?: number };
      max_chunks?: number;
    },
  ): Promise<ChunkPreviewResponse> =>
    request(`/workspaces/${workspaceId}/chunking/preview`, {
      method: "POST",
      json: payload,
    }),

  startIndex: (
    workspaceId: string,
    payload: {
      config: {
        embedder_id: string;
        chunking: {
          strategy: string;
          chunk_size: number;
          chunk_overlap: number;
        };
        retrieval_strategy: string;
        top_k: number;
        llm_id: string | null;
      };
      document_ids?: string[] | null;
      force_reindex?: boolean;
    },
  ): Promise<IndexAcceptedResponse> =>
    request(`/workspaces/${workspaceId}/index`, { method: "POST", json: payload }),

  taskStatus: (taskId: string): Promise<{ status: string; kind: string }> =>
    request(`/tasks/${taskId}`),

  chat: (
    workspaceId: string,
    payload: { experiment_id: string; question: string; stream?: boolean },
  ): Promise<ChatResponse> =>
    request(`/workspaces/${workspaceId}/chat`, { method: "POST", json: payload }),

  listExperiments: (
    workspaceId: string,
  ): Promise<{ items: ExperimentSummary[]; next_cursor: null }> =>
    request(`/workspaces/${workspaceId}/experiments`),
};
