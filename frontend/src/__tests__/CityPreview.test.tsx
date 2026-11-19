/** The city preview at the top of city creation: the real map engine, ghosts until written, a rise when written. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CityPreview, DISTRICT_COLOURS, type PreviewDistrict, fromDocument, previewDistricts } from "../components/cities/create/CityPreview";

const d = (name: string, state: PreviewDistrict["state"], topics = [3, 3, 3]): PreviewDistrict => ({ name, state, topics });
const svg = () => document.querySelector(".cc-hero-map")!;

describe("city preview", () => {
  it("invites the learner before there is anything to show", () => {
    render(<CityPreview districts={[]} />);
    expect(screen.getByText("Your city appears here")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("draws one platform per district and one building per topic with the engine, decorative only", () => {
    render(<CityPreview districts={[d("Grammar", "planned"), d("Speaking", "planned", [2, 4])]} caption="2 districts" />);
    expect(svg()).toHaveAttribute("aria-hidden", "true");
    expect(svg().querySelectorAll(".bld")).toHaveLength(5);
    expect(svg().querySelectorAll("polygon.road").length).toBeGreaterThan(0);
    expect(screen.getByText("2 districts")).toBeInTheDocument();
  });

  it("shows unwritten districts as grey ghosts, written ones in their colour", () => {
    const ds = previewDistricts([d("A", "ghost"), d("B", "planned", [5])]);
    expect(ds[0].color).toBe("#d3cec4");
    expect(ds[0].topics.every((t) => t.subtopics.length === 1)).toBe(true); // a ghost has no height yet
    expect(ds[1].color).toBe(DISTRICT_COLOURS[1]);
    expect(ds[1].topics[0].subtopics).toHaveLength(5);
    expect(ds[1].cols).toBe(2); // the backend's column rule for one topic
  });

  it("raises a district once, when it goes from ghost to written, and not on first view", () => {
    const { rerender } = render(<CityPreview districts={[d("Grammar", "planned"), d("Speaking", "ghost")]} />);
    expect(svg().querySelectorAll(".bld.fresh")).toHaveLength(0);
    rerender(<CityPreview districts={[d("Grammar", "planned"), d("Speaking", "planned")]} />);
    const fresh = [...svg().querySelectorAll(".bld.fresh")].map((b) => b.getAttribute("data-t"));
    expect(fresh.sort()).toEqual(["p1.t0", "p1.t1", "p1.t2"]); // only Speaking's buildings (drawn in depth order)
  });

  it("shows a proposed curriculum exactly: its districts, colours and building heights", () => {
    const doc = {
      title: "t", journey: { start: "2026-11-23", end: "2027-06-01", timezone: "Europe/Berlin" }, stages: [],
      districts: [{ key: "g", name: "Grammar", color: "#123456", topics: [{ key: "g1", name: "Cases", hours: 6, priority: "CORE" as const, subtopics: ["a", "b", "c", "d"], exercise: "", dependsOn: [] }] }],
    };
    expect(fromDocument(doc)).toEqual([{ name: "Grammar", state: "planned", color: "#123456", topics: [4] }]);
  });
});
