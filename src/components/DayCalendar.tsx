"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useLayoutEffect, useMemo, useState } from "react";
import { DAY_NAMES, format12Hour, minutesToTime } from "@/components/lib/schedule";
import {
  cellState,
  coveredDays,
  hourColumns,
  isoDateOf,
  roomsFreeOnDay,
  shortHour,
  weekdayOfNow,
  type CellState,
} from "@/components/lib/day-calendar";
import type { Dataset, Room } from "@/components/lib/types";

interface DayCalendarProps {
  data: Dataset;
  campusName: string;
  onOpenRoom: (room: string) => void;
}

/**
 * The day calendar: every room the campus publishes, against every hour the
 * snapshot publishes, on the day the student picks.
 *
 * It is the one question the list view cannot answer at a glance - "which
 * rooms are empty tomorrow" - so it answers it as one grid instead of as a
 * card per room. A cell is only ever one of three things: free, booked, or
 * not published. The last is not free.
 */

const CELL_STYLES: Record<CellState, string> = {
  free: "bg-emerald-500/70 border-emerald-400/40",
  busy: "bg-rose-500/25 border-rose-500/30",
  unpublished: "bg-slate-800/60 border-slate-800/40",
};

/** The rooms, grouped: building first, so the eye reads it like a directory. */
function sortForGrid(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => {
    if (a.building !== b.building) return a.building.localeCompare(b.building);
    return a.room.localeCompare(b.room, undefined, { numeric: true });
  });
}

export default function DayCalendar({ data, campusName, onOpenRoom }: DayCalendarProps) {
  // The data loads asynchronously when the campus changes. Wait until it's available.
  if (!data || !data.rooms || data.rooms.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
        <p className="text-slate-300 font-bold text-base mt-3">
          Loading the {campusName} day calendar...
        </p>
        <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
          Each campus is fetched on its own, so the page only downloads what it is about to show.
        </p>
      </div>
    );
  }

  const rooms = useMemo(() => sortForGrid(data.rooms), [data.rooms]);
  const days = useMemo(() => coveredDays(rooms), [rooms]);
  const hours = useMemo(() => hourColumns(rooms), [rooms]);

  // The day the student is on. Today when the snapshot covers its weekday;
  // the first covered day otherwise. Occupancy is keyed by weekday, so the
  // grid answers "which rooms are free on a Monday", not a calendar date -
  // the date shown is attached from the snapshot's week start.
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  // Read the clock into state on mount. useLayoutEffect avoids hydration
  // mismatch with the prerendered markup.
  const [today, setToday] = useState<number | null>(null);
  useLayoutEffect(() => {
    setToday(weekdayOfNow(new Date()));
  }, []);

  const activeDay = pickedDay ?? (today != null && days.includes(today) ? today : days[0]);

  const freeRooms = useMemo(
    () => roomsFreeOnDay(rooms, activeDay),
    [rooms, activeDay],
  );

  if (!rooms.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p className="text-sm font-bold text-slate-200">
          No classroom occupancy is published for {campusName}
        </p>
        <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
          The University does not publish room-by-room occupancy for this
          campus, so there is no grid to draw. The classroom inventory and
          class times are in the list.
        </p>
      </div>
    );
  }

  const weekStart = data.availability?.weekStart ?? "";
  const dayDate = weekStart ? isoDateOf(weekStart, activeDay) : "";

  const cellsFor = (room: Room) =>
    hours.map((hour) => cellState(room, activeDay, hour));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">
            Day calendar · {DAY_NAMES[activeDay]}
            {dayDate ? (
              <span className="ml-2 text-xs font-medium text-slate-400">
                {dayDate}
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {freeRooms.length} of {rooms.length} rooms have at least one free
            hour this day. Free means no booking is published.
          </p>
        </div>

        <div
          role="group"
          aria-label="Pick the day"
          className="inline-flex rounded-xl bg-slate-950/70 p-1 border border-white/15"
        >
          {days.map((coveredDay) => (
            <button
              key={coveredDay}
              type="button"
              onClick={() => setPickedDay(coveredDay)}
              aria-pressed={coveredDay === activeDay}
              className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                coveredDay === activeDay
                  ? "font-bold bg-blue-600 text-white shadow"
                  : "font-semibold text-slate-300 hover:text-white"
              }`}
            >
              {DAY_NAMES[coveredDay].slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {freeRooms.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
            Free at some point:
          </span>
          {freeRooms.map((room) => (
            <button
              key={room.room}
              type="button"
              onClick={() => onOpenRoom(room.room)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
            >
              {room.room}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800/90 bg-slate-900/40 shadow-md overflow-x-auto">
        <table
          className="w-full border-collapse text-[11px]"
          aria-label={`Rooms at ${campusName}, day by hour`}
        >
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left font-semibold text-slate-300 border-b border-slate-800 min-w-[8rem]"
              >
                Room
              </th>
              {hours.map((hour) => (
                <th
                  key={hour}
                  scope="col"
                  aria-label={`${format12Hour(minutesToTime(hour * 60))} to ${format12Hour(minutesToTime((hour + 1) * 60))}`}
                  className="px-1 py-2 font-medium text-slate-400 border-b border-slate-800 w-7 min-w-7 text-center"
                >
                  {shortHour(hour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => {
              const cells = cellsFor(room);
              const freeCount = cells.filter((c) => c === "free").length;
              const publishedCount = cells.filter((c) => c !== "unpublished").length;
              return (
                <tr key={room.room} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-slate-900 px-3 py-1.5 text-left font-semibold text-slate-200 border-b border-slate-800/70 group-hover:bg-slate-800/80 cursor-pointer"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenRoom(room.room)}
                      className="w-full text-left hover:text-blue-400 transition"
                      aria-label={`${room.room}, ${room.building}: open the weekly timetable`}
                    >
                      {room.room}
                      <span className="block text-[10px] font-normal text-slate-500">
                        {room.capacity ? `${room.building} · ${room.capacity}` : room.building}
                      </span>
                      {freeCount ? (
                        <span className="block text-[10px] font-semibold text-emerald-400">
                          {freeCount} free hour{freeCount === 1 ? "" : "s"}
                        </span>
                      ) : publishedCount ? (
                        <span className="block text-[10px] font-semibold text-rose-400/80">
                          Booked all day
                        </span>
                      ) : (
                        <span className="block text-[10px] font-semibold text-slate-500">
                          Not published
                        </span>
                      )}
                    </button>
                  </th>
                  {cells.map((state, index) => (
                    <td
                      key={hours[index]}
                      className="p-0.5 border-b border-slate-800/40"
                    >
                      <div
                        title={`${room.room} at ${shortHour(hours[index])}: ${
                          state === "free" ? "free" : state === "busy" ? "booked" : "not published"
                        }`}
                        className={`h-5 rounded-sm border ${CELL_STYLES[state]}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        Green = no booking published for the hour · red = booked · grey = the
        source publishes nothing for that hour.
        {weekStart ? " The snapshot covers the week of " : null}
        {weekStart ? weekStart : null}
        {data.availability ? ` from ${data.availability.source}` : ""}.
      </p>
    </div>
  );
}
