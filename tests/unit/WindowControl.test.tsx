import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WindowControl from "@/components/WindowControl";
import { EMPTY_WINDOW, type TimeWindow } from "@/components/lib/window";

function renderControl(window: TimeWindow = EMPTY_WINDOW) {
  const onChange = vi.fn();
  render(<WindowControl window={window} onChange={onChange} />);
  return onChange;
}

describe("the window control", () => {
  it("offers every day of the week", () => {
    renderControl();
    for (const day of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      expect(screen.getByRole("button", { name: day })).toBeTruthy();
    }
  });

  it("picks a day", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await user.click(screen.getByRole("button", { name: "Tuesday" }));

    expect(onChange).toHaveBeenCalledWith({ days: [2], startMins: null, endMins: null });
  });

  it("unpicks a day that was picked", async () => {
    const user = userEvent.setup();
    const onChange = renderControl({ days: [2], startMins: null, endMins: null });

    await user.click(screen.getByRole("button", { name: "Tuesday" }));

    expect(onChange).toHaveBeenCalledWith({ days: [], startMins: null, endMins: null });
  });

  it("keeps the hours when a day is picked", async () => {
    const user = userEvent.setup();
    const onChange = renderControl({ days: [], startMins: 600, endMins: 720 });

    await user.click(screen.getByRole("button", { name: "Wednesday" }));

    expect(onChange).toHaveBeenCalledWith({ days: [3], startMins: 600, endMins: 720 });
  });

  it("reads the start time", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await user.type(screen.getByLabelText("From"), "10:00");

    expect(onChange).toHaveBeenCalledWith({ days: [], startMins: 600, endMins: null });
  });

  it("reads the end time", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await user.type(screen.getByLabelText("To"), "08:00");

    expect(onChange).toHaveBeenCalledWith({ days: [], startMins: null, endMins: 480 });
  });

  it("shows the hours it was given", () => {
    renderControl({ days: [2], startMins: 600, endMins: 720 });
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("12:00");
  });

  it("clears the whole window", async () => {
    const user = userEvent.setup();
    const onChange = renderControl({ days: [2], startMins: 600, endMins: 720 });

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenCalledWith(EMPTY_WINDOW);
  });
});
