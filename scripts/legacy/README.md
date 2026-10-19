# Legacy scripts

These are the one-off diagnostic scripts that were written while working out how
the UofT timetable API behaves. They are kept for reference — they are **not**
part of the build and nothing in the app imports them.

Most of them probe a single question, for example:

| Script | Question it answered |
|---|---|
| `diagnose_api.py`, `inspect_api.py`, `test_ttb_endpoints.py` | Which endpoints exist and what shape do they return? |
| `check_mn_rooms.py`, `check_mn_rooms2.py`, `search_3210.py` | Does the API publish room numbers? (It does not.) |
| `test_api_campus_filter.py`, `test_api_variants.py` | How do the `campuses` and `divisions` filters behave? |
| `test_full_scrape.py`, `test_scraper_dryrun.py` | How much of the catalogue does one scrape actually reach? |
| `scrape_uoft.py.py` | The previous scraper. Superseded by `scraper/`. |

The conclusions they produced are now encoded in `scraper/src/uoft_scraper/`:

- the API caps pages at 20 rows regardless of the requested `pageSize`;
- `building.buildingRoomNumber` is empty for every meeting;
- `course.code` already contains the section code, and `course.sectionCode` is the
  session;
- the campus comes from `course.campus`, not from the faculty.
