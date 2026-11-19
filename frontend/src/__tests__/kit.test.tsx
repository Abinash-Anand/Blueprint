/** The flow kit (components/kit.tsx): behaviour, keyboard use and what assistive technology is told. */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CheckRow, DayToggles, DisclosureRow, FlowHeader, Group, NumberStepper, Pill, Segmented, Sheet, Switch, SwitchRow } from "../components/kit";

function Controlled<T>({ initial, children }: { initial: T; children: (v: T, set: (v: T) => void) => React.ReactNode }) {
  const [v, set] = useState(initial);
  return <>{children(v, set)}</>;
}

describe("NumberStepper", () => {
  const mount = (initial = 1.5) =>
    render(<Controlled initial={initial}>{(v, set) => <NumberStepper label="Hours a day" value={v} min={0.5} max={6} step={0.5} unit="hours a day" onChange={set} />}</Controlled>);

  it("steps by its step within its limits, and disables the end it reached", () => {
    mount(5.5);
    const more = screen.getByRole("button", { name: "More (hours a day)" });
    fireEvent.click(more);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-valuenow", "6");
    expect(more).toBeDisabled();
    fireEvent.click(more);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-valuenow", "6");
    fireEvent.click(screen.getByRole("button", { name: "Less (hours a day)" }));
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-valuetext", "5.5 hours a day");
  });

  it("works with the keyboard like a native spin button, without floating-point drift", () => {
    mount(0.5);
    const sb = screen.getByRole("spinbutton");
    for (let i = 0; i < 3; i++) fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(sb).toHaveAttribute("aria-valuenow", "2");
    fireEvent.keyDown(sb, { key: "End" });
    expect(sb).toHaveAttribute("aria-valuenow", "6");
    fireEvent.keyDown(sb, { key: "PageDown" });
    expect(sb).toHaveAttribute("aria-valuenow", "4");
    fireEvent.keyDown(sb, { key: "Home" });
    expect(sb).toHaveAttribute("aria-valuenow", "0.5");
    expect(screen.getByRole("button", { name: "Less (hours a day)" })).toBeDisabled();
  });
});

describe("Segmented", () => {
  const options = [
    { value: "LIGHT", label: "Light", hint: "More revision and slack days" },
    { value: "STEADY", label: "Steady", hint: "A balance of new topics and revision" },
    { value: "INTENSIVE", label: "Intensive", hint: "Mostly new material, little slack" },
  ];
  const mount = () => render(<Controlled initial="STEADY">{(v, set) => <Segmented label="Pace" options={options} value={v} onChange={set} />}</Controlled>);

  it("is a radio group with one checked option and its hint as description", () => {
    mount();
    expect(screen.getByRole("radiogroup", { name: "Pace" })).toHaveAccessibleDescription("A balance of new topics and revision");
    expect(screen.getByRole("radio", { name: "Steady" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("More revision and slack days")).toBeInTheDocument();
  });

  it("has one tab stop, and arrow keys move and select, wrapping around", () => {
    mount();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(radios[1], { key: "ArrowRight" });
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2], { key: "ArrowRight" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[0], { key: "End" });
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
  });
});

describe("DayToggles", () => {
  it("toggles days by their full names and always keeps one on", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DayToggles value={[1, 3]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 5]);
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    expect(onChange).toHaveBeenLastCalledWith([3]);
    onChange.mockClear();
    rerender(<DayToggles value={[3]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Wednesday" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("grouped rows", () => {
  it("labels the group by its caption and each row says what it does", () => {
    const open = vi.fn(), toggle = vi.fn();
    render(
      <Group caption="Districts" footer="One district per subject.">
        <DisclosureRow label="Starting level" value="A2" onClick={open} />
        <CheckRow label="Grammar" checked onToggle={toggle} />
        <CheckRow label="Writing" checked={false} disabled onToggle={toggle} />
      </Group>,
    );
    expect(screen.getByRole("region", { name: "Districts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Starting level/ }));
    expect(open).toHaveBeenCalled();
    const grammar = screen.getByRole("checkbox", { name: "Grammar" });
    expect(grammar).toHaveAttribute("aria-checked", "true");
    fireEvent.click(grammar);
    expect(toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Writing" }));
    expect(toggle).toHaveBeenCalledTimes(1); // disabled rows do nothing
  });
});

describe("Switch", () => {
  it("is a switch named by its row, toggled by the row or the switch, once per press", () => {
    const onChange = vi.fn();
    render(<SwitchRow label="Send my answers to GWDG" description="GWDG doesn't store them." checked={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: /Send my answers to GWDG/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("GWDG doesn't store them."));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("can stand alone with its own label", () => {
    render(<Switch checked label="Reduced motion" onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "Reduced motion" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Pill and FlowHeader", () => {
  it("pills report whether they are the current choice", () => {
    render(<Pill pressed onClick={() => {}}>A language</Pill>);
    expect(screen.getByRole("button", { name: "A language" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the step count and offers Back only when there is somewhere to go", () => {
    const back = vi.fn();
    const { rerender } = render(<FlowHeader step={1} total={4} onCancel={() => {}} />);
    expect(screen.getByLabelText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "‹ Back" })).toBeNull(); // hidden from assistive technology on step 1
    rerender(<FlowHeader step={2} total={4} onBack={back} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "‹ Back" }));
    expect(back).toHaveBeenCalled();
  });
});

describe("Sheet", () => {
  function Host({ dismissible = true }: { dismissible?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Continue</button>
        <Sheet open={open} title="Allow Blueprint to use GWDG?" onClose={() => setOpen(false)} dismissible={dismissible}>
          <p>GWDG states it doesn't store what you send.</p>
          <button onClick={() => setOpen(false)}>Allow</button>
          <button onClick={() => setOpen(false)}>Not now</button>
        </Sheet>
      </>
    );
  }

  it("is a labelled modal dialog that takes focus and keeps Tab inside", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog", { name: "Allow Blueprint to use GWDG?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Allow" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Not now" }));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Allow" }));
  });

  it("closes with Escape or the backdrop and gives focus back", () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Continue" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(document.querySelector(".kit-sheet-back")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open when it must be answered", () => {
    render(<Host dismissible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector(".kit-sheet-back")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
