import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClassFinder from "@/components/ClassFinder";
import { sampleDatasets } from "../fixtures/sample-dataset";

/**
 * The app fetches one campus at a time, so the mock serves the payload for
 * whichever campus was asked for.
 */
function mockScheduleApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const campus = String(url).split("/").pop() ?? "UTM";
      return {
        ok: true,
        status: 200,
        json: async () => sampleDatasets[campus] ?? sampleDatasets.UTM,
      };
    }),
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
      expect(
        screen.getByRole("group", { name: /Courses matching your search/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("ISP100H5").length).toBeGreaterThan(0);
  });

  it("choosing a building does not turn its code into a course search", async () => {
    const user = await renderApp();

    await user.click(screen.getByRole("button", { name: "IB" }));

    expect(screen.getByPlaceholderText(/Search building/i)).toHaveValue("");
    expect(
      screen.queryByRole("group", { name: /Courses matching your search/i }),
    ).not.toBeInTheDocument();
    // The other buildings stay one click away.
    expect(screen.getByRole("button", { name: "MN" })).toBeInTheDocument();
  });

  it("never shows an invented room number", async () => {
    await renderApp();

    // A class row never carries a room number, because the timetable does
    // not publish one. The real classrooms appear only in the room list.
    expect(screen.queryByText(/Room: MN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MN 3220/)).not.toBeInTheDocument();

    // The classroom list shows the rooms the space database publishes.
    expect(screen.getByText("MN 2100")).toBeInTheDocument();
  });

  it("opens the section finder for a course, and the timetable from there", async () => {
    const user = await renderApp();

    await user.type(screen.getByPlaceholderText(/Search building/i), "isp100h5");
    const courseButton = await screen.findByRole("button", { name: /ISP100H5/ });
    await user.click(courseButton);

    // Picking a course opens the finder: every section of it.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Find another section/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/sections/i)[0]).toBeInTheDocument();

    // The course's own timetable is one click away.
    await user.click(
      screen.getByRole("button", { name: /the whole course's timetable/i }),
    );
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

  it("lets you switch term in the list view, not just the timetable", async () => {
    // Regression: the list view used to be silently scoped to the current term
    // with no way to change it, so a building looked like it had half the
    // classes it actually has.
    const user = await renderApp();

    const toggle = screen.getByRole("group", { name: "Term" });
    expect(toggle).toBeInTheDocument();

    // The sample dataset has 2 Fall meetings in MN and 1 Winter meeting.
    await waitFor(() =>
      expect(screen.getByText(/2 class meetings · Fall/)).toBeInTheDocument(),
    );

    await user.click(within(toggle).getByRole("button", { name: "Winter" }));

    await waitFor(() =>
      expect(screen.getByText(/1 class meetings · Winter/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/2 class meetings · Fall/)).not.toBeInTheDocument();
  });

  it("states which term the counts belong to", async () => {
    await renderApp();

    await waitFor(() =>
      expect(
        screen.getByText(/classrooms available on UTM · Fall 2026/),
      ).toBeInTheDocument(),
    );
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
