import type {
  Account, CityAttachment, CityProposal, CitySummary, ConsentState, CurriculumVersion, GenerationAvailability, NewCity, Template, Understanding,
  AiStatus, CheckpointResult, Curriculum, PlanChange, Progress, TimeChoice, TimePreview, YourTime, RecallHistoryRow, RecallHome, RecallMatrix, RecallReview, RetrievalMethod, RevisionArchive, Session, Stage, Task, TaskKind, TaskStatus, Today, Topic, Week,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

// Every request carries X-Blueprint: a page on another site cannot add it without a CORS preflight, which the API
// never allows, so the backend can tell its own pages from cross-site requests (AI design §8.2).
const BASE_HEADERS = { "X-Blueprint": "1" };

/** The city every learning request works in (X-City-Id); the backend checks that it belongs to the signed-in user. */
let currentCity: string | null = null;
export const setCurrentCity = (id: string | null) => {
  currentCity = id;
};
export const getCurrentCity = () => currentCity;

/** Fired when the session has ended (401): the app returns to the sign-in screen. */
export const SESSION_ENDED = "blueprint:session-ended";

async function request<T>(method: string, path: string, body?: unknown, raw?: { data: Blob; type: string }): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = { ...BASE_HEADERS, ...(currentCity ? { "X-City-Id": currentCity } : {}) };
  if (raw) headers["Content-Type"] = raw.type;
  else if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    res = await fetch(`/api${path}`, { method, headers, credentials: "same-origin", body: raw ? raw.data : body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the Blueprint server.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && e?.code === "AUTH_REQUIRED" && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_ENDED));
    throw new ApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `Request failed (${res.status})`, e?.details);
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
  /** false: unpin, so the plan may move it again. */
  pinned?: false;
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

export interface AttemptInput {
  topicId: string;
  subtopicId?: number;
  promptId?: number;
  templateKey?: string;
  retrievalMethod: RetrievalMethod;
  score: 0 | 1 | 2 | 3;
  usedHints: boolean;
  usedNotes: boolean;
  correctionCompleted: boolean;
  durationMinutes?: number;
  response?: string;
  mistakes?: string;
  comment?: string;
  evaluationId?: number;
  selfScore?: 0 | 1 | 2 | 3;
  inputMode?: "TYPED" | "SPOKEN";
}

export interface EvaluationInput {
  scheduleId: number;
  promptId?: number;
  templateKey?: string;
  transcript: string;
  parentId?: number;
}

export interface CheckpointInput {
  topicId: string;
  subtopicId: number;
  promptId?: number;
  templateKey?: string;
  result: CheckpointResult;
  neededAssistance: boolean;
  gaps?: string;
  response?: string;
}

export interface PromptInput {
  topicId: string;
  subtopicId?: number;
  title?: string;
  content: string;
  retrievalMethod: RetrievalMethod;
  expectedAnswer: string;
}

export const api = {
  curriculum: () => request<Curriculum>("GET", "/curriculum"),
  progress: () => request<Progress>("GET", "/progress"),
  today: (date?: string) => request<Today>("GET", `/today${q({ date })}`),
  week: (date?: string) => request<Week>("GET", `/week${q({ date })}`),
  setSubtopic: (id: number, completed: boolean) =>
    request<{ id: number; completedAt: string | null; recallDue: string | null; studyTasksDone?: number }>("PATCH", `/subtopics/${id}`, { completed }),
  patchTopic: (id: string, body: { demonstrated?: boolean; demonstrationNote?: string; needsReview?: boolean }) =>
    request<Topic>("PATCH", `/topics/${encodeURIComponent(id)}`, body),
  createTask: (body: NewTask) => request<Task>("POST", "/tasks", body),
  patchTask: (id: number, body: TaskPatch) => request<Task>("PATCH", `/tasks/${id}`, body),
  deleteTask: (id: number) => request<void>("DELETE", `/tasks/${id}`),
  planChanges: () => request<PlanChange[]>("GET", "/schedule/plan-changes"),
  yourTime: () => request<YourTime>("GET", "/schedule/availability"),
  previewTime: (c: TimeChoice) => request<TimePreview>("POST", "/schedule/preview", c),
  saveTime: (c: TimeChoice) => request<YourTime>("PUT", "/schedule/availability", c),
  rescheduleOverdue: () => request<{ moved: { id: number; from: string; to: string }[] }>("POST", "/tasks/reschedule-overdue", {}),
  logTime: (body: { date: string; minutes: number; taskId?: number; topicId?: string; note?: string }) =>
    request<Session>("POST", "/sessions", body),
  deleteSession: (id: number) => request<void>("DELETE", `/sessions/${id}`),
  patchStage: (id: string, body: { startDate?: string; endDate?: string }) => request<Stage>("PATCH", `/stages/${id}`, body),
  patchSettings: (body: { revisionDailyMinutes?: number; revisionWeeklyOvertimeMinutes?: number }) =>
    request<{ revisionDailyMinutes: number; revisionWeeklyOvertimeMinutes: number }>("PATCH", "/settings", body),
  aiStatus: () => request<AiStatus>("GET", "/ai/status"),
  aiConsent: () => request<{ consentedAt: string }>("POST", "/ai/consent", {}),
  /** The retired revision systems' history, read-only (docs/Recall-Plan.md §9). */
  revisionArchive: () => request<RevisionArchive>("GET", "/revision/archive"),

  /* Recall (docs/Recall-Plan.md): due lists, a review from the blank slate to the results. */
  recallHome: () => request<RecallHome>("GET", "/recall/home"),
  recallHistory: () => request<RecallHistoryRow[]>("GET", "/recall/history"),
  startRecall: (subtopicId: number) => request<RecallReview>("POST", "/recall/reviews", { subtopicId }),
  recallReview: (id: number) => request<RecallReview>("GET", `/recall/reviews/${id}`),
  saveRecallTyped: (id: number, typed: string) => request<RecallReview>("PATCH", `/recall/reviews/${id}`, { typed }),
  addRecallPart: (id: number, wav: Blob) => request<RecallReview>("POST", `/recall/reviews/${id}/parts`, undefined, { data: wav, type: "audio/wav" }),
  removeRecallPart: (id: number, index: number) => request<RecallReview>("DELETE", `/recall/reviews/${id}/parts/${index}`),
  submitRecall: (id: number) => request<RecallReview>("POST", `/recall/reviews/${id}/submit`),
  retryRecall: (id: number) => request<RecallReview>("POST", `/recall/reviews/${id}/retry`),
  completeRecall: (id: number) => request<RecallReview>("POST", `/recall/reviews/${id}/complete`),
  leaveOutPoint: (id: number, leftOut: boolean) => request<{ review: RecallReview | null }>("PATCH", `/recall/points/${id}`, { leftOut }),
  // Phase 2: the senior engineer's follow-up, a spoken answer's text, the grid; phase 3: sketches.
  probeRecall: (id: number) => request<RecallReview>("POST", `/recall/reviews/${id}/probe`),
  answerFollowup: (id: number, answer: string) => request<RecallReview>("POST", `/recall/reviews/${id}/followup`, { answer }),
  transcribeFollowup: (id: number, wav: Blob) => request<{ text: string; audioSeconds: number }>("POST", `/recall/reviews/${id}/transcriptions`, undefined, { data: wav, type: "audio/wav" }),
  addSketch: (id: number, image: Blob, type: string) => request<RecallReview>("POST", `/recall/reviews/${id}/sketches`, undefined, { data: image, type }),
  removeSketch: (id: number, index: number) => request<RecallReview>("DELETE", `/recall/reviews/${id}/sketches/${index}`),
  recallMatrix: (subtopicId: number) => request<RecallMatrix>("GET", `/recall/subtopics/${subtopicId}/matrix`),
  postponeRecall: (subtopicId: number) => request<{ subtopicId: number; nextDueDate: string }>("POST", `/recall/subtopics/${subtopicId}/postpone`),
};

/* ---------------- accounts, cities and curriculum versions (multi-user sprint) ---------------- */

export const auth = {
  me: () => request<{ user: Account }>("GET", "/auth/me"),
  register: (b: { name: string; email: string; password: string; passwordConfirm: string; acceptTerms: boolean; acknowledgePrivacy: boolean }) =>
    request<{ message: string }>("POST", "/auth/register", b),
  verifyEmail: (token: string) => request<{ message: string }>("POST", "/auth/verify-email", { token }),
  resendVerification: (email: string) => request<{ message: string }>("POST", "/auth/resend-verification", { email }),
  login: (b: { email: string; password: string; remember: boolean }) => request<{ user: Account }>("POST", "/auth/login", b),
  logout: () => request<void>("POST", "/auth/logout", {}),
  forgotPassword: (email: string) => request<{ message: string }>("POST", "/auth/forgot-password", { email }),
  resetPassword: (b: { token: string; password: string; passwordConfirm: string }) => request<{ message: string }>("POST", "/auth/reset-password", b),
};

export const account = {
  update: (b: Partial<Pick<Account, "name" | "timezone" | "language">> & { preferences?: Account["preferences"]; onboarded?: true }) =>
    request<{ user: Account }>("PATCH", "/account", b),
  changePassword: (b: { currentPassword: string; newPassword: string; newPasswordConfirm: string }) => request<{ message: string }>("POST", "/account/password", b),
  consents: () => request<ConsentState>("GET", "/account/consents"),
  setConsent: (purpose: "AI_PROCESSING" | "AI_CURRICULUM", granted: boolean) => request<ConsentState>("POST", "/account/consents", { purpose, granted }),
  /** The export as a file (download), never kept in memory longer than needed. */
  exportUrl: "/api/account/export",
  remove: (password: string) => request<void>("DELETE", "/account", { password, confirm: "DELETE" }),
};

export const cities = {
  list: () => request<CitySummary[]>("GET", "/cities"),
  get: (id: string) => request<CitySummary>("GET", `/cities/${encodeURIComponent(id)}`),
  create: (b: NewCity) => request<CitySummary>("POST", "/cities", b),
  update: (id: string, b: Partial<NewCity>) => request<CitySummary>("PATCH", `/cities/${encodeURIComponent(id)}`, b),
  status: (id: string, action: "pause" | "resume" | "complete" | "reopen" | "archive" | "restore") => request<CitySummary>("POST", `/cities/${encodeURIComponent(id)}/status`, { action }),
  remove: (id: string, confirmName: string) => request<void>("DELETE", `/cities/${encodeURIComponent(id)}`, { confirmName }),
  templates: () => request<Template[]>("GET", "/curriculum/templates"),
  versions: (id: string) => request<CurriculumVersion[]>("GET", `/cities/${encodeURIComponent(id)}/curriculum/versions`),
  version: (id: string, v: number) => request<CurriculumVersion>("GET", `/cities/${encodeURIComponent(id)}/curriculum/versions/${v}`),
  propose: (id: string, b: { source: "TEMPLATE"; template: "engineering"; start?: string } | { source: "IMPORT"; document: unknown; note?: string }) =>
    request<CityProposal>("POST", `/cities/${encodeURIComponent(id)}/curriculum/proposals`, b),
  generation: () => request<GenerationAvailability>("GET", "/curriculum/generation"),
  generate: (id: string) => request<{ version: number; status: "GENERATING" }>("POST", `/cities/${encodeURIComponent(id)}/curriculum/generate`, {}),
  approve: (id: string, v: number) => request<CitySummary>("POST", `/cities/${encodeURIComponent(id)}/curriculum/versions/${v}/approve`, {}),
  /* City creation intake (AI design §10.4) */
  attachments: (id: string) => request<CityAttachment[]>("GET", `/cities/${encodeURIComponent(id)}/attachments`),
  addAttachment: (id: string, file: Blob, name: string, type: string) =>
    request<CityAttachment>("POST", `/cities/${encodeURIComponent(id)}/attachments?name=${encodeURIComponent(name)}`, undefined, { data: file, type }),
  removeAttachment: (id: string, attachmentId: number) => request<void>("DELETE", `/cities/${encodeURIComponent(id)}/attachments/${attachmentId}`),
  dictate: (id: string, wav: Blob) => request<{ text: string; audioSeconds: number }>("POST", `/cities/${encodeURIComponent(id)}/dictation`, undefined, { data: wav, type: "audio/wav" }),
  understand: (id: string) => request<Understanding & { promptVersion: string; model: string; provider: string }>("POST", `/cities/${encodeURIComponent(id)}/understand`, {}),
  reject: (id: string, v: number) => request<void>("POST", `/cities/${encodeURIComponent(id)}/curriculum/versions/${v}/reject`, {}),
};
