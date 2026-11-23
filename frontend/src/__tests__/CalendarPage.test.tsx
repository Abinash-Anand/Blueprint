/** Google Calendar page (docs/Google-Calendar-MVP-Plan.md): off, ready to connect, connected, paused, disconnecting. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarStatus } from "../api/types";

const base: CalendarStatus = { configured: true, connected: true, status: "ACTIVE", startTime: "18:00", lastSyncedAt: new Date().toISOString(), lastError: null, instant: false, pollMinutes: 15, blocks: 12 };
let current: CalendarStatus = base;
const status = vi.fn(async () => current);
const setStart = vi.fn(async (t: string) => (current = { ...current, startTime: t }));
const syncNow = vi.fn(async () => (current = { ...current, status: "ACTIVE", lastError: null }));
const disconnect = vi.fn(async (_r: boolean) => { current = { ...current, connected: false, status: null }; });
vi.mock("../api/client", () => ({
  calendarApi: { status: () => status(), setStart: (t: string) => setStart(t), syncNow: () => syncNow(), disconnect: (r: boolean) => disconnect(r) },
  ApiError: class extends Error {},
}));

import { CalendarPage } from "../components/account/CalendarPage";

describe("Google Calendar page", () => {
  beforeEach(() => {
    current = base;
    location.hash = "#/calendar";
    for (const f of [status, setStart, syncNow, disconnect]) f.mockClear();
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
    expect(screen.getByText(/12 blocks in Google/)).toBeTruthy();
    expect(screen.getByText(/within 15 minutes/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Blocks start at"), { target: { value: "19:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setStart).toHaveBeenCalledWith("19:30"));
    expect(await screen.findByText(/Saved\. Blocks move to the new time/)).toBeTruthy();
  });

  it("offers Retry when paused, and Connect again when Google refused the access", async () => {
    current = { ...base, status: "PAUSED", lastError: "Google answered 500" };
    const { unmount } = render(<CalendarPage />);
    expect(await screen.findByText(/Paused after repeated failures/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
    unmount();
    current = { ...base, status: "RECONNECT" };
    render(<CalendarPage />);
    expect((await screen.findByRole("link", { name: "Connect again" })).getAttribute("href")).toBe("/api/calendar/google/connect");
  });

  it("disconnects, removing the Blueprint calendar only when asked", async () => {
    render(<CalendarPage />);
    fireEvent.click(await screen.findByLabelText(/Also remove the Blueprint calendar/));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith(true));
    expect(await screen.findByRole("link", { name: "Connect Google Calendar" })).toBeTruthy();
  });
});
