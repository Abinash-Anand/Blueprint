/**
 * Google Calendar (docs/Google-Calendar-MVP-Plan.md): a page of its own (#/calendar), opened from the account menu
 * and Account settings. Connect once; your study blocks then appear in a separate "Blueprint" calendar, and moving a
 * block in Google moves it here. Nothing on this page waits on Google: it shows the server's last sync.
 */
import { useEffect, useState } from "react";
import { ApiError, calendarApi } from "../../api/client";
import type { CalendarStatus } from "../../api/types";
import { FeedbackMessage, LoadingState } from "../Status";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
const RETURNED: Record<string, { tone: "success" | "danger"; text: string }> = {
  connected: { tone: "success", text: "Connected. Your study blocks are being added to the Blueprint calendar in Google; it takes a minute." },
  denied: { tone: "danger", text: "Google Calendar wasn't connected: access wasn't allowed in Google." },
  state: { tone: "danger", text: "That answer from Google didn't match this page, so nothing was connected. Try again from here." },
  failed: { tone: "danger", text: "Google didn't finish connecting. Try again in a moment." },
  signin: { tone: "danger", text: "Sign in first, then connect Google Calendar." },
};

/** "2 minutes ago", "just now". */
function ago(iso: string | null) {
  if (!iso) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? "" : "s"} ago` : new Date(iso).toLocaleString();
}

export function CalendarPage() {
  const [st, setSt] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState("18:00");
  const [remove, setRemove] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "danger"; text: string } | null>(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
    return RETURNED[q.get("connected") ? "connected" : q.get("error") ?? ""] ?? null;
  });

  const load = () => calendarApi.status().then((s) => { setSt(s); setStart(s.startTime); setError(null); }, (e) => setError(errText(e)));
  useEffect(() => {
    void load();
    // Drop ?connected / ?error from the address, so a reload doesn't show the message again.
    if (location.hash.includes("?")) history.replaceState(null, "", "#/calendar");
    // While connected, the page follows the sync as it runs.
    const t = setInterval(() => void calendarApi.status().then(setSt, () => undefined), 15_000);
    return () => clearInterval(t);
  }, []);

  const act = async (f: () => Promise<CalendarStatus | void>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      const s = await f();
      if (s) setSt(s);
      else await load();
      if (done) setNote({ tone: "success", text: done });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view"><div className="wrap gc">
      <div className="vhead"><div>
        <div className="kick">Account</div>
        <h2>Google Calendar</h2>
        <div className="sub">Your study plan in your Google Calendar, kept up to date as the plan changes.</div>
      </div></div>
      {note && <FeedbackMessage tone={note.tone} onDismiss={() => setNote(null)}><p>{note.text}</p></FeedbackMessage>}
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      {!st ? (!error && <LoadingState text="Loading…" />) : !st.configured ? (
        <section className="section"><div className="card acc-card">
          <p className="gc-p">Google Calendar isn't set up on this server yet. Whoever runs Blueprint needs to add a Google OAuth client and a token key (see <code>docs/Google-Calendar-MVP-Plan.md</code>, section 5).</p>
        </div></section>
      ) : !st.connected ? (
        <section className="section"><div className="card acc-card">
          <ul className="gc-list">
            <li><b>One block per study day</b>, for the next two weeks, in a separate calendar called "Blueprint". Its description lists the day's tasks.</li>
            <li><b>Move a block in Google</b> to another time and Blueprint keeps it; to another day and that day's tasks move there.</li>
            <li><b>Only its own calendar.</b> Blueprint can't see or change your other events.</li>
          </ul>
          <a className="btn primary" href="/api/calendar/google/connect">Connect Google Calendar</a>
        </div></section>
      ) : (
        <>
          <section className="section"><h3>Sync</h3><div className="card acc-card gc-grid">
            {st.status === "ACTIVE" && <p className="gc-p"><b className="gc-ok">Syncing.</b> Last synced {ago(st.lastSyncedAt)} · {st.blocks} block{st.blocks === 1 ? "" : "s"} in Google. {st.instant ? "Changes in Google arrive straight away." : `Changes in Google arrive within ${st.pollMinutes} minutes, or when you press Sync now.`}</p>}
            {st.status === "PAUSED" && <p className="gc-p"><b className="gc-bad">Paused after repeated failures.</b> {st.lastError}</p>}
            {st.status === "RECONNECT" && <p className="gc-p"><b className="gc-bad">Google no longer accepts Blueprint's access.</b> Connect again to carry on.</p>}
            <div className="gc-actions">
              {st.status === "RECONNECT"
                ? <a className="btn primary" href="/api/calendar/google/connect">Connect again</a>
                : <button type="button" className="btn" disabled={busy} onClick={() => void act(calendarApi.syncNow, st.status === "PAUSED" ? "Sync started again." : "Syncing now.")}>{st.status === "PAUSED" ? "Retry" : "Sync now"}</button>}
            </div>
          </div></section>

          <section className="section"><h3>Study blocks</h3><div className="card acc-card">
            <label className="gc-field">
              <span>Blocks start at</span>
              <input className="inp" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
              <button type="button" className="btn" disabled={busy || start === st.startTime || !start} onClick={() => void act(() => calendarApi.setStart(start), "Saved. Blocks move to the new time on the next sync.")}>Save</button>
            </label>
            <p className="gc-foot">In each city's time zone. A block you moved to another time in Google keeps your time.</p>
          </div></section>

          <section className="section"><h3>Disconnect</h3><div className="card acc-card">
            <label className="gc-check"><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Also remove the Blueprint calendar from Google</label>
            <div className="gc-actions">
              <button type="button" className="btn danger" disabled={busy} onClick={() => void act(() => calendarApi.disconnect(remove), "Disconnected. Blueprint no longer has access to your Google account.")}>Disconnect</button>
            </div>
          </div></section>
        </>
      )}
    </div></div>
  );
}
