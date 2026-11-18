import type { Curriculum, Progress, Session, Stage, Task, TaskKind, TaskStatus, Today, Topic, Week } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the Engineering City server.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : "";
};

export interface TaskPatch {
  title?: string;
  notes?: string;
  estimatedMinutes?: number;
  scheduledDate?: string;
  status?: TaskStatus;
}

export interface NewTask {
  title: string;
  scheduledDate: string;
  estimatedMinutes: number;
  kind?: TaskKind;
  topicId?: string;
  subtopicId?: number;
  notes?: string;
}

export const api = {
  curriculum: () => request<Curriculum>("GET", "/curriculum"),
  progress: () => request<Progress>("GET", "/progress"),
  today: (date?: string) => request<Today>("GET", `/today${q({ date })}`),
  week: (date?: string) => request<Week>("GET", `/week${q({ date })}`),
  setSubtopic: (id: number, completed: boolean) =>
    request<{ id: number; completedAt: string | null }>("PATCH", `/subtopics/${id}`, { completed }),
  patchTopic: (id: string, body: { demonstrated?: boolean; demonstrationNote?: string; needsReview?: boolean }) =>
    request<Topic>("PATCH", `/topics/${encodeURIComponent(id)}`, body),
  createTask: (body: NewTask) => request<Task>("POST", "/tasks", body),
  patchTask: (id: number, body: TaskPatch) => request<Task>("PATCH", `/tasks/${id}`, body),
  deleteTask: (id: number) => request<void>("DELETE", `/tasks/${id}`),
  rescheduleOverdue: () => request<{ moved: { id: number; from: string; to: string }[] }>("POST", "/tasks/reschedule-overdue", {}),
  logTime: (body: { date: string; minutes: number; taskId?: number; topicId?: string; note?: string }) =>
    request<Session>("POST", "/sessions", body),
  deleteSession: (id: number) => request<void>("DELETE", `/sessions/${id}`),
  patchStage: (id: string, body: { startDate?: string; endDate?: string }) => request<Stage>("PATCH", `/stages/${id}`, body),
};
