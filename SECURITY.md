# Security Policy

## Reporting a vulnerability

Please report security issues privately through **GitHub Security Advisories**
on this repository ("Security" → "Report a vulnerability"). Do not open a
public issue for an exploitable problem.

Include what an attacker could do, the steps to reproduce it, and the affected
file or route if you know it. You should get an acknowledgement within a few
days.

## What this app touches

- **No accounts, no cookies, no tracking, no analytics.** The app stores
  nothing about you.
- **No database.** Everything is served from a static dataset in `data/`.
- **The dataset is committed to the repository.** It is a dated snapshot of
  public University of Toronto timetable and classroom data. It contains
  course codes, section names, times, building codes and instructor names —
  all of which are published in the UofT timetable for students to see.
- **Outbound request paths:** the scraper and capture scripts call the UofT
  timetable API, the UTM space database, the St. George Space Management
  portal (`lsm.utoronto.ca`, with a signed-in session cookie), the
  Scarborough Registrar schedule service (`intranet.utsc.utoronto.ca`), and
  the Scarborough IITS classroom pages (`utsc.utoronto.ca/iits`). They run
  manually, not on a schedule, and `npm run data:build` makes a few hundred
  requests at a polite pace. The app itself reads the committed snapshot,
  but it loads Font Awesome from `cdnjs.cloudflare.com`; there is no
  analytics or other third-party request.

## Known limitations

- The timetable API publishes **no room numbers** for the 2026-27 sessions.
  The app says "room not published" rather than inventing one. That is a
  data limitation, not a vulnerability, but be aware that any tool claiming
  to know your room number for those sessions is guessing.
- Classroom availability comes from a **single snapshot week**. It is not a
  live feed, and the app labels it as such.
- `data/` is a snapshot. If a class is cancelled after the snapshot was
  taken, the app will not know until the dataset is regenerated.
