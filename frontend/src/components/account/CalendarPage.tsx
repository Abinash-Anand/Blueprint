/**
 * Google Calendar (docs/Google-Calendar-MVP-Plan.md), in glass (DESIGN.md §10): a page of its own (#/calendar), opened
 * from the account menu and Account settings. Connect once; your study blocks then appear in a separate "Blueprint"
 * calendar, and moving a block in Google moves it here. Nothing on this page waits on Google: it shows the server's
 * last sync. Disconnecting is a page of its own (#/calendar/disconnect), because it can't be undone in one step.
 */
import { useEffect, useState } from "react";
import { ApiError, calendarApi } from "../../api/client";
import type { CalendarStatus } from "../../api/types";
import { FeedbackMessage, LoadingState, StatusBadge } from "../Status";
import { Back } from "../recall/icons";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
const RETURNED: Record<string, { tone: "success" | "danger"; text: string }> = {
  connected: { tone: "success", text: "Connected. Your study blocks are being added to the Blueprint calendar in Google; it takes a minute." },
  denied: { tone: "danger", text: "Google Calendar wasn't connected: access wasn't allowed in Google." },
  state: { tone: "danger", text: "That answer from Google didn't match this page, so nothing was connected. Try again from here." },
  failed: { tone: "danger", text: "Google didn't finish connecting. Try again in a moment." },
  signin: { tone: "danger", text: "Sign in first, then connect Google Calendar." },
  disconnected: { tone: "success", text: "Disconnected. Blueprint no longer has access to your Google account." },
};

/** "2 minutes ago", "just now". */
function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? "" : "s"} ago` : new Date(iso).toLocaleString();
}

/** The sync's state as a word with an icon (never colour alone), and one line on what it means. */
function syncState(st: CalendarStatus) {
  if (st.status === "PAUSED") return { badge: { tone: "warning" as const, icon: "alert-triangle", label: "Paused" }, line: `Stopped after repeated failures. ${st.lastError ?? ""}`.trim() };
  if (st.status === "RECONNECT") return { badge: { tone: "danger" as const, icon: "alert-circle", label: "Needs connecting again" }, line: "Google no longer accepts Blueprint's access." };
  if (!st.lastSyncedAt) return { badge: { tone: "info" as const, icon: "clock", label: "Adding your blocks" }, line: "Your study blocks are on their way to Google." };
  return {
    badge: { tone: "success" as const, icon: "check-circle", label: "Up to date" },
    line: `${st.blocks} block${st.blocks === 1 ? "" : "s"} in Google · last synced ${ago(st.lastSyncedAt)}. ${st.instant ? "Changes you make in Google arrive straight away." : `Changes you make in Google arrive within ${st.pollMinutes} minutes.`}`,
  };
}

function Shell({ title, sub, back, children }: { title: string; sub?: string; back?: () => void; children: React.ReactNode }) {
  return (
    <div className="view gl gl-bg">
      <div className="wrap tp">
        {back && <button type="button" className="g-link rh-back" onClick={back} aria-label="Back to Google Calendar"><Back />Google Calendar</button>}
        <section className="g-card tp-card gc" aria-labelledby="gc-title">
          <div className="kick">Account</div>
          <h2 id="gc-title" className="g-t2 tp-title">{title}</h2>
          {sub && <p className="g-sub">{sub}</p>}
          {children}
        </section>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const [st, setSt] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState("18:00");
  const [note, setNote] = useState<{ tone: "success" | "danger"; text: string } | null>(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
    return RETURNED[q.get("connected") ? "connected" : q.get("done") ?? q.get("error") ?? ""] ?? null;
  });

  const load = () => calendarApi.status().then((s) => { setSt(s); setStart(s.startTime); setError(null); }, (e) => setError(errText(e)));
  useEffect(() => {
    void load();
    // Drop ?connected / ?error from the address, so a reload doesn't show the message again.
    if (location.hash.includes("?")) history.replaceState(null, "", "#/calendar");
  }, []);
  // While connected, the page follows the sync as it runs; otherwise there is nothing to follow.
  const following = !!st?.connected;
  useEffect(() => {
    if (!following) return;
    const t = setInterval(() => void calendarApi.status().then(setSt, () => undefined), 15_000);
    return () => clearInterval(t);
  }, [following]);

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

  const state = st?.connected ? syncState(st) : null;
  return (
    <Shell title="Google Calendar" sub="Your study plan in your Google Calendar, kept up to date as the plan changes.">
      {note && <FeedbackMessage tone={note.tone} onDismiss={() => setNote(null)}><p>{note.text}</p></FeedbackMessage>}
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      {!st ? (!error && <LoadingState text="Loading…" />) : !st.configured ? (
        <div className="gc-sec">
          <p className="gc-p">Google Calendar isn't set up on this server yet. To turn it on, add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>CALENDAR_TOKEN_KEY</code> to the <code>.env</code> file, then restart Blueprint.</p>
          <p className="g-foot">The steps are in <code>docs/Google-Calendar-MVP-Plan.md</code>, section 5.</p>
        </div>
      ) : !st.connected ? (
        <div className="gc-sec">
          <ul className="gc-list">
            <li><b>One block per study day</b> for the next two weeks, in a separate calendar called "Blueprint". Each block lists the day's tasks.</li>
            <li><b>Move a block in Google</b> to another time and Blueprint keeps it; move it to another day and that day's tasks move with it.</li>
            <li><b>Only its own calendar.</b> Blueprint can't see or change your other events.</li>
          </ul>
          <div className="tp-acts">
            <a className="btn primary big" href="/api/calendar/google/connect">Connect Google Calendar</a>
          </div>
        </div>
      ) : (
        <>
          <div className="gc-sec">
            <h3 className="p-h">Sync</h3>
            <p className="gc-state"><StatusBadge p={{ state: "calendar.sync", variant: "soft", ...state!.badge }} /></p>
            <p className="gc-p">{state!.line}</p>
            <div className="tp-acts">
              {st.status === "RECONNECT"
                ? <a className="btn primary big" href="/api/calendar/google/connect">Connect again</a>
                : <button type="button" className="btn" disabled={busy} onClick={() => void act(calendarApi.syncNow, st.status === "PAUSED" ? "Sync started again." : "Syncing now.")}>{st.status === "PAUSED" ? "Retry" : "Sync now"}</button>}
            </div>
          </div>

          <div className="gc-sec">
            <h3 className="p-h">Study blocks</h3>
            <form className="tp-form" onSubmit={(e) => { e.preventDefault(); if (start && start !== st.startTime) void act(() => calendarApi.setStart(start), "Saved. Blocks move to the new time on the next sync."); }}>
              <label>
                Blocks start at
                <input className="inp" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <button type="submit" className="btn" disabled={busy || start === st.startTime || !start}>Save</button>
            </form>
            <p className="g-foot">In each city's time zone. A block you moved to another time in Google keeps your time.</p>
          </div>

          <div className="gc-sec gc-end">
            <a className="btn danger" href="#/calendar/disconnect">Disconnect…</a>
          </div>
        </>
      )}
    </Shell>
  );
}

/** Disconnecting, a page of its own: what it does, whether to remove the Blueprint calendar, and one confirming button. */
export function CalendarDisconnect() {
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => { location.hash = "#/calendar"; };
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await calendarApi.disconnect(remove);
      location.hash = "#/calendar?done=disconnected";
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Shell title="Disconnect Google Calendar?" sub="Blueprint stops updating your study blocks in Google and gives up its access to your Google account." back={back}>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      <label className="tp-check">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
        <span>
          Also delete the Blueprint calendar from Google
          <small>Its study blocks disappear from Google too. This can't be undone; connecting again makes a new calendar.</small>
        </span>
      </label>
      <div className="tp-acts">
        <button type="button" className="btn danger solid big" disabled={busy} aria-busy={busy} onClick={() => void go()}>{busy ? "Disconnecting…" : remove ? "Disconnect and delete" : "Disconnect"}</button>
        <button type="button" className="btn big" onClick={back}>Cancel</button>
      </div>
    </Shell>
  );
}
