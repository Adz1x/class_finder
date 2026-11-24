"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WeeklySchedule from "./WeeklySchedule";
import SectionFinder from "./SectionFinder";
import WindowControl from "./WindowControl";
import {
  EMPTY_WINDOW,
  classesInWindow,
  roomStateForWindow,
  roomStatusForWindow,
  sortRoomsByWindow,
  windowIsEmpty,
  type TimeWindow,
} from "./lib/window";
import {
  buildingLabel,
  buildingSummaries,
  classesInProgress,
  classroomKey,
  filterByTerm,
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
  Classroom,
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

  // The chips and the dropdown name every building the search matches; the
  // list below shows the selected building, if one is selected. Keeping the
  // two apart means choosing a building does not hide the other buildings.
  const visibleBuildings = useMemo(() => {
    const wanted = normalizeCode(query);
    if (!wanted) return buildings;
    return buildings.filter(
      (b) =>
        normalizeCode(b.code).includes(wanted) ||
        normalizeCode(b.name).includes(wanted),
    );
  }, [buildings, query]);

  const listBuildings = useMemo(
    () =>
      building === "ALL"
        ? visibleBuildings
        : buildings.filter((b) => b.code === building),
    [building, buildings, visibleBuildings],
  );

  const courseMatches = useMemo(
    () => (query ? searchCourseCodes(campusClasses, query, 12) : []),
    [campusClasses, query],
  );

  // A course code is a different question from "which room is free", so the
  // course results take the room controls' place rather than sitting under
  // them. A building name that happens to contain a course-code substring
  // ("CC" and the CCT courses) is not a course search: the digit in a real
  // course code is what tells them apart.
  const courseSearch =
    courseMatches.length > 0 &&
    (visibleBuildings.length === 0 || /\d/.test(query));

  // Does the search name a building? If it does, the classes inside that
  // building are what the student asked for, not classes whose course code
  // happens to contain the same letters.
  const queryNamesABuilding = useMemo(() => {
    const wanted = normalizeCode(query);
    if (!wanted) return false;
    return buildings.some(
      (b) =>
        normalizeCode(b.code).includes(wanted) ||
        normalizeCode(b.name).includes(wanted),
    );
  }, [buildings, query]);

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
  const rankedListBuildings = useMemo(
    () => [...listBuildings].sort((a, b) => b.meetingCount - a.meetingCount),
    [listBuildings],
  );
  const chipBuildings = rankedBuildings.slice(0, MAX_BUILDING_CHIPS);
  const overflowBuildings = rankedBuildings.slice(MAX_BUILDING_CHIPS);

  const classesForBuilding = useCallback(
    (code: string) => {
      const wanted = normalizeCode(query);
      const inBuilding = termClasses.filter((c) => c.buildingCode === code);
      // A building name chooses the building; it does not narrow the classes
      // inside it. Only a search that is not naming a building filters them.
      if (!wanted || queryNamesABuilding) return inBuilding;
      return inBuilding.filter(
        (c) =>
          normalizeCode(c.courseCode).includes(wanted) ||
          normalizeCode(c.sectionName).includes(wanted) ||
          normalizeCode(c.courseTitle).includes(wanted) ||
          c.instructors.some((name) => normalizeCode(name).includes(wanted)),
      );
    },
    [termClasses, query, queryNamesABuilding],
  );

  const hasWindow = !windowIsEmpty(timeWindow);

  // A query with a digit can name a room ("MN 2100"); a query without one is
  // a building or course name. An occupancy room gets the status the student
  // would see in its building card. An inventory-only room shows what the
  // University lists without pretending to know whether it is free.
  const roomMatches = useMemo(() => {
    const wanted = normalizeCode(query);
    if (!wanted || !/\d/.test(wanted)) return [];
    return campusRooms
      .filter((room) => {
        const key = classroomKey(room.building, room.room);
        return key.includes(wanted) || normalizeCode(room.room).includes(wanted);
      })
      .slice(0, 8)
      .map((room) => ({
        room,
        status: hasWindow
          ? roomStatusForWindow(room, timeWindow)
          : roomStatusAt(room, ctx),
      }));
  }, [campusRooms, query, hasWindow, timeWindow, ctx]);

  const classroomMatches = useMemo(() => {
    const wanted = normalizeCode(query);
    if (!wanted || !/\d/.test(wanted) || !data) return [];
    const occupied = new Set(
      campusRooms.map((room) => classroomKey(room.building, room.room)),
    );
    return data.classrooms
      .filter((classroom) => {
        const key = classroomKey(classroom.building, classroom.room);
        return key.includes(wanted) && !occupied.has(key);
      })
      .slice(0, 6);
  }, [campusRooms, data, query]);

  const stats = useMemo(() => {
    const totalRooms = campusRooms.length;
    let freeRooms = 0;
    let unknownRooms = 0;
    for (const room of campusRooms) {
      const state = hasWindow
        ? roomStateForWindow(room, timeWindow)
        : roomStatusAt(room, ctx).state;
      if (state === "free") freeRooms += 1;
      else if (state === "unknown") unknownRooms += 1;
    }
    return { totalRooms, freeRooms, unknownRooms };
  }, [campusRooms, ctx, hasWindow, timeWindow]);

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
    // The chip chooses a building; it is not a search term. Writing the code
    // into the box used to turn "CC" into a search for every CCT course and
    // filter the building's own classes.
    setQuery("");
    setViewTerm(null);
    goHome();
  };

  const clearSearch = () => {
    setQuery("");
    setBuilding("ALL");
    goHome();
  };

  // Enter takes the student to the thing the box is describing: the room's
  // weekly timetable, the course's sections, or the building that was named.
  // The room match is checked first because a room number also contains
  // digits, and an exact "IB 260" should win over the first partial match.
  const openSearchResult = () => {
    const wanted = normalizeCode(query);
    if (!wanted) return;

    const exactRoom = roomMatches.find(
      ({ room }) =>
        normalizeCode(room.room) === wanted ||
        classroomKey(room.building, room.room) === wanted,
    );
    const room = exactRoom ?? roomMatches[0];
    if (room) {
      navigate(
        `#/room/${encodeURIComponent(activeCampus)}/${encodeURIComponent(room.room.room)}`,
      );
      return;
    }

    if (courseMatches.length) {
      navigate(
        `#/sections/${encodeURIComponent(activeCampus)}/${encodeURIComponent(courseMatches[0])}`,
      );
      return;
    }

    if (visibleBuildings.length === 1) {
      selectBuilding(visibleBuildings[0].code);
    }
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/x-logo.png"
              alt=""
              width={40}
              height={40}
              className="w-10 h-10 rounded-full border border-white/20 shadow-inner transition-transform duration-300 hover:rotate-12"
            />
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
            {!courseSearch ? (
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
            ) : null}

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
                        : hasWindow
                        ? `${stats.freeRooms} of ${stats.totalRooms} classrooms free for your window on ${activeCampus}`
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
                openSearchResult();
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

            {!courseSearch ? (
              <label
                className={`inline-flex items-center gap-2.5 text-xs font-semibold text-slate-200 px-3.5 py-2 rounded-xl border ${
                  campusHasRooms
                    ? "bg-slate-800/70 border-slate-700/80 cursor-pointer select-none hover:bg-slate-800 transition shadow-sm"
                    : "bg-slate-900/60 border-slate-800 text-slate-400 cursor-not-allowed"
                }`}
                title={
                  campusHasRooms
                    ? hasWindow
                      ? "Only show the rooms that are free for the window you named"
                      : "Only show rooms that are listed as available right now"
                    : "Room-level availability is not published for this campus"
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
                  {hasWindow
                    ? "Only show rooms free for your window"
                    : "Only show empty classes right now"}
                </span>
              </label>
            ) : null}
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
            buildings={rankedListBuildings}
            campusRooms={campusRooms}
            classesForBuilding={classesForBuilding}
            courseMatches={courseMatches}
            courseSearch={courseSearch}
            roomMatches={roomMatches}
            classroomMatches={classroomMatches}
            onlyFree={onlyFree && campusHasRooms}
            window={timeWindow}
            onWindowChange={setTimeWindow}
            onFindSections={(code) =>
              navigate(`#/sections/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
            }
            onOpenCourse={(code) =>
              navigate(`#/course/${encodeURIComponent(activeCampus)}/${encodeURIComponent(code)}`)
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

interface RoomMatch {
  room: Room;
  status: ReturnType<typeof roomStatusAt>;
}

interface ListViewProps {
  data: Dataset;
  ctx: ReturnType<typeof getLiveTimeContext>;
  activeTerm: Term;
  buildings: ReturnType<typeof buildingSummaries>;
  campusRooms: Room[];
  classesForBuilding: (code: string) => ClassMeeting[];
  courseMatches: string[];
  /** True when the search is a course code, not a room or a building. */
  courseSearch: boolean;
  /** Rooms whose number the search matches, with their current status. */
  roomMatches: RoomMatch[];
  /** Inventory rooms that have no occupancy feed, so cannot show a status. */
  classroomMatches: Classroom[];
  /** Open the section finder for a course. */
  onFindSections: (code: string) => void;
  /** The times the student says they can do something in. */
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
  onlyFree: boolean;
  onOpenCourse: (code: string) => void;
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
  courseSearch,
  roomMatches,
  classroomMatches,
  onFindSections,
  window,
  onWindowChange,
  onlyFree,
  onOpenCourse,
  onOpenRoom,
}: ListViewProps) {
  const [showAllClasses, setShowAllClasses] = useState(false);

  if (
    !buildings.length &&
    !courseMatches.length &&
    !roomMatches.length &&
    !classroomMatches.length
  ) {
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
      {roomMatches.length || classroomMatches.length ? (
        <div
          role="group"
          aria-label="Rooms matching your search"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Rooms
          </span>
          {roomMatches.map(({ room, status }) => (
            <button
              key={room.room}
              type="button"
              onClick={() => onOpenRoom(room.room)}
              aria-label={`${room.room}, ${status.statusTitle}. Open the weekly timetable.`}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-blue-500 hover:text-white"
            >
              <span className="text-white">{room.room}</span>
              <span
                className={
                  status.state === "free"
                    ? "text-emerald-300"
                    : status.state === "busy"
                      ? "text-rose-300"
                      : "text-slate-400"
                }
              >
                {status.statusTitle}
              </span>
              <i
                className="fa-solid fa-arrow-right text-[10px] text-blue-400"
                aria-hidden="true"
              />
            </button>
          ))}
          {classroomMatches.map((classroom) => {
            const label = normalizeCode(classroom.room).startsWith(
              normalizeCode(classroom.building),
            )
              ? classroom.room
              : `${classroom.building} ${classroom.room}`;
            const details = [
              classroom.name,
              classroom.type,
              classroom.capacity != null
                ? `${classroom.capacity} seats`
                : null,
              classroom.features,
              classroom.physicalAccessibility === "Yes"
                ? "Physically accessible"
                : null,
              classroom.assistiveListening === "Yes"
                ? "Assistive listening"
                : null,
            ]
              .filter(Boolean)
              .join(" • ");
            return (
              <span
                key={`${classroom.building}-${classroom.room}`}
                title={details || "The University lists this room, but publishes no occupancy for it."}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-300"
              >
                <span className="text-slate-200">{label}</span>
                {classroom.capacity != null ? (
                  <span className="font-normal text-slate-400">
                    {classroom.capacity} seats
                  </span>
                ) : null}
              </span>
            );
          })}
          {roomMatches.length ? (
            <span className="text-xs text-slate-500">
              Pick a room to see its weekly timetable.
            </span>
          ) : null}
        </div>
      ) : null}

      {courseSearch ? (
        <div
          role="group"
          aria-label="Courses matching your search"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Courses
          </span>
          {courseMatches.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onFindSections(code)}
              aria-label={`${code}, open every section`}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-blue-500 hover:text-white"
            >
              {code}
              <i
                className="fa-solid fa-arrow-right text-[10px] text-blue-400"
                aria-hidden="true"
              />
            </button>
          ))}
          <span className="text-xs text-slate-500">
            Pick one to see every section.
          </span>
        </div>
      ) : (
        <>
          <AvailabilityNotice
            data={data}
            ctx={ctx}
            campus={data.campus}
            campusRooms={campusRooms}
          />
          <div className="bg-slate-900/40 border border-slate-800/90 rounded-2xl p-4 shadow-md">
            <WindowControl
              window={window}
              onChange={onWindowChange}
              label="When do you need a room?"
            />
            <p className="text-xs text-slate-400 mt-2">
              Name the times you can use a room and the buildings answer for
              that window instead of for right now.
            </p>
          </div>
        </>
      )}

      {buildings.map((b) => {
        const buildingClasses = classesForBuilding(b.code);
        const hasWindow = !windowIsEmpty(window);
        const buildingRooms = campusRooms.filter(
          (room) => room.building === b.code,
        );
        // The rooms a student would walk to first: the one that is free
        // now, then the one that frees soonest. With a window, the one that
        // is free for the window comes first.
        const rooms = hasWindow
          ? sortRoomsByWindow(buildingRooms, window)
          : sortRoomsByNextFree(buildingRooms, ctx);
        const classrooms = data.classrooms.filter(
          (classroom) => classroom.building === b.code,
        );
        // The inventory and the occupancy feed describe the same rooms in
        // different shapes. Show the inventory rooms the occupancy feed does
        // not cover, and merge the inventory's extra facts into the cards
        // above.
        const occupancyKeys = new Set(
          rooms.map((room) => classroomKey(room.building, room.room)),
        );
        const extraClassrooms = classrooms.filter(
          (classroom) =>
            !occupancyKeys.has(classroomKey(classroom.building, classroom.room)),
        );
        const inventoryByKey = new Map(
          classrooms.map((classroom) => [
            classroomKey(classroom.building, classroom.room),
            classroom,
          ]),
        );
        const roomStates = rooms.map((room) =>
          hasWindow
            ? roomStateForWindow(room, window)
            : roomStatusAt(room, ctx).state,
        );
        const freeCount = roomStates.filter((state) => state === "free").length;
        const unknownCount = roomStates.filter((state) => state === "unknown").length;
        const visibleRooms = onlyFree
          ? rooms.filter((_, index) => roomStates[index] === "free")
          : rooms;
        // The classes running in the window, or today's classes when there
        // is no window.
        const todays = (
          hasWindow
            ? classesInWindow(buildingClasses, window)
            : buildingClasses.filter((meeting) => meeting.day === ctx.uoftDay)
        ).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        const next = nextClassInBuilding(buildingClasses, ctx.uoftDay, ctx.nowMins);
        const inProgress = classesInProgress(buildingClasses, ctx.uoftDay, ctx.nowMins);
        const shown = showAllClasses ? todays : todays.slice(0, 6);

        return (
          <div
            key={b.code}
            className="bg-slate-900/40 border border-slate-800/90 rounded-2xl p-4 space-y-3 shadow-md"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 text-left">
                <span className="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-300 font-bold text-xs">
                  {b.code}
                </span>
                <h2 className="font-bold text-white text-base">{b.name}</h2>
              </div>
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
                    {freeCount} of {rooms.length} free{" "}
                    {hasWindow ? "for your window" : "now"}
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
                {extraClassrooms.length ? (
                  <span
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300"
                    title="Classrooms the University lists in this building"
                  >
                    {extraClassrooms.length} more classrooms
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
                  const status = hasWindow
                    ? roomStatusForWindow(room, window)
                    : roomStatusAt(room, ctx);
                  return (
                    <RoomCard
                      key={room.room}
                      room={room}
                      status={status}
                      next={next}
                      inProgress={inProgress}
                      classroom={
                        inventoryByKey.get(
                          classroomKey(room.building, room.room),
                        ) ?? null
                      }
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
              The classrooms the University lists that the occupancy feed
              does not cover. St. George's inventory is the only classroom
              data public for most of its buildings, and Scarborough's adds
              the room type and accessibility the occupancy feed lacks.
            */}
            {extraClassrooms.length ? (
              <div className="border-t border-slate-800/80 pt-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">
                  {rooms.length ? "Other classrooms" : `Classrooms in ${b.code}`}
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                    room number, capacity and the facts the University publishes
                  </span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {extraClassrooms.map((classroom) => {
                    const label = normalizeCode(classroom.room).startsWith(
                      normalizeCode(classroom.building),
                    )
                      ? classroom.room
                      : `${classroom.building} ${classroom.room}`;
                    const details = [
                      classroom.name,
                      classroom.type,
                      classroom.capacity != null
                        ? `seats ${classroom.capacity}`
                        : null,
                      classroom.features,
                      classroom.physicalAccessibility === "Yes"
                        ? "Physically accessible"
                        : null,
                      classroom.assistiveListening === "Yes"
                        ? "Assistive listening"
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" • ");
                    return (
                      <span
                        key={`${classroom.building}-${classroom.room}`}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md bg-slate-900/70 border border-slate-800 text-slate-300"
                        title={
                          details ||
                          "The University lists this room, but publishes no further details."
                        }
                      >
                        {label}
                        {classroom.capacity != null ? (
                          <span className="text-slate-400 font-normal">
                            {" · "}
                            {classroom.capacity}
                          </span>
                        ) : null}
                        {classroom.type ? (
                          <span className="text-slate-500 font-normal">
                            {" · "}
                            {classroom.type}
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {buildingClasses.length ? (
              <div className="border-t border-slate-800/80 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                    {hasWindow ? `Your window in ${b.code}` : `Today in ${b.code}`}
                  </h3>
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
                            {freeCount} free in {b.code}{" "}
                            {hasWindow ? "for your window" : "now"}
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
  /** The University's inventory entry for this room, when it publishes one. */
  classroom: Classroom | null;
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
          The University does not publish room-by-room occupancy for{" "}
          {campusName}, so here you can see every class with its time, building
          and instructor, the classrooms in each building, and how many classes
          are running in it right now.
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

function RoomCard({
  room,
  status,
  next,
  inProgress,
  classroom,
  onOpen,
}: RoomCardProps) {
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
  const buildingName = buildingLabel(room.building, room.buildingName);
  const capacity =
    room.capacity || (classroom?.capacity != null ? String(classroom.capacity) : "");
  // The inventory carries facts the occupancy feed does not: the room's type,
  // its AV equipment, and its accessibility. Keep them available on the card.
  const details = [
    classroom?.name,
    classroom?.type,
    classroom?.features,
    classroom?.physicalAccessibility === "Yes" ? "Physically accessible" : null,
    classroom?.assistiveListening === "Yes" ? "Assistive listening" : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${room.room}, ${buildingName}: ${status.statusTitle}. Open the weekly timetable.`}
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
            <span
              className="text-xs text-slate-400 font-medium hidden md:inline"
              title={details || undefined}
            >
              {buildingName}
              {capacity
                ? ` • capacity ${capacity}`
                : " • capacity not published"}
              {classroom?.type ? ` • ${classroom.type}` : ""}
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
      subtitle: buildingLabel(meeting.buildingCode, meeting.buildingName),
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
          subtitle: buildingLabel(room.building, room.buildingName),
          lane: 0,
          lanes: 1,
        });
      }
    }
    const laidOut = layoutLanes(blocks);

    return (
      <WeeklySchedule
        title={room.room}
        subtitle={`${buildingLabel(room.building, room.buildingName)} (${route.campus}) • Room Weekly Schedule`}
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
    subtitle: `${buildingLabel(meeting.buildingCode, meeting.buildingName)}${
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
