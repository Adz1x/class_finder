"use client";

import { format12Hour, GRID_END_HOUR, GRID_START_HOUR } from "./lib/schedule";
import type { ScheduleBlock, Term, TimeContext } from "./lib/types";

interface WeeklyScheduleProps {
  title: string;
  subtitle: string;
  blocks: ScheduleBlock[];
  ctx: TimeContext;
  activeTerm: Term;
  onTermChange: (term: Term) => void;
  onBack: () => void;
  banner?: React.ReactNode;
  onBlockClick?: (block: ScheduleBlock) => void;
  blockStyle?: "room" | "course";
}

const DAYS = [
  { dayNum: 1, label: "Mon" },
  { dayNum: 2, label: "Tue" },
  { dayNum: 3, label: "Wed" },
  { dayNum: 4, label: "Thu" },
  { dayNum: 5, label: "Fri" },
];

/** The weekly timetable grid: 8:00 to 22:00, Monday to Friday. */
export default function WeeklySchedule({
  title,
  subtitle,
  blocks,
  ctx,
  activeTerm,
  onTermChange,
  onBack,
  banner,
  onBlockClick,
  blockStyle = "course",
}: WeeklyScheduleProps) {
  const timeLabels = [];
  const backgroundLines = [];
  for (let hour = GRID_START_HOUR; hour < GRID_END_HOUR; hour++) {
    const label = hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
    timeLabels.push(
      <div
        key={`label-${hour}`}
        className="hour-row pr-2 text-right text-[11px] text-slate-400 font-medium -mt-2 select-none"
      >
        {label}
      </div>,
    );
    backgroundLines.push(
      <div key={`line-${hour}`} className="hour-row border-t border-slate-800/80" />,
    );
  }

  const showRedLine =
    ctx.nowMins >= GRID_START_HOUR * 60 && ctx.nowMins <= GRID_END_HOUR * 60;
  const redLineTopPx = ctx.nowMins - GRID_START_HOUR * 60;

  const style = blockStyle === "course"
    ? "bg-indigo-900/80 hover:bg-indigo-800 border-indigo-500/60 text-indigo-100"
    : "bg-blue-900/80 hover:bg-blue-800 border-blue-500/60 text-blue-100";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-xl bg-slate-950/70 p-1 border border-slate-800">
          {(["F", "S"] as Term[]).map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => onTermChange(term)}
              className={`px-3.5 py-1.5 rounded-lg text-xs ${
                activeTerm === term
                  ? "font-bold bg-blue-600 text-white shadow"
                  : "font-medium text-slate-300 hover:text-white"
              }`}
            >
              {term === "F" ? "Fall" : "Winter"}
              {ctx.term === term ? " (now)" : ""}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition border border-slate-700 flex items-center gap-2 shadow-sm"
        >
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          Back to Classroom List
        </button>
        <div className="text-right">
          <h1 className="text-xl font-bold text-white flex items-center justify-end gap-2">
            {title}
          </h1>
          <p className="text-xs text-slate-400 font-medium">{subtitle}</p>
        </div>
      </div>

      {banner}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 overflow-x-auto shadow-xl">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[60px_repeat(5,1fr)] mb-1">
            <div className="py-2.5 px-2 text-center text-xs font-semibold text-slate-500 select-none">
              Time
            </div>
            {DAYS.map((day) => {
              const isToday = ctx.uoftDay === day.dayNum;
              return (
                <div
                  key={day.dayNum}
                  className={`py-2 text-center text-xs rounded-lg select-none ${
                    isToday
                      ? "bg-blue-600/30 text-blue-200 font-bold border border-blue-500/40"
                      : "text-slate-400 font-medium"
                  }`}
                >
                  {day.label}{" "}
                  {isToday ? (
                    <span className="text-[10px] text-blue-300 font-normal">(Today)</span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="relative grid grid-cols-[60px_repeat(5,1fr)] border-t border-slate-800">
            <div>{timeLabels}</div>
            <div className="col-span-5 relative grid grid-cols-5">
              <div className="absolute inset-0 col-span-5 pointer-events-none">
                {backgroundLines}
              </div>
              {showRedLine ? (
                <div
                  style={{ top: `${redLineTopPx}px` }}
                  className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500 -ml-1" />
                  <div className="h-0.5 w-full bg-rose-500 shadow-sm" />
                </div>
              ) : null}
              {DAYS.map((day) => {
                const isToday = ctx.uoftDay === day.dayNum;
                const dayBlocks = blocks.filter((block) => block.day === day.dayNum);
                return (
                  <div
                    key={day.dayNum}
                    className={`relative border-l border-slate-800/80 ${
                      isToday ? "bg-blue-950/10" : ""
                    }`}
                  >
                    {dayBlocks.map((block, index) => {
                      const startMins =
                        Number(block.start.slice(0, 2)) * 60 +
                        Number(block.start.slice(3, 5));
                      const endMins =
                        Number(block.end.slice(0, 2)) * 60 +
                        Number(block.end.slice(3, 5));
                      const topPx = startMins - GRID_START_HOUR * 60;
                      const heightPx = Math.max(endMins - startMins, 24);
                      return (
                        <div
                          key={`${block.start}-${block.title}-${index}`}
                          onClick={
                            onBlockClick ? () => onBlockClick(block) : undefined
                          }
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
                            width: `calc(${100 / block.lanes}% - 4px)`,
                          }}
                          className={`absolute rounded-lg border ${
                            block.lanes > 1 ? "border-dashed" : ""
                          } p-1.5 text-xs z-10 overflow-hidden shadow-sm transition-all hover:z-20 hover:scale-[1.02] ${
                            onBlockClick ? "cursor-pointer" : ""
                          } flex flex-col justify-center ${style}`}
                          title={`${block.title} ${format12Hour(block.start)} – ${format12Hour(block.end)}`}
                        >
                          <div className="font-bold truncate text-[11px] sm:text-xs">
                            {block.title}
                          </div>
                          <div className="text-[10px] opacity-80 truncate">
                            {block.subtitle}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
