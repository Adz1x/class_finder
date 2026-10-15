import Image from "next/image";

export default function Home() {
  // State for campus selection and data loading
  const [campus, setCampus] = (() => {
    // Try to read from API on initial load
    const fetchData = async () => {
      try {
        const res = await fetch("/api/route");
        const data = await res.json();
        // Store data globally for the page to use
        if (typeof window !== "undefined") {
          window.UOFT_ROOMS_DATA = data;
        }
        return data;
      } catch (e) {
        console.warn("Could not fetch rooms data:", e);
        return null;
      }
    };

    // Fetch on mount
    fetchData();

    // Return a minimal object so the component compiles
    return { current: "UTSG" };
  })();

  // Since we can't use useState directly in the simple default export,
  // we'll use the global data that the API populates
  const DATA = window.UOFT_ROOMS_DATA || {};
  const currentCampus = campus; // will be set by UI handlers

  // Helper functions (ported from the static index.html)
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const GRID_START_HOUR = 8;
  const GRID_END_HOUR = 22;

  function getLiveTimeContext() {
    const now = new Date();
    const jsDay = now.getDay();
    const uoftDay = jsDay === 0 ? 7 : jsDay;
    const hours = now.getHours();
    const mins = now.getMinutes();
    const nowMins = hours * 60 + mins;
    const month = now.getMonth() + 1;
    const term = (month >= 1 && month <= 4) ? "S" : "F";
    const termLabel = term === "F" ? "Fall Term" : "Winter Term";
    const ampm = hours >= 12 ? "PM" : "AM";
    const h12 = hours % 12 || 12;
    const time12 = `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
    return { uoftDay, nowMins, time12, dayName: DAY_NAMES[jsDay], term, termLabel };
  }

  function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function format12Hour(time24) {
    const [h, m] = time24.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  function formatDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  function normalizeCode(str) {
    return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Merge overlapping blocks
  function mergeBusyBlocks(daySlots) {
    if (!daySlots.length) return [];
    const sorted = daySlots
      .map(s => ({
        startMins: timeToMinutes(s.start),
        endMins: timeToMinutes(s.end),
        start: s.start,
        end: s.end,
        courses: [s.course]
      }))
      .sort((a, b) => a.startMins - b.startMins || b.endMins - a.endMins);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];
      if (curr.startMins <= prev.endMins) {
        if (curr.endMins > prev.endMins) {
          prev.endMins = curr.endMins;
          prev.end = minutesToTime(curr.endMins);
        }
        if (!prev.courses.includes(curr.courses[0])) {
          prev.courses.push(curr.courses[0]);
        }
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }

  function evaluateRoomStatus(slots, ctx) {
    const { uoftDay, nowMins, term } = ctx;
    const rawDaySlots = (slots || [])
      .filter(s => Number(s.day) === uoftDay && (!s.term || s.term === term || s.term === "Y" || s.term === "FULL"))
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const mergedBlocks = mergeBusyBlocks(rawDaySlots);

    for (const block of mergedBlocks) {
      if (nowMins >= block.startMins && nowMins < block.endMins) {
        const minsUntilFree = block.endMins - nowMins;
        return {
          isEmpty: false,
          freeMinutes: 0,
          minsUntilFree,
          soonWarning: false,
          statusTitle: "Occupied",
          nextFreeText: `Free next at ${format12Hour(block.end)} (in ${formatDuration(minsUntilFree)})`,
          subText: `In progress: ${block.courses.join(" • ")} (${format12Hour(block.start)} – ${format12Hour(block.end)})`,
          rawDaySlots
        };
      }
      if (block.startMins > nowMins) {
        const diff = block.startMins - nowMins;
        const soonWarning = diff < 30;
        return {
          isEmpty: true,
          freeMinutes: diff,
          minsUntilFree: 0,
          soonWarning,
          statusTitle: soonWarning ? "Available Briefly" : "Available",
          nextFreeText: `Free until ${format12Hour(block.start)} (${formatDuration(diff)})`,
          subText: `Next class at ${format12Hour(block.start)}: ${block.courses.join(" • ")}`,
          rawDaySlots
        };
      }
    }
    const remainingDay = Math.max(0, 22 * 60 - nowMins);
    return {
      isEmpty: true,
      freeMinutes: remainingDay,
      minsUntilFree: 0,
      soonWarning: false,
      statusTitle: "Available",
      nextFreeText: "Free for the rest of the day",
      subText: rawDaySlots.length ? "All scheduled classes for today have finished" : "No classes scheduled in this room today",
      rawDaySlots
    };
  }

  function bldgLabel(b) {
    return (!b.name || b.name === `${b.code} Building`) ? "Name not listed" : b.name;
  }

  const MAX_BUILDING_CHIPS = 8;

  function renderBuildingSwitcherBox() {
    const campusBuildings = DATA[currentCampus] || {};
    const all = Object.values(campusBuildings);
    const box = document.getElementById("buildingSwitcherBox");

    const chipOn = "px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-blue-600 text-white shadow shrink-0";
    const chipOff = "px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-slate-300 hover:text-white hover:bg-slate-800/60 shrink-0";

    let html = `<button type="button" onclick="selectBuildingTab('ALL')" class="${false ? chipOn : chipOff}">All Buildings</button>`;

    const roomCount = b => Object.keys(b.rooms).length;
    let chipBuildings, moreBuildings = [];
    if (all.length <= MAX_BUILDING_CHIPS + 2) {
      chipBuildings = all.slice().sort((x, y) => x.code.localeCompare(y.code));
    } else {
      const byRooms = all.slice().sort((x, y) => roomCount(y) - roomCount(x) || x.code.localeCompare(y.code));
      chipBuildings = byRooms.slice(0, MAX_BUILDING_CHIPS).sort((x, y) => x.code.localeCompare(y.code));
      const sel = campusBuildings[false]; // selectedBuilding not tracked simply
      if (sel && !chipBuildings.includes(sel)) chipBuildings.push(sel);
      moreBuildings = all.filter(x => !chipBuildings.includes(x)).sort((x, y) => x.code.localeCompare(y.code));
    }

    chipBuildings.forEach(bl => {
      html += `<button type="button" title="${bldgLabel(bl)}" onclick="selectBuildingTab('${bl.code}')" class="${false ? chipOn : chipOff}">${bl.code}</button>`;
    });

    if (moreBuildings.length) {
      html += `<select onchange="if(this.value){selectBuildingTab(this.value)}" class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:border-blue-500 shrink-0 max-w-[11rem]">
        <option value="">More buildings (${moreBuildings.length})…</option>
        ${moreBuildings.map(bl => `<option value="${bl.code}">${bl.code} — ${bldgLabel(bl)} (${roomCount(bl)})</option>`).join("")}
      </select>`;
    }

    box.innerHTML = html;
  }

  function selectBuildingTab(code) {
    // In a real app, we'd update state; for now just render
    renderBuildingSwitcherBox();
  }

  function setCampus(campus) {
    currentCampus = campus;
    renderBuildingSwitcherBox();
  }

  function handleFilterToggle() {
    renderListView();
  }

  function clearSearch() {
    renderBuildingSwitcherBox();
    renderListView();
  }

  function handleSearchInput() {
    renderListView();
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    renderListView();
  }

  function createHorizontalRoomBox(roomName, bldgName, status) {
    let leftBorder = "border-l-4 border-l-emerald-500";
    let badgeStyle = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    let dotColor = "bg-emerald-400";

    if (!status.isEmpty) {
      leftBorder = "border-l-4 border-l-rose-500";
      badgeStyle = "bg-rose-500/15 text-rose-300 border-rose-500/30";
      dotColor = "bg-rose-400";
    } else if (status.soonWarning) {
      leftBorder = "border-l-4 border-l-amber-500";
      badgeStyle = "bg-amber-500/15 text-amber-300 border-amber-500/30";
      dotColor = "bg-amber-400";
    }

    const safeRoom = roomName.replace(/'/g, "\\'");

    return `
      <div class="group bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 ${leftBorder} rounded-xl px-4 py-3.5 cursor-pointer transition-all shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start sm:items-center gap-3.5">
          <div>
            <div class="flex items-center gap-2.5 flex-wrap">
              <span class="text-base font-bold text-white group-hover:text-blue-400 transition">
                ${roomName}
              </span>
              <span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border font-semibold ${badgeStyle}">
                <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
                ${status.statusTitle}
              </span>
              <span class="text-xs text-slate-500 font-medium hidden md:inline">${bldgName}</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">${status.subText}</p>
          </div>
        </div>

        <div class="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-slate-800/80 pt-2 sm:pt-0">
          <div class="text-left sm:text-right">
            <div class="text-xs sm:text-sm font-bold ${status.isEmpty ? (status.soonWarning ? 'text-amber-300' : 'text-emerald-300') : 'text-rose-300'}">
              ${status.nextFreeText}
            </div>
            <div class="text-[11px] text-slate-500 font-medium">Click for weekly timetable →</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderListView() {
    const ctx = getLiveTimeContext();
    const rawQuery = document.getElementById("searchInput")?.value || "";
    const normQuery = normalizeCode(rawQuery);

    const campusBuildings = DATA[currentCampus] || {};
    const container = document.getElementById("listView");
    if (!container) return;
    container.innerHTML = "";

    let totalCampusRooms = 0;
    let totalCampusEmpty = 0;

    function sortRoomsAvailableFirst(a, b) {
      if (a.status.isEmpty !== b.status.isEmpty) {
        return a.status.isEmpty ? -1 : 1;
      }
      if (a.status.isEmpty) {
        return b.status.freeMinutes - a.status.freeMinutes;
      }
      return a.status.minsUntilFree - b.status.minsUntilFree;
    }

    Object.values(campusBuildings).forEach(b => Object.values(b.rooms).forEach(sl => {
      totalCampusRooms++;
      if (evaluateRoomStatus(sl, ctx).isEmpty) totalCampusEmpty++;
    }));

    const buildingEntries = Object.values(campusBuildings);

    buildingEntries.forEach(bldg => {
      const evaluatedRooms = [];
      let bldgEmpty = 0;

      Object.entries(bldg.rooms).forEach(([roomName, slots]) => {
        const status = evaluateRoomStatus(slots, ctx);
        if (status.isEmpty) bldgEmpty++;

        const matchesQuery = !rawQuery ||
          normalizeCode(roomName).includes(normQuery) ||
          normalizeCode(bldg.name).includes(normQuery) ||
          normalizeCode(bldg.code).includes(normQuery) ||
          slots.some(s => normalizeCode(s.course).includes(normQuery));

        const matchesEmptyFilter = !true || status.isEmpty; // always show for demo

        if (matchesQuery && matchesEmptyFilter) {
          evaluatedRooms.push({ roomName, bldgName: bldg.name, status });
        }
      });

      evaluatedRooms.sort(sortRoomsAvailableFirst);

      if (evaluatedRooms.length > 0) {
        const bldgSection = document.createElement("div");
        bldgSection.className = "bg-slate-900/40 border border-slate-800/90 rounded-2xl p-4 space-y-3 shadow-md";
        bldgSection.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <button onclick="selectBuildingTab('${bldg.code}')" class="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-300 font-bold text-xs hover:bg-blue-600 hover:text-white transition">
                ${bldg.code}
              </button>
              <h2 class="font-bold text-white text-base">${bldgLabel(bldg)}</h2>
            </div>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              ${bldgEmpty} / ${Object.keys(bldg.rooms).length} available
            </span>
          </div>
          <div class="space-y-2">
            ${evaluatedRooms.map(r => createHorizontalRoomBox(r.roomName, r.bldgName, r.status)).join("")}
          </div>
        `;
        container.appendChild(bldgSection);
      }
    });

    const statsSpan = document.getElementById("statsSummaryText");
    if (statsSpan) {
      statsSpan.textContent = `${totalCampusEmpty} of ${totalCampusRooms} classrooms currently available on ${currentCampus}`;
    }

    if (container.innerHTML === "") {
      container.innerHTML = `
        <div class="text-center py-16 bg-slate-900/50 rounded-2xl border border-slate-800">
          <i class="fa-solid fa-door-closed text-slate-600 text-3xl mb-3"></i>
          <p class="text-slate-200 font-bold text-base">No matching available classrooms found</p>
          <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">Try clearing your search term.</p>
        </div>
      `;
    }
  }

  // Initialize on DOMContentLoaded - we'll do it manually since no useState
  document.addEventListener("DOMContentLoaded", () => {
    // Set up building switcher
    renderBuildingSwitcherBox();

    // Render list view
    renderListView();

    // Update clock
    const updateClock = () => {
      const ctx = getLiveTimeContext();
      const liveEl = document.getElementById("liveClockSub");
      if (liveEl) liveEl.textContent = `Live • ${ctx.dayName} ${ctx.time12} • ${ctx.termLabel}`;
    };
    updateClock();
    setInterval(updateClock, 60000);
  });

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert h-5 w-[100px]"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            To get started, edit the
            <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
              page.tsx
            </code>
            file.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Looking for a starting point or more instructions? Head over to
            <a
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="font-medium text-zinc-950 dark:text-zinc-50"
            >
              Templates
            </a>
            or the
            <a
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="font-medium text-zinc-950 dark:text-zinc-50"
            >
              Learning
            </a>
            center.
          </p>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <a
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert h-[14px] w-4"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={16}
              height={14}
            />
            Deploy Now
          </a>
          <a
            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </div>
      </main>
    </div>
  );
}