/**
 * City management (multi-user sprint): the list of cities with open, edit, pause, complete, archive and delete. Every
 * action goes to the backend, which owns the rules (status transitions, deletion); this screen shows its answers.
 * Creating a city is its own flow: components/cities/create/CreateCity.tsx.
 */
import { useState } from "react";
import { ApiError, cities as api } from "../../api/client";
import type { CitySummary } from "../../api/types";
import { dayMonth, plural } from "../../lib/format";
import { isOpenable, useSession } from "../../state/Session";
import { FeedbackMessage, StatusBadge } from "../Status";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

/* ======================================================================= city list */

export function CityManager() {
  const { cities, refreshCities, selectCity, city } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const visible = cities.filter((c) => showArchived || c.status !== "ARCHIVED");
  const archived = cities.filter((c) => c.status === "ARCHIVED").length;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      const xs = await refreshCities();
      if (city && !xs.some((c) => c.id === city.id && isOpenable(c))) selectCity(xs.find((c) => c.status === "ACTIVE")?.id ?? null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const open = (c: CitySummary) => {
    if (c.status === "DRAFT") location.hash = `#/cities/new/${c.id}`;
    else {
      selectCity(c.id);
      location.hash = "#/today";
    }
  };

  return (
    <div className="view"><div className="wrap">
      <div className="vhead">
        <div>
          <div className="kick">Your learning environments</div>
          <h2>Cities</h2>
          <div className="sub">Each city is its own curriculum, plan, progress and revision history.</div>
        </div>
        <button className="btn primary" onClick={() => (location.hash = "#/cities/new")}>New city</button>
      </div>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      {cities.length === 0 ? (
        <div className="card rest"><h3>No cities yet</h3><p>Create your first learning environment: describe the goal, your starting point and your time, then choose its curriculum.</p></div>
      ) : (
        <ul className="city-list">
          {visible.map((c) => (
            <li key={c.id} className={`card city-row${c.id === city?.id ? " current" : ""}`}>
              <div className="city-main">
                <div className="city-title">
                  <h3>{c.name}</h3>
                  <StatusBadge p={c.presentation} fallback={c.status.toLowerCase()} />
                  {c.id === city?.id && <span className="tag ink">Open now</span>}
                </div>
                {c.goal && <p className="city-goal">{c.goal}</p>}
                <p className="city-meta">{c.topics ? `${plural(c.topics, "topic")} · ` : ""}{c.category ? `${c.category} · ` : ""}updated {dayMonth(c.updatedAt.slice(0, 10))}</p>
              </div>
              <div className="city-acts">
                {c.status !== "ARCHIVED" && <button className="btn primary" onClick={() => open(c)}>{c.status === "DRAFT" ? "Continue setup" : "Open"}</button>}
                {c.status !== "ARCHIVED" && <button className="btn" aria-expanded={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}>Edit</button>}
                {c.status === "ACTIVE" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "pause"))}>Pause</button>}
                {c.status === "PAUSED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "resume"))}>Resume</button>}
                {(c.status === "ACTIVE" || c.status === "PAUSED") && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "complete"))}>Mark completed</button>}
                {c.status === "COMPLETED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "reopen"))}>Reopen</button>}
                {c.status !== "ARCHIVED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "archive"))}>Archive</button>}
                {c.status === "ARCHIVED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "restore"))}>Restore</button>}
                {(c.status === "ARCHIVED" || c.status === "DRAFT") && <button className="btn danger" aria-expanded={deleting === c.id} onClick={() => setDeleting(deleting === c.id ? null : c.id)}>Delete…</button>}
              </div>
              {editing === c.id && <EditCity c={c} onDone={() => { setEditing(null); void refreshCities(); }} />}
              {deleting === c.id && <DeleteCity c={c} onDone={() => { setDeleting(null); void act(c.id, async () => undefined); }} />}
            </li>
          ))}
        </ul>
      )}
      {archived > 0 && <p className="sub"><button className="link" onClick={() => setShowArchived((x) => !x)}>{showArchived ? "Hide archived cities" : `Show ${plural(archived, "archived city", "archived cities")}`}</button></p>}
    </div></div>
  );
}

function EditCity({ c, onDone }: { c: CitySummary; onDone: () => void }) {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const [goal, setGoal] = useState(c.goal);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.update(c.id, { name, description, goal });
      onDone();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <div className="form city-form">
      <label className="grow">Name<input className="inp" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label style={{ flexBasis: "100%" }}>Goal<input className="inp" value={goal} maxLength={500} onChange={(e) => setGoal(e.target.value)} /></label>
      <label style={{ flexBasis: "100%" }}>Description<textarea className="inp" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></label>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      <button className="btn primary" disabled={!name.trim()} onClick={() => void save()}>Save</button>
      <button className="btn" onClick={onDone}>Cancel</button>
    </div>
  );
}

function DeleteCity({ c, onDone }: { c: CitySummary; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.remove(c.id, typed);
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="form city-form">
      <FeedbackMessage tone="danger"><p>This permanently deletes <b>{c.name}</b> with its curriculum, tasks, progress and revision history. It cannot be undone. Export your data first if you want a copy (Account → Privacy).</p></FeedbackMessage>
      <label className="grow">Type the city's name to confirm<input className="inp" value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={!!typed && typed !== c.name} /></label>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      <button className="btn danger solid" aria-busy={busy} disabled={busy || typed !== c.name} onClick={() => void remove()}>Delete permanently</button>
      <button className="btn" onClick={onDone}>Cancel</button>
    </div>
  );
}
