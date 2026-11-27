# MADLab Public Room-Availability Feed

## What it is
A public JSON feed published by the University of Toronto's MADLab (Mobile Application Development Lab) and LSM (Learning Space Management). It powers the "UofT Synchronous Space Finder" mobile app (App Store id1584199861, Android `com.utoronto.uoftroomavailability`).

No login or authentication is required.

## Source URLs
| File | Campus | Description |
|------|--------|-------------|
| `https://madlab01.act.utoronto.ca/RoomAvailability/lsm_buildings-v2.json` | St. George (UTSG) | Buildings + room metadata (capacity, accessibility, photos, coordinates) |
| `https://madlab01.act.utoronto.ca/RoomAvailability/lsm_query-v2.json` | St. George (UTSG) | Free room-hours (rolling ~3 school days) |
| `https://madlab01.act.utoronto.ca/RoomAvailability/lsm_buildings-utsc-v2.json` | Scarborough (UTSC) | Buildings + room metadata |
| `https://madlab01.act.utoronto.ca/RoomAvailability/lsm_query-utsc-v2.json` | Scarborough (UTSC) | Free room-hours (rolling ~3 school days) |

Photo base URL: `https://lsm.utoronto.ca/images/Photos/Website/RoomViews` + the `photoN` path from buildings file.

## Refresh schedule
The feed is regenerated nightly around **04:00 Toronto time (09:00 UTC)**. All four files share a `Last-Modified` header (e.g., `Fri, 27 Nov 2026 09:03 GMT`).

Our CI job (`refresh-data.yml`) runs at **06:17 UTC daily**, so it captures the fresh feed.

## Data shape

### Buildings file
```json
{
  "items": [
    {
      "bd_code": "UC",
      "bd_name": "University College",
      "bd_address": "15 King's College Circle Toronto, Ontario M5S 3H7",
      "bd_marker": "43.663,-79.395",
      "rooms": [
        {
          "room_number": "44",
          "capacity": 15,
          "wheelchair_accessible": "Y",
          "room_link": "https://lsm.utoronto.ca/webapp/f?p=210:1:::::P1_BLDG,P1_ROOM:UC,44",
          "links": [{ "photo1": "/UC/UC44/UC44_View1.JPG", ... }]
        }
      ]
    }
  ]
}
```

### Query file
```json
{
  "items": [
    { "book_date": 261127, "building": "AA", "room": "112", "time": "08:00" }
  ]
}
```
- `book_date`: YYMMDD (e.g., `261127` = 2026-11-27)
- `time`: Hour slot, 08:00–21:00. One row = that room is **free** for that hour.
- A room-hour **not listed** on a covered date is **not free** (booked).
- A date **not in the feed** is absent; we never claim a room is free on an uncovered date.

## What we archive
Raw files (diff-friendly):
- `data/sources/madlab/lsm_buildings-v2.json`
- `data/sources/madlab/lsm_query-v2.json`
- `data/sources/madlab/lsm_buildings-utsc-v2.json`
- `data/sources/madlab/lsm_query-utsc-v2.json`

Room details (metadata only, no occupancy):
- `data/room-details/UTSG.json`
- `data/room-details/UTSC.json`

St. George availability candidates (only when query has rows):
- `data/room-candidates/UTSG-madlab.json`

## Caveats
1. **St. George availability is currently empty**. The `lsm_query-v2.json` file has `"items": [], "count": 0` as of the last check. The feed may only populate during certain periods (exam season, etc.). No Wayback Machine captures exist to determine the pattern.

2. **Rolling 3-school-day window**. The UTSC query typically covers ~3 school days (e.g., Fri, Mon, Tue), not a full week.

3. **No UTM (Mississauga) file**. The feed only covers St. George and Scarborough.

4. **The backing ORDS service requires login**. The JSON files are exports of `https://lsm.utoronto.ca/ws/package/onlinesync/{buildings,query,buildings-dev,query-dev}`, which returns HTTP 401 without a UTORid + Duo. We only use the public JSON exports.

5. **St. George room IDs differ from the booking portal**. The booking portal (`lsm.utoronto.ca/ords/f?p=171`) uses a different room list. MADLab rooms should be treated as a separate source until a human decides to switch.

## Integration with the app
- Room details (capacity, wheelchair access, photos, maps) are shown in the UI where room cards/details are rendered.
- UTSC availability from this feed could supplement or replace the Registrar scrape in the future.
- St. George availability is written to `data/room-candidates/UTSG-madlab.json` only when the query has rows. A human must review and decide whether to promote it to `data/rooms/UTSG.json`.