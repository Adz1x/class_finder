# Contributing

Thanks for looking at this. The project is small and the bar for a change is
"it makes the data more truthful, or the app more usable".

## The one rule

**Never invent data.** Every value in the app comes from a published source.
If the source does not publish something — a room number, a building name, an
hour of availability — the app says so rather than guessing. This is the
whole point of the project, and a change that fills a gap with a plausible
value is a regression even if it looks nicer.

Concretely:

- A room is shown only if the timetable API published it. (It publishes none
  for the 2026-27 sessions, which is why the app says "room not published".)
- A building name is shown only if it can be sourced. Names live in
  `data/building_names.json` with a `source` per entry, and Cobalt entries
  were only accepted when the campus Cobalt records for the building matches
  the campus of the timetable classes that meet there.
- An hour of classroom availability is shown as "unknown" unless the space
  database published it. The snapshot includes 13:00; the published band is
  continuous. If a future capture drops an hour, show it as unknown.

## Getting set up

The toolchain runs on **Windows** here. `node_modules` is a Windows install,
so npm, Next and uv all have to run through `cmd.exe` — running them from
WSL fails on the missing native binary.

```cmd
cd class_finder
npm install
npm run dev
```

The Python side:

```cmd
cd scraper
uv sync
uv run pytest
```

## Before you open a pull request

```cmd
npm run lint
npm run scraper:test
npm test
npm run data:verify
npm run data:size
npm run build
npx playwright test
```

If you changed the scraper, also regenerate the dataset and commit it:

```cmd
npm run data:build
```

`npm run data:build` must report `course rows fetched : 7383 (expected
7383)`. If it does not, the fetch is incomplete and the dataset must not be
committed. The dataset is written one file per campus key into `data/campus/`,
and `npm run data:size` checks that the gzipped payload for the default
campus stays under 150 KB.

## Changing the UI

The design intent is a faithful, calm, dark interface. Two things matter more
than polish:

1. **Say what the data is.** If a number comes from a dated snapshot, the
   interface says so. The banner above the classroom list explains the
   snapshot week and the published hours.
2. **Keep the pure logic pure.** Anything that can be a function goes in
   `src/components/lib/schedule.ts`, which touches no browser API and is
   unit-tested in `tests/unit/schedule.test.ts`.

## Reporting a data problem

Open an issue with the course code, the section, and what the app showed. The
scraper has fixtures for the API responses, so a data bug is usually a bug
in `scraper/src/uoft_scraper/parse.py` with a test to prove it.
