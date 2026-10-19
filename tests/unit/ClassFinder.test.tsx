import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClassFinder from "@/components/ClassFinder";
import { sampleDataset } from "../fixtures/sample-dataset";

function mockScheduleApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => sampleDataset,
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Monday, 19 October 2026, 9:00 AM. In the sample data MN 2100 and IB 379
  // are booked at 09:00 while MN 3200 is free.
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0, 0));
  mockScheduleApi();
  window.location.hash = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderApp() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<ClassFinder />);
  await waitFor(() =>
    expect(screen.getByText(/UofT Class & Room Finder/i)).toBeInTheDocument(),
  );
  await waitFor(() => expect(screen.getByText("MN 2100")).toBeInTheDocument());
  return user;
}

describe("ClassFinder", () => {
  it("shows a loading state before the dataset arrives", async () => {
    render(<ClassFinder />);
    expect(screen.getByText(/Loading the UofT timetable/i)).toBeInTheDocument();
    // Let the pending fetch settle so React does not warn about an
    // unwrapped state update.
    await waitFor(() => expect(screen.getByText("MN 2100")).toBeInTheDocument());
  });

  it("renders the header with the campus tabs", async () => {
    await renderApp();

    expect(
      screen.getByRole("heading", { name: /UofT Class & Room Finder/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UTM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UTSG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UTSC" })).toBeInTheDocument();
  });

  it("lists the buildings of the selected campus", async () => {
    await renderApp();

    expect(screen.getByRole("button", { name: "MN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IB" })).toBeInTheDocument();
    // BA belongs to St. George, not UTM.
    expect(screen.queryByRole("button", { name: "BA" })).not.toBeInTheDocument();
  });

  it("shows real classrooms with their published availability", async () => {
    await renderApp();

    expect(screen.getByText("MN 2100")).toBeInTheDocument();
    expect(screen.getByText("MN 3200")).toBeInTheDocument();
    expect(screen.getByText("IB 379")).toBeInTheDocument();
  });

  it("marks a room that the space database lists as booked", async () => {
    await renderApp();

    const card = screen.getByText("MN 2100").closest("div");
    expect(card).not.toBeNull();
    const building = card!.parentElement!.parentElement!;
    expect(within(building).getByText("Occupied")).toBeInTheDocument();
  });

  it("filters to available classrooms with the empty-class toggle", async () => {
    const user = await renderApp();

    const toggle = screen.getByRole("checkbox");
    await user.click(toggle);

    await waitFor(() => expect(screen.queryByText("MN 2100")).not.toBeInTheDocument());
    expect(screen.getByText("MN 3200")).toBeInTheDocument();
  });

  it("finds a course by the code a student types", async () => {
    const user = await renderApp();

    await user.type(screen.getByPlaceholderText(/Search building/i), "isp100h5");

    await waitFor(() =>
      expect(screen.getByText("Matching courses")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("ISP100H5").length).toBeGreaterThan(0);
  });

  it("never shows an invented room number", async () => {
    await renderApp();

    // Every class row says the room is not published, and no room number is
    // invented next to a class.
    expect(screen.getAllByText("Room not published").length).toBeGreaterThan(0);
    expect(screen.queryByText(/MN 3220/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Room: MN/)).not.toBeInTheDocument();
  });

  it("opens the weekly timetable of a course", async () => {
    const user = await renderApp();

    await user.type(screen.getByPlaceholderText(/Search building/i), "isp100h5");
    const courseButton = await screen.findByRole("button", { name: /ISP100H5/ });
    await user.click(courseButton);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "ISP100H5" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Course Timetable across UTM/i)).toBeInTheDocument();
  });

  it("switches campus and shows that campus's classes", async () => {
    const user = await renderApp();

    await user.click(screen.getByRole("button", { name: "UTSG" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "BA" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Bahen Centre for Information Technology")).toBeInTheDocument();
  });

  it("reports a failed data load instead of showing an empty page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    render(<ClassFinder />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load the schedule/i)).toBeInTheDocument(),
    );
  });
});
