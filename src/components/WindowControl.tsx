"use client";

import { EMPTY_WINDOW, type TimeWindow } from "./lib/window";
import { minutesToTime, timeToMinutes } from "./lib/schedule";

/**
 * The window: the days and the hours a student says they can do something
 * in.
 *
 * It is the same control for both questions the app answers with it - which
 * section of a course can I take, and which room is free - so it reads
 * "When do you need it?" and lets the caller say what "it" is.
 */

const DAYS = [
  { day: 1, short: "Mon", name: "Monday" },
  { day: 2, short: "Tue", name: "Tuesday" },
  { day: 3, short: "Wed", name: "Wednesday" },
  { day: 4, short: "Thu", name: "Thursday" },
  { day: 5, short: "Fri", name: "Friday" },
  { day: 6, short: "Sat", name: "Saturday" },
  { day: 7, short: "Sun", name: "Sunday" },
];

export interface WindowControlProps {
  window: TimeWindow;
  onChange: (window: TimeWindow) => void;
  /** What the window is for, in the user's words. */
  label?: string;
}

export default function WindowControl({
  window,
  onChange,
  label,
}: WindowControlProps) {
  const toggleDay = (day: number) => {
    const days = window.days.includes(day)
      ? window.days.filter((d) => d !== day)
      : [...window.days, day].sort((a, b) => a - b);
    onChange({ ...window, days });
  };

  const setStart = (value: string) => {
    onChange({
      ...window,
      startMins: value ? timeToMinutes(value) : null,
    });
  };

  const setEnd = (value: string) => {
    onChange({
      ...window,
      endMins: value ? timeToMinutes(value) : null,
    });
  };

  const startValue = window.startMins === null ? "" : minutesToTime(window.startMins);
  const endValue = window.endMins === null ? "" : minutesToTime(window.endMins);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {label ? (
        <span className="text-xs font-semibold text-slate-300">{label}</span>
      ) : null}

      <div
        className="inline-flex rounded-lg bg-slate-950/80 p-0.5 border border-slate-800"
        role="group"
        aria-label="Days you need"
      >
        {DAYS.map((d) => {
          const on = window.days.includes(d.day);
          return (
            <button
              key={d.day}
              type="button"
              onClick={() => toggleDay(d.day)}
              aria-pressed={on}
              aria-label={d.name}
              title={d.name}
              className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${
                on
                  ? "font-bold bg-blue-600 text-white shadow"
                  : "font-medium text-slate-400 hover:text-white"
              }`}
            >
              {d.short}
            </button>
          );
        })}
      </div>

      <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
        From
        <input
          type="time"
          value={startValue}
          onChange={(event) => setStart(event.target.value)}
          aria-label="From"
          className="bg-slate-800/90 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-blue-500"
        />
      </label>

      <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
        To
        <input
          type="time"
          value={endValue}
          min={startValue || undefined}
          onChange={(event) => setEnd(event.target.value)}
          aria-label="To"
          className="bg-slate-800/90 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-blue-500"
        />
      </label>

      <button
        type="button"
        onClick={() => onChange(EMPTY_WINDOW)}
        disabled={window.days.length === 0 && !startValue && !endValue}
        className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Clear
      </button>
    </div>
  );
}
