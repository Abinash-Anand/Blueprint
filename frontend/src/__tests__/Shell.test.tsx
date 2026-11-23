/** The app shell: the city and account lists, and the sidebar as the city's index (a drawer out of reach while closed). */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const selectCity = vi.fn();
vi.mock("../state/Session", () => ({
  useSession: () => ({
    city: { id: "c1", name: "Engineering City", goal: "Become a strong engineer.", template: "engineering", description: null },
    cities: [{ id: "c1", name: "Engineering City", status: "ACTIVE" }, { id: "c2", name: "German City", status: "PAUSED" }, { id: "c3", name: "Draft", status: "DRAFT" }],
    selectCity, user: { name: "Dev", email: "dev@example.test" }, signOut: vi.fn(),
  }),
}));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({
    curriculum: { districts: [{ id: "fe", position: 0, layer: 1, name: "Frontend", subtitle: "Angular", color: "#7f98a8", topics: [{ id: "fe.ts", name: "TypeScript", status: "DEMONSTRATED", priority: "CORE", subtopics: [{ completedAt: "x" }, { completedAt: null }] }] }] },
    progress: { road: { overall: 0.02, currentDistrictIndex: 0 }, districts: [{ id: "fe", subtopicsLearned: 1, subtopicsTotal: 2, passed: false }] },
  }),
}));
vi.mock("../App", () => ({ App: () => null }));

import { TopBar } from "../Root";
import { Sidebar } from "../components/Sidebar";

describe("top bar", () => {
  it("lists the cities to choose from, with actions apart, and switches only on a press", () => {
    render(<TopBar />);
    const button = screen.getByRole("button", { name: /City: Engineering City/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(button);
    const list = screen.getByRole("list", { name: "Your cities" });
    expect(list.textContent).toBe("Engineering CityGerman City (paused)");
    expect(screen.getByRole("button", { name: "Engineering City" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "New city" })).toHaveAttribute("href", "#/cities/new");
    // Opening moves focus into the list; Escape closes it and gives focus back.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Engineering City" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("list", { name: "Your cities" })).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "German City (paused)" }));
    expect(selectCity).toHaveBeenCalledWith("c2");
    expect(location.hash).toBe("#/today");
  });

  it("opens the account links as a plain list, not an ARIA menu", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("link", { name: "Account settings" })).toHaveFocus();
    expect(screen.getByText("dev@example.test")).toBeInTheDocument();
  });
});

describe("sidebar", () => {
  const props = { selectedId: null, onClose: () => {}, onOpenTopic: () => {}, onOpenDistrict: () => {} };

  it("is the city's index only: the road once and the districts, no Today card or second primary button", () => {
    const { container } = render(<Sidebar {...props} open={false} hidden={false} />);
    expect(screen.getByText(/of the road · 1 of 2 floors/)).toBeInTheDocument();
    expect(screen.getByText("Frontend", { exact: false })).toBeInTheDocument();
    expect(container.querySelector(".btn.primary")).toBeNull();
    expect(screen.queryByText(/Open today|Next up|PostgreSQL/)).toBeNull();
  });

  it("is out of reach while closed on a narrow screen", () => {
    const { container } = render(<Sidebar {...props} open={false} hidden />);
    expect(container.querySelector("aside")).toHaveAttribute("inert");
  });
});
