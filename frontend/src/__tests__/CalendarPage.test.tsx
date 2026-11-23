/** Google Calendar page (docs/Google-Calendar-MVP-Plan.md): off, ready to connect, connected, paused, disconnecting. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarStatus } from "../api/types";

const base: CalendarStatus = { configured: true, connected: true, status: "ACTIVE", startTime: "18:00", lastSyncedAt: new Date().toISOString(), lastError: null, instant: false, pollMinutes: 15, blocks: 12,
  reminderMinutes: 10, cities: [{ id: "a", name: "Angular City", start: "09:00" }, { id: "b", name: "German B2", start: null }] };
let current: CalendarStatus = base;
const status = vi.fn(async () => current);
const setStart = vi.fn(async (t: string) => (current = { ...current, startTime: t }));
const syncNow = vi.fn(async () => (current = { ...current, status: "ACTIVE", lastError: null }));
const setReminder = vi.fn(async (m: number) => (current = { ...current, reminderMinutes: m }));
const setCityOrder = vi.fn(async (ids: string[]) => (current = { ...current, cities: ids.map((id) => current.cities.find((c) => c.id === id)!) }));
const disconnect = vi.fn(async (_r: boolean) => { current = { ...current, connected: false, status: null }; });
vi.mock("../api/client", () => ({
  calendarApi: { status: () => status(), setStart: (t: string) => setStart(t), setReminder: (m: number) => setReminder(m), setCityOrder: (ids: string[]) => setCityOrder(ids), syncNow: () => syncNow(), disconnect: (r: boolean) => disconnect(r) },
  ApiError: class extends Error {},
}));

import { CalendarDisconnect, CalendarPage } from "../components/account/CalendarPage";

describe("Google Calendar page", () => {
  beforeEach(() => {
    current = base;
    location.hash = "#/calendar";
    for (const f of [status, setStart, setReminder, setCityOrder, syncNow, disconnect]) f.mockClear();
  });

  it("says when the server isn't set up, and offers to connect when it is", async () => {
    current = { ...base, configured: false, connected: false, status: null };
    const { unmount } = render(<CalendarPage />);
    expect(await screen.findByText(/isn't set up on this server yet/)).toBeTruthy();
    unmount();
    current = { ...base, connected: false, status: null };
    render(<CalendarPage />);
    expect((await screen.findByRole("link", { name: "Connect Google Calendar" })).getAttribute("href")).toBe("/api/calendar/google/connect");
    expect(screen.getByText(/Blueprint can't see or change your other events/)).toBeTruthy();
  });

  it("shows the result of connecting once, then the sync; changes the start time", async () => {
    location.hash = "#/calendar?connected=1";
    render(<CalendarPage />);
    expect(await screen.findByText(/Connected\. Your study blocks are being added/)).toBeTruthy();
    expect(location.hash).toBe("#/calendar");
    // The state is a word with an icon, then one line on what it means.
    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(screen.getByText(/12 blocks in Google · last synced just now/)).toBeTruthy();
    expect(screen.getByText(/within 15 minutes/)).toBeTruthy();
    // The field's name is only its label (the Save button sits outside it).
    fireEvent.change(screen.getByLabelText("Blocks start at", { exact: true }), { target: { value: "19:30" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setStart).toHaveBeenCalledWith("19:30"));
    expect(await screen.findByText(/Saved\. Blocks move to the new time/)).toBeTruthy();
  });

  it("offers Retry when paused, and Connect again when Google refused the access", async () => {
    current = { ...base, status: "PAUSED", lastError: "Google answered 500" };
    const { unmount } = render(<CalendarPage />);
    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(screen.getByText("Stopped after repeated failures. Google answered 500")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
    unmount();
    current = { ...base, status: "RECONNECT" };
    render(<CalendarPage />);
    expect((await screen.findByRole("link", { name: "Connect again" })).getAttribute("href")).toBe("/api/calendar/google/connect");
  });

  it("says before the first sync that the blocks are on their way", async () => {
    current = { ...base, lastSyncedAt: null, blocks: 0 };
    render(<CalendarPage />);
    expect(await screen.findByText("Adding your blocks")).toBeTruthy();
    expect(screen.queryByText(/not yet|0 blocks/)).toBeNull();
  });

  it("disconnects only from its own page, deleting the Blueprint calendar only when asked", async () => {
    render(<CalendarPage />);
    // One click on the main page never disconnects: it opens the confirming page.
    expect((await screen.findByRole("link", { name: "Disconnect…" })).getAttribute("href")).toBe("#/calendar/disconnect");
    expect(disconnect).not.toHaveBeenCalled();
    cleanup();
    render(<CalendarDisconnect />);
    expect(screen.getByRole("heading", { name: "Disconnect Google Calendar?" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Also delete the Blueprint calendar from Google/));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect and delete" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith(true));
    await waitFor(() => expect(location.hash).toBe("#/calendar?done=disconnected"));
  });

  it("changes the reminder and the order cities follow each other in", async () => {
    render(<CalendarPage />);
    fireEvent.change(await screen.findByLabelText("Remind me"), { target: { value: "30" } });
    await waitFor(() => expect(setReminder).toHaveBeenCalledWith(30));
    expect((screen.getByRole("button", { name: "Move Angular City up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move Angular City down" }));
    await waitFor(() => expect(setCityOrder).toHaveBeenCalledWith(["b", "a"]));
    await waitFor(() => expect(screen.getAllByRole("listitem").map((li) => li.querySelector("span")?.firstChild?.textContent?.trim())).toEqual(["German B2", "Angular City"]));
  });

  it("can be left without disconnecting", () => {
    render(<CalendarDisconnect />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(location.hash).toBe("#/calendar");
    expect(disconnect).not.toHaveBeenCalled();
  });
});
