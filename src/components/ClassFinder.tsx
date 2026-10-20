"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WeeklySchedule from "./WeeklySchedule";
import SectionFinder from "./SectionFinder";
import { EMPTY_WINDOW, type TimeWindow } from "./lib/window";
import {
  buildingSummaries,
  classesInProgress,
  filterByTerm,
  findCourseMeetings,
  format12Hour,
  formatHourRange,
  getLiveTimeContext,
  layoutLanes,
  nextClassInBuilding,
  normalizeCode,
  publishedHours,
  roomStatusAt,
  searchCourseCodes,
  sortRoomsByNextFree,
  timeToMinutes,
} from "./lib/schedule";
import type {
  CampusPayload,
  ClassMeeting,
  Dataset,
  Room,
  ScheduleBlock,
  Term,
} from "./lib/types";

type Route =
  | { mode: "list" }
  | { mode: "room"; campus: string; id: string }
  | { mode: "course"; campus: string; id: string }
  | { mode: "building"; campus: string; id: string }
  | { mode: "sections"; campus: string; id: string }
  | {
      mode: "section";
      campus: string;
      id: string;
      session: string;
      section: string;
    };

const CAMPUSES = ["UTM", "UTSG", "UTSC"] as const;

/** The campus names, as the University writes them. */
const CAMPUS_NAMES: Record<string, string> = {
  UTM: "Mississauga",
  UTSG: "St. George",
  UTSC: "Scarborough",
  SHERIDAN: "Sheridan College",
};

/** How many building chips to show before the rest move into a dropdown. */
const MAX_BUILDING_CHIPS = 8;

/** Deterministic stand-in for the clock during prerender. */
const PLACEHOLDER_TIME = new Date(0);

function parseHash(hash: string): Route {
  if (!hash || !hash.startsWith("#/")) return { mode: "list" };
  const parts = hash.slice(2).split("/");
  const mode = parts[0];
  const campus = decodeURIComponent(parts[1] || "UTM");
  const id = decodeURIComponent(parts.slice(2).join("/") || "");
  if ((mode === "room" || mode === "course" || mode === "building") && id) {
    return { mode, campus, id } as Route;
  }
  if (mode === "sections" && id) {
    return { mode, campus, id };
  }
  // A section is named by its session as well as its number: the same
  // section name is a Fall section and a Winter section.
  if (mode === "section" && parts.length >= 5) {
    return {
      mode,
      campus,
      id: decodeURIComponent(parts[2]),
      session: decodeURIComponent(parts[3]),
      section: decodeURIComponent(parts.slice(4).join("/")),
    };
  }
  return { mode: "list" };
}

export default function ClassFinder() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingCampus, setLoadingCampus] = useState(false);
  // The clock is read in an effect rather than during render: Next.js
  // prerenders this route and treats `new Date()` in render as an unstable
  // value that would freeze on the server.
  const [now, setNow] = useState<Date | null>(null);

  const [campus, setCampus] = useState<string>("UTM");
  const [building, setBuilding] = useState<string>("ALL");
  const [query, setQuery] = useState<string>("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [viewTerm, setViewTerm] = useState<Term | null>(null);
  const [route, setRoute] = useState<Route>({ mode: "list" });
  // The times the student says they can do something in. One window, shared
  // by the section finder and the classroom list.
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(EMPTY_WINDOW);

  // A fixed instant stands in for the clock during prerender, so the rendered
  // markup is deterministic. The real clock arrives in the effect above.
  const ctx = useMemo(() => getLiveTimeContext(now ?? PLACEHOLDER_TIME), [now]);
  const activeTerm = viewTerm ?? ctx.term;

  // A deep link names its campus, so that is the campus whose data has to be
  // on screen. The tab follows the link rather than the other way round.
  const activeCampus = route.mode === "list" ? campus : route.campus;

  // ------------------------------------------------------------------ data

  // The dataset is stored one file per campus and only the campus on screen
  // is fetched - the whole catalogue is 8.3 MB and the default campus is a
  // fifth of that. A campus that has been visited is kept in memory, so
  // moving back and forth between tabs costs nothing.
  const cache = useRef(new Map<string, Dataset>());

  useEffect(() => {
    let cancelled = false;
    const cached = cache.current.get(activeCampus);
    if (cached) {
      setData(cached);
      setLoadingCampus(false);
      setLoadError(null);
      return;
    }

    setLoadingCampus(true);
    fetch(`/api/schedule/${encodeURIComponent(activeCampus)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<CampusPayload>;
      })
      .then((payload: CampusPayload) => {
        if (cancelled) return;
        const dataset: Dataset = {
          campus: payload.campus,
          classes: payload.classes,
          rooms: payload.rooms,
          classrooms: payload.classrooms ?? [],
          availability: payload.availability ?? null,
          meta: payload.meta,
        };
        cache.current.set(activeCampus, dataset);
        setData(dataset);
        setLoadingCampus(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadingCampus(false);
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeCampus]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // --------------------------------------------------------------- routing

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  const goHome = useCallback(() => {
    setViewTerm(null);
    if (window.location.hash) {
      window.history.pushState(null, "", window.location.pathname);
    }
    setRoute({ mode: "list" });
  }, []);

  // ------------------------------------------------------------- derived

  // The payload is already scoped to one campus, so there is nothing left to
  // filter: every meeting in it belongs to the campus on screen.
  const campusClasses = useMemo(
    () => (data && data.campus === activeCampus ? data.classes : []),
    [data, activeCampus],
  );

  const termClasses = useMemo(
    () => filterByTerm(campusClasses, activeTerm),
    [campusClasses, activeTerm],
  );

  const campusRooms = useMemo(() => {
    if (!data || data.campus !== activeCampus) return [] as Room[];
    return data.rooms;
  }, [data, activeCampus]);

  const campusHasRooms = campusRooms.length > 0;

  const buildings = useMemo(() => buildingSummaries(termClasses), [termClasses]);

  const visibleBuildings = useMemo(() => {
    const wanted = normalizeCode(query);
    if (building !== "ALL") {
      return buildings.filter((b) => b.code === building);
    }
    if (!wanted) return buildings;
    return buildings.filter(
      (b) =>
        normalizeCode(b.code).includes(wanted) ||
        normalizeCode(b.name).includes(wanted),
    );
  }, [buildings, building, query]);

  const courseMatches = useMemo(
    () => (query ? searchCourseCodes(campusClasses, query, 12) : []),
    [campusClasses, query],
  );

  // St. George has 68 buildings and Scarborough 13. Showing every one as a
  // chip wrapped the header onto three rows, so the busiest few get a chip
  // and the rest live behind a dropdown - the pattern the original static UI
  // used.
  // The buildings with the most classes first: the busiest buildings are the
  // ones a student is most likely to be looking for.
  const rankedBuildings = useMemo(
    () => [...visibleBuildings].sort((a, b) => b.meetingCount - a.meetingCount),
    [visibleBuildings],
  );
  const chipBuildings = rankedBuildings.slice(0, MAX_BUILDING_CHIPS);
  const overflowBuildings = rankedBuildings.slice(MAX_BUILDING_CHIPS);

  const classesForBuilding = useCallback(
    (code: string) => {
      const wanted = normalizeCode(query);
      const inBuilding = termClasses.filter((c) => c.buildingCode === code);
      if (!wanted) return inBuilding;
      return inBuilding.filter(
        (c) =>
          normalizeCode(c.courseCode).includes(wanted) ||
          normalizeCode(c.sectionName).includes(wanted) ||
          normalizeCode(c.courseTitle).includes(wanted) ||
          c.instructors.some((name) => normalizeCode(name).includes(wanted)),
      );
    },
    [termClasses, query],
  );

  const stats = useMemo(() => {
    const totalRooms = campusRooms.length;
    let freeRooms = 0;
    let unknownRooms = 0;
    for (const room of campusRooms) {
      const state = roomStatusAt(room, ctx).state;
      if (state === "free") freeRooms += 1;
      else if (state === "unknown") unknownRooms += 1;
    }
    return { totalRooms, freeRooms, unknownRooms };
  }, [campusRooms, ctx]);

  // ------------------------------------------------------------- handlers

  const selectCampus = (next: string) => {
    setCampus(next);
    setBuilding("ALL");
    setQuery("");
    setViewTerm(null);
    setTimeWindow(EMPTY_WINDOW);
    goHome();
  };

  const selectBuilding = (code: string) => {
    setBuilding(code);
    setQuery(code === "ALL" ? "" : code);
    setViewTerm(null);
    goHome();
  };

  const clearSearch = () => {
    setQuery("");
    setBuilding("ALL");
    goHome();
  };

  // --------------------------------------------------------------- render

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="bg-slate-900/60 border border-rose-500/40 rounded-2xl p-8">
          <h2 className="text-lg font-bold text-rose-300">Could not load the schedule</h2>
          <p className="text-xs text-slate-400 mt-2">{loadError}</p>
          <p className="text-xs text-slate-400 mt-4">
            Run <code className="text-slate-300">npm run data:build</code> to regenerate
            the dataset, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex items-center gap-2.5 text-xs font-semibold text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Loading the UofT timetable…
        </div>
      </div>
    );
  }

  const meta = data.meta;

  return (
    <div className="min-h-screen flex flex-col antialiased">
      <header className="uoft-header border-b border-blue-800/60 sticky top-0 z-40 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={() => selectCampus(activeCampus)}
            className="flex items-center gap-3 cursor-pointer text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white text-lg font-bold shadow-inner">
              <i className="fa-solid me-0.5 fa-graduation-cap" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                UofT Class &amp; Room Finder
              </h1>
              <p className="text-xs text-blue-200 font-medium">
                Classroom Availability &amp; Course Schedules
              </p>
            </div>
          </button>

          <div className="inline-flex rounded-xl bg-slate-950/70 p-1 border border-white/15 self-start sm:self-auto shadow-inner">
            {CAMPUSES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => selectCampus(key)}
                className={`px-4 py-1.5 rounded-lg text-xs transition-all ${
                  activeCampus === key
                    ? "font-bold bg-blue-600 text-white shadow"
                    : "font-semibold text-slate-300 hover:text-white"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="bg-slate-900/95 border-b border-slate-800 sticky top-[65px] z-30 backdrop-blur shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="pb-1 lg:pb-0 flex-1 min-w-0">
              <div className="flex flex-wrap items-center rounded-xl bg-slate-950/80 p-1 border border-slate-800 gap-1">
                <button
                  type="button"
                  onClick={() => selectBuilding("ALL")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    building === "ALL"
                      ? "font-bold bg-blue-600 text-white shadow shrink-0"
                      : "text-slate-300 hover:text-white bg-slate-800/60 shrink-0"
                  }`}
                >
                  All Buildings
                </button>
                {chipBuildings.map((b) => (
                  <button
                    key={b.code}
                    type="button"
                    title={`${b.name} — ${b.meetingCount} class meetings`}
                    onClick={() => selectBuilding(b.code)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      building === b.code
                        ? "font-bold bg-blue-600 text-white shadow shrink-0"
                        : "text-slate-300 hover:text-white bg-slate-800/60 shrink-0"
                    }`}
                  >
                    {b.code}
                  </button>
                ))}
                {overflowBuildings.length ? (
                  <select
                    value={overflowBuildings.some((b) => b.code === building) ? building : ""}
                    onChange={(event) => {
                      if (event.target.value) selectBuilding(event.target.value);
                    }}
                    aria-label="More buildings"
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:border-blue-500 shrink-0 max-w-[13rem]"
                  >
                    <option value="">
                      More buildings ({overflowBuildings.length})…
                    </option>
                    {overflowBuildings.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.code} — {b.name} ({b.meetingCount})
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            <div className="text-xs font-semibold text-slate-300 shrink-0 flex items-center gap-3 flex-wrap justify-end">
              <div
                className="inline-flex rounded-lg bg-slate-950/80 p-0.5 border border-slate-800"
                role="group"
                aria-label="Term"
              >
                {(["F", "S"] as Term[]).map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => setViewTerm(term)}
                    aria-pressed={activeTerm === term}
                    className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${
                      activeTerm === term
                        ? "font-bold bg-blue-600 text-white shadow"
                        : "font-medium text-slate-400 hover:text-white"
                    }`}
                  >
                    {term === "F" ? "Fall" : "Winter"}
                  </button>
                ))}
              </div>
              <span className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    loadingCampus ? "bg-blue-400 animate-pulse" : "bg-emerald-400 animate-pulse"
                  }`}
                />
                <span>
                  {loadingCampus
                    ? `Loading ${activeCampus}…`
                    : campusHasRooms
                      ? stats.unknownRooms === stats.totalRooms
                        ? `${stats.totalRooms} classrooms on ${activeCampus}`
                        : `${stats.freeRooms} of ${stats.totalRooms} classrooms available on ${activeCampus}`
                      : `${termClasses.length} class meetings scheduled on ${activeCampus}`}
                  {" · "}
                  {activeTerm === "F" ? "Fall 2026" : "Winter 2027"}
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <form
              onSubmit={(event) => {
                event.preventDefault();
              }}
              className="flex gap-2 flex-1 max-w-xl"
            >
              <div className="relative flex-1">
                <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={
                    campusHasRooms
                      ? `Search building (e.g. ${activeCampus === "UTM" ? "MN, IB" : "BA, SS"}), classroom (e.g. MN 2100), or course code...`
                      : `Search building (e.g. BA, SS) or course code...`
                  }
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-9 pr-16 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition shadow-inner"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-700/70 hover:bg-slate-700 transition"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </form>

            <label
              className={`inline-flex items-center gap-2.5 text-xs font-semibold text-slate-200 px-3.5 py-2 rounded-xl border ${
                campusHasRooms
                  ? "bg-slate-800/70 border-slate-700/80 cursor-pointer select-none hover:bg-slate-800 transition shadow-sm"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 cursor-not-allowed"
              }`}
              title={
                campusHasRooms
                  ? "Only show rooms that are listed as available right now"
                  : "Room-level availability is published for UTM only"
              }
            >
              <input
                type="checkbox"
                checked={onlyFree && campusHasRooms}
                disabled={!campusHasRooms}
                onChange={(event) => setOnlyFree(event.target.checked)}
                className="w-4 h-4 rounded border-slate-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 bg-slate-900"
              />
              <span className="flex items-center gap-1.5">
                <i className="fa-solid fa-door-open text-emerald-400 text-xs" />
                Only show empty classes right now
              </span>
            </label>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1">
        {loadingCampus ? (
          <div className="text-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
            <p className="text-slate-300 font-bold text-base mt-3">
              Loading the {activeCampus} timetable…
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Each campus is fetched on its own, so the page only downloads what
              it is about to show.
            </p>
          </div>
        ) : route.mode === "sections" ? (
          <SectionFinder
            campus={activeCampus}
            courseCode={route.id}
            classes={termClasses}
            window={timeWindow}
            onWindowChange={setTimeWindow}
            onOpenSection={(code, session, section) =>
              navigate(
                `#/section/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}/${encodeURIComponent(session)}/${encodeURIComponent(section)}`,
              )
            }
            onOpenCourse={(code) =>
              navigate(`#/course/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
          />
        ) : route.mode === "list" ? (
          <ListView
            data={data}
            ctx={ctx}
            activeTerm={activeTerm}
            buildings={rankedBuildings}
            campusRooms={campusRooms}
            classesForBuilding={classesForBuilding}
            courseMatches={courseMatches}
            onlyFree={onlyFree && campusHasRooms}
            onFindSections={(code) =>
              navigate(`#/sections/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
            onOpenCourse={(code) =>
              navigate(`#/course/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
            onOpenBuilding={(code) =>
              navigate(`#/building/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
            onOpenRoom={(room) =>
              navigate(`#/room/${encodeURIComponent(activeCampus)}/${encodeURIComponent(room)}`)
            }
          />
        ) : (
          <ScheduleView
            data={data}
            ctx={ctx}
            route={route}
            activeTerm={activeTerm}
            onTermChange={(term) => setViewTerm(term)}
            onBack={goHome}
            onOpenCourse={(code) =>
              navigate(`#/course/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
            onOpenBuilding={(code) =>
              navigate(`#/building/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
          />
        )}
      </main>

      <footer className="border-t border-slate-800/80 py-5 text-center text-xs text-slate-400 bg-slate-950/40">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            {meta.courseRowsFetched.toLocaleString()} course records from the UofT
            timetable API • {meta.classMeetings.toLocaleString()} class meetings
          </p>
          <p>
            Fall {activeTerm === "F" ? "&" : ""} Winter 2026-27 •{" "}
            {data.availability ? (
              <>
                Classroom availability from {data.availability.source}, week of{" "}
                {new Date(
                  `${data.availability.weekStart}T12:00:00`,
                ).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </>
            ) : (
              "No classroom occupancy is published for this campus"
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- list view

interface ListViewProps {
  data: Dataset;
  ctx: ReturnType<typeof getLiveTimeContext>;
  activeTerm: Term;
  buildings: ReturnType<typeof buildingSummaries>;
  campusRooms: Room[];
  classesForBuilding: (code: string) => ClassMeeting[];
  courseMatches: string[];
  /** Open the section finder for a course. */
  onFindSections: (code: string) => void;
  onlyFree: boolean;
  onOpenCourse: (code: string) => void;
  onOpenBuilding: (code: string) => void;
  onOpenRoom: (room: string) => void;
}

function ListView({
  data,
  ctx,
  activeTerm,
  buildings,
  campusRooms,
  classesForBuilding,
  courseMatches,
  onFindSections,
  onlyFree,
  onOpenCourse,
  onOpenBuilding,
  onOpenRoom,
}: ListViewProps) {
  const [showAllClasses, setShowAllClasses] = useState(false);

  if (!buildings.length && !courseMatches.length) {
    return (
      <div className="text-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800">
        <i className="fa-solid fa-door-closed text-slate-400 text-3xl mb-3" />
        <p className="text-slate-200 font-bold text-base">No matching classes found</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          Try clearing your search term.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AvailabilityNotice
        data={data}
        ctx={ctx}
        campus={data.campus}
        campusRooms={campusRooms}
      />
      {courseMatches.length ? (
        <div className="bg-slate-900/40 border border-slate-800/90 rounded-2xl p-4 space-y-3 shadow-md">
          <div className="flex items-center gap-2.5">
            <i className="fa-solid fa-book-open text-blue-400 text-xs" />
            <h2 className="font-bold text-white text-base">Matching courses</h2>
            <span className="text-xs text-slate-400">
              pick one to see every section of it
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              {courseMatches.length}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {courseMatches.map((code) => {
              const meetings = findCourseMeetings(data.classes, code);
              const first = meetings[0];
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onFindSections(code)}
                  className="group bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 border-l-4 border-l-blue-500 rounded-xl px-4 py-3 text-left transition-all shadow-sm"
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-base font-bold text-white group-hover:text-blue-400 transition">
                      {code}
                    </span>
                    <span className="text-xs text-slate-400">
                      {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {first ? (
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {first.courseTitle} • {first.buildingName}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {buildings.map((b) => {
        const buildingClasses = classesForBuilding(b.code);
        // The rooms a student would walk to first: the one that is free
        // now, then the one that frees soonest.
        const rooms = sortRoomsByNextFree(
          campusRooms.filter((room) => room.building === b.code),
          ctx,
        );
        const classrooms = data.classrooms.filter(
          (classroom) => classroom.building === b.code,
        );
        const roomStates = rooms.map((room) => roomStatusAt(room, ctx).state);
        const freeCount = roomStates.filter((state) => state === "free").length;
        const unknownCount = roomStates.filter((state) => state === "unknown").length;
        const visibleRooms = onlyFree
          ? rooms.filter((room) => roomStatusAt(room, ctx).state === "free")
          : rooms;
        const todays = buildingClasses
          .filter((meeting) => meeting.day === ctx.uoftDay)
          .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        const next = nextClassInBuilding(buildingClasses, ctx.uoftDay, ctx.nowMins);
        const inProgress = classesInProgress(buildingClasses, ctx.uoftDay, ctx.nowMins);
        const shown = showAllClasses ? todays : todays.slice(0, 6);

        return (
          <div
            key={b.code}
            className="bg-slate-900/40 border border-slate-800/90 rounded-2xl p-4 space-y-3 shadow-md"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => onOpenBuilding(b.code)}
                className="flex items-center gap-2.5 text-left"
              >
                <span className="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-300 font-bold text-xs hover:bg-blue-600 hover:text-white transition">
                  {b.code}
                </span>
                <h2 className="font-bold text-white text-base">{b.name}</h2>
              </button>
              <div className="flex items-center gap-2 flex-wrap">
                {rooms.length ? (
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                      freeCount
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : "bg-slate-900 text-slate-400 border-slate-800"
                    }`}
                    title={
                      unknownCount
                        ? `${unknownCount} of ${rooms.length} rooms are not published for this hour`
                        : undefined
                    }
                  >
                    {freeCount} of {rooms.length} free now
                  </span>
                ) : null}
                {todays.length ? (
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                      inProgress.length === 0
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : inProgress.length <= 2
                          ? "bg-slate-900 text-slate-300 border-slate-800"
                          : "bg-slate-900 text-slate-400 border-slate-800"
                    }`}
                    title="Classes running in this building right now"
                  >
                    {inProgress.length} running now
                  </span>
                ) : null}
                {classrooms.length && !rooms.length ? (
                  <span
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300"
                    title="Classrooms the University lists in this building"
                  >
                    {classrooms.length} classrooms
                  </span>
                ) : null}
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                  {b.meetingCount} class meetings · {activeTerm === "F" ? "Fall" : "Winter"}
                </span>
              </div>
            </div>

            {visibleRooms.length ? (
              <div className="space-y-2">
                {visibleRooms.map((room) => {
                  const status = roomStatusAt(room, ctx);
                  return (
                    <RoomCard
                      key={room.room}
                      room={room}
                      status={status}
                      next={next}
                      inProgress={inProgress}
                      onOpen={() => onOpenRoom(room.room)}
                    />
                  );
                })}
              </div>
            ) : null}

            {rooms.length && onlyFree && !visibleRooms.length ? (
              <p className="text-xs text-slate-400">
                No rooms in {b.code} are listed as available right now.
              </p>
            ) : null}

            {/*
              The classrooms the University lists for a building, for the
              campuses where no occupancy is published. It is the one piece
              of classroom data that is public for St. George, so it is
              worth showing: these are the rooms to look for.
            */}
            {classrooms.length && !rooms.length ? (
              <div className="border-t border-slate-800/80 pt-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">
                  Classrooms in {b.code}
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                    room number and capacity
                  </span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {classrooms.map((classroom) => (
                    <span
                      key={`${classroom.building}-${classroom.room}`}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md bg-slate-900/70 border border-slate-800 text-slate-300"
                      title={
                        classroom.name
                          ? `${classroom.room} ${classroom.name}${
                              classroom.capacity ? ` • seats ${classroom.capacity}` : ""
                            }`
                          : classroom.room
                      }
                    >
                      {classroom.room}
                      {classroom.capacity ? (
                        <span className="text-slate-400 font-normal">
                          {" · "}
                          {classroom.capacity}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {buildingClasses.length ? (
              <div className="border-t border-slate-800/80 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                    Today in {b.code}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onOpenBuilding(b.code)}
                    className="text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                  >
                    Full weekly schedule →
                  </button>
                </div>
                <div className="space-y-1.5">
                  {shown.map((meeting) => (
                    <button
                      key={`${meeting.courseCode}-${meeting.sectionName}-${meeting.start}`}
                      type="button"
                      onClick={() => onOpenCourse(meeting.courseCode)}
                      className="w-full text-left bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-blue-500/40 rounded-lg px-3 py-2 transition flex flex-wrap items-center gap-x-3 gap-y-1"
                    >
                      <span className="text-xs font-bold text-blue-300 w-32 shrink-0">
                        {format12Hour(meeting.start)} – {format12Hour(meeting.end)}
                      </span>
                      <span className="text-xs font-bold text-white">{meeting.courseCode}</span>
                      <span className="text-xs text-slate-400">{meeting.sectionName}</span>
                      <span className="text-xs text-slate-400 truncate">
                        {meeting.courseTitle}
                      </span>
                      <span className="text-[11px] text-emerald-300/90 ml-auto flex items-center gap-2">
                        {rooms.length ? (
                          <span>
                            {freeCount} free in {b.code} now
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                  {todays.length > shown.length || (todays.length > 6 && shown.length >= 6) ? (
                    <div className="flex items-center gap-3 pt-0.5">
                      {todays.length > shown.length ? (
                        <button
                          type="button"
                          onClick={() => setShowAllClasses(true)}
                          className="text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                        >
                          Show {todays.length - shown.length} more
                        </button>
                      ) : null}
                      {todays.length > 6 && shown.length >= 6 ? (
                        <button
                          type="button"
                          onClick={() => setShowAllClasses(false)}
                          className="text-[11px] font-semibold text-slate-400 hover:text-slate-300"
                        >
                          Show fewer
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface RoomCardProps {
  room: Room;
  status: ReturnType<typeof roomStatusAt>;
  next: ClassMeeting | null;
  inProgress: ClassMeeting[];
  onOpen: () => void;
}

/**
 * One place to explain what the availability data is and is not.
 *
 * Before this, every room card repeated "the space database does not publish
 * this hour", so a campus whose snapshot had ended looked broken rather than
 * simply outside the published band.
 */
function AvailabilityNotice({
  data,
  ctx,
  campus,
  campusRooms,
}: {
  data: Dataset;
  ctx: ReturnType<typeof getLiveTimeContext>;
  campus: string;
  campusRooms: Room[];
}) {
  const classroomCount = data.classrooms.length;
  const campusName = CAMPUS_NAMES[campus] ?? campus;
  const hours = publishedHours(campusRooms);
  const currentHour = Math.floor(ctx.nowMins / 60);
  const isPublished = hours.includes(currentHour);
  const band = formatHourRange(hours);
  const source = data.availability?.source ?? "the UofT Classroom Space Database";

  if (!campusRooms.length) {
    return (
      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-xs text-slate-300 flex items-start gap-3">
        <i className="fa-solid fa-circle-info mt-0.5 text-slate-400" aria-hidden="true" />
        <p className="leading-relaxed">
          <strong className="font-bold text-slate-200">
            {classroomCount} classrooms are listed for {campusName}.
          </strong>{" "}
          The University publishes classroom occupancy for Mississauga only, so
          here you can see every class with its time, building and instructor,
          the rooms in each building, and how many classes are running in it
          right now.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-xs flex items-start gap-3 ${
        isPublished
          ? "border-slate-700/70 bg-slate-900/60 text-slate-300"
          : "border-slate-700/70 bg-slate-900/60 text-slate-300"
      }`}
    >
      <i className="fa-solid fa-clock mt-0.5 text-slate-400" aria-hidden="true" />
      <p className="leading-relaxed">
        {isPublished ? (
          <>
            <strong className="font-bold text-slate-200">
              Classroom availability, {band}.
            </strong>{" "}
            From {source}. A room is listed as free only when that source says
            it is.
          </>
        ) : (
          <>
            <strong className="font-bold text-slate-200">
              It is {format12Hour(`${String(currentHour).padStart(2, "0")}:00`)};
              the space database covers {band}.
            </strong>{" "}
            Rooms outside those hours show as unknown rather than free.
          </>
        )}
      </p>
    </div>
  );
}

function RoomCard({ room, status, next, inProgress, onOpen }: RoomCardProps) {
  let leftBorder = "border-l-4 border-l-emerald-500";
  let badgeStyle = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  let dotColor = "bg-emerald-400";

  if (status.state === "busy") {
    leftBorder = "border-l-4 border-l-rose-500";
    badgeStyle = "bg-rose-500/15 text-rose-300 border-rose-500/30";
    dotColor = "bg-rose-400";
  } else if (status.state === "unknown") {
    leftBorder = "border-l-4 border-l-slate-500";
    badgeStyle = "bg-slate-500/15 text-slate-300 border-slate-500/30";
    dotColor = "bg-slate-400";
  }

  // A busy building can have a dozen classes running at once. Name a few and
  // count the rest rather than listing them all.
  const named = inProgress.slice(0, 3).map((m) => `${m.courseCode} ${m.sectionName}`);
  const extra = inProgress.length - named.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${room.room}, ${room.buildingName}: ${status.statusTitle}. Open the weekly timetable.`}
      className={`group bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 ${leftBorder} rounded-xl px-4 py-3.5 cursor-pointer transition-all shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left w-full`}
    >
      <div className="flex items-start sm:items-center gap-3.5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-base font-bold text-white group-hover:text-blue-400 transition">
              {room.room}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border font-semibold ${badgeStyle}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              {status.statusTitle}
            </span>
            <span className="text-xs text-slate-400 font-medium hidden md:inline">
              {room.buildingName} • capacity {room.capacity}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {inProgress.length
              ? `In progress in this building: ${named.join(" • ")}${
                  extra > 0 ? ` • +${extra} more` : ""
                }`
              : next
                ? `Next class in this building at ${format12Hour(next.start)}: ${next.courseCode} ${next.sectionName}`
                : null}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-slate-800/80 pt-2 sm:pt-0">
        <div className="text-left sm:text-right">
          {/*
            The status line only says something when the hour is actually
            published. Otherwise it would repeat the same sentence on every
            card, which reads as an error rather than as a fact about the
            snapshot. The banner above the list says it once.
          */}
          {status.state !== "unknown" ? (
            <div
              className={`text-xs sm:text-sm font-bold ${
                status.state === "busy" ? "text-rose-300" : "text-emerald-300"
              }`}
            >
              {status.nextFreeText}
            </div>
          ) : null}
          <div className="text-[11px] text-slate-400 font-medium">
            Click for weekly timetable →
          </div>
        </div>
      </div>
    </button>
  );
}

// ------------------------------------------------------------ schedule view

interface ScheduleViewProps {
  data: Dataset;
  ctx: ReturnType<typeof getLiveTimeContext>;
  route: Exclude<Route, { mode: "list" | "sections" }>;
  activeTerm: Term;
  onTermChange: (term: Term) => void;
  onBack: () => void;
  onOpenCourse: (code: string) => void;
  onOpenBuilding: (code: string) => void;
}

function ScheduleView({
  data,
  ctx,
  route,
  activeTerm,
  onTermChange,
  onBack,
  onOpenCourse,
  onOpenBuilding,
}: ScheduleViewProps) {
  if (route.mode === "section") {
    const sectionMeetings = data.classes.filter(
      (meeting) =>
        meeting.campusKey === route.campus &&
        meeting.courseCode === route.id &&
        meeting.sessionCode === route.session &&
        meeting.sectionName === route.section,
    );
    const sectionBlocks: ScheduleBlock[] = sectionMeetings.map((meeting) => ({
      day: meeting.day,
      start: meeting.start,
      end: meeting.end,
      title: `${meeting.courseCode} ${meeting.sectionName}`,
      subtitle: meeting.buildingName,
      lane: 0,
      lanes: 1,
      courseCode: meeting.courseCode,
      room: meeting.room,
    }));

    return (
      <WeeklySchedule
        title={route.section}
        subtitle={`${route.id} • ${route.campus} campus`}
        blocks={layoutLanes(sectionBlocks)}
        ctx={ctx}
        activeTerm={activeTerm}
        onTermChange={onTermChange}
        onBack={onBack}
        onBlockClick={() => onOpenCourse(route.id)}
        banner={
          <div className="rounded-xl border px-4 py-3 bg-blue-500/15 border-blue-500/40 text-blue-200 text-sm font-semibold">
            This is one section of {route.id}. The University publishes no room
            number for it, so it is located to its building.
          </div>
        }
      />
    );
  }

  if (route.mode === "room") {
    const room = data.rooms.find((r) => r.room === route.id);
    if (!room) {
      return (
        <div className="text-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800">
          <p className="text-slate-200 font-bold text-base">Room not found</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-3 text-xs font-semibold text-blue-400 hover:text-blue-300"
          >
            Back to the list
          </button>
        </div>
      );
    }

    const blocks: ScheduleBlock[] = [];
    for (const [day, hours] of Object.entries(room.occupancy)) {
      for (const [hour, busy] of Object.entries(hours)) {
        if (!busy) continue;
        const startHour = Number(hour);
        blocks.push({
          day: Number(day),
          start: `${String(startHour).padStart(2, "0")}:00`,
          end: `${String(startHour + 1).padStart(2, "0")}:00`,
          title: "Booked",
          subtitle: room.buildingName,
          lane: 0,
          lanes: 1,
        });
      }
    }
    const laidOut = layoutLanes(blocks);

    return (
      <WeeklySchedule
        title={room.room}
        subtitle={`${room.buildingName} (${route.campus}) • Room Weekly Schedule`}
        blocks={laidOut}
        ctx={ctx}
        activeTerm={activeTerm}
        onTermChange={onTermChange}
        onBack={onBack}
        blockStyle="room"
        banner={
          <div className="rounded-xl border px-4 py-3 bg-blue-500/15 border-blue-500/40 text-blue-200 text-sm font-semibold">
            This is the room&apos;s occupancy for the week the space database
            covers. The timetable does not publish which course is scheduled in
            which room, so the course list is not shown here.
          </div>
        }
      />
    );
  }

  const meetings = data.classes.filter((meeting) => {
    if (meeting.campusKey !== route.campus) return false;
    if (route.mode === "course") {
      return normalizeCode(meeting.courseCode) === normalizeCode(route.id);
    }
    return meeting.buildingCode === route.id;
  });

  const termMeetings = filterByTerm(meetings, activeTerm);

  const blocks: ScheduleBlock[] = termMeetings.map((meeting) => ({
    day: meeting.day,
    start: meeting.start,
    end: meeting.end,
    title: `${meeting.courseCode} ${meeting.sectionName}`,
    subtitle: `${meeting.buildingName}${
      meeting.room ? ` • ${meeting.room}` : ""
    }`,
    lane: 0,
    lanes: 1,
    courseCode: meeting.courseCode,
    room: meeting.room,
  }));

  const laidOut = layoutLanes(blocks);
  const title =
    route.mode === "course" ? route.id.toUpperCase() : route.id;
  const subtitle =
    route.mode === "course"
      ? `Course Timetable across ${route.campus} Campus`
      : `Class schedule for building ${route.id}`;
  const instructors = [
    ...new Set(
      termMeetings.flatMap((meeting) => meeting.instructors),
    ),
  ].slice(0, 6);
  const involvedBuildings = [
    ...new Set(termMeetings.map((meeting) => meeting.buildingCode)),
  ].sort();

  return (
    <WeeklySchedule
      title={title}
      subtitle={subtitle}
      blocks={laidOut}
      ctx={ctx}
      activeTerm={activeTerm}
      onTermChange={onTermChange}
      onBack={onBack}
      onBlockClick={(block) => {
        if (block.courseCode) onOpenCourse(block.courseCode);
      }}
      banner={
        <div className="rounded-xl border px-4 py-3 bg-blue-500/15 border-blue-500/40 text-blue-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="font-bold text-sm flex items-center gap-2">
            <i className="fa-solid fa-book-open text-blue-400" />
            {termMeetings.length} section meeting
            {termMeetings.length === 1 ? "" : "s"} found
            {instructors.length ? ` • ${instructors.join(", ")}` : ""}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {involvedBuildings.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onOpenBuilding(code)}
                className="px-2 py-0.5 rounded-md bg-blue-500/20 border border-blue-400/30 text-blue-100 text-[11px] font-bold hover:bg-blue-500 hover:text-white transition"
              >
                {code}
              </button>
            ))}
            <span className="text-xs font-medium opacity-90">
              No room number is listed for these sections
            </span>
          </div>
        </div>
      }
    />
  );
}
