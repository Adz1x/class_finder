"""Parse the official UTM Classroom Space Database (Metis).

The file lists, for every hour of a given week, the rooms that are
*available* in that hour. A room that is not listed for an hour is therefore
booked for that hour. That inference is the only occupancy signal UofT
publishes, and it is recorded here explicitly rather than being assumed
elsewhere.

Two properties of the data are handled carefully:

* The snapshot covers a single week. The weekday of each date is derived
  from the ISO date itself — no hard-coded date-to-weekday table.
* An hour the snapshot does not carry is **unknown**, not "free". The
  University emits a "no rooms available" row for an hour it knows about
  but has nothing free for, so an *absent* hour is a gap in the capture
  rather than a fact about the room. Missing hours are reported in the
  dataset so the UI can say so instead of silently claiming a room is
  available.

That second rule earned its keep. The first capture of this data copied
the hour list from the space database's own time selector, and that
selector omits 13:00 — so the snapshot had a hole at 1 PM and the hole was
reported as a fact about the University. The server publishes 13:00 quite
happily; the capture simply never asked for it. The published band is
07:00–20:00 with no gap in it.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import Room
from .parse import building_name


@dataclass(frozen=True)
class MetisSnapshot:
    """A parsed Metis space database."""

    week_start: str
    week_end: str
    days: dict[int, str]
    rooms: tuple[Room, ...]
    hours_missing: tuple[int, ...]


def load_metis(path: str | Path) -> dict[str, Any]:
    """Read the Metis JSON file."""
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_metis(raw: dict[str, Any]) -> MetisSnapshot:
    """Turn the raw Metis payload into rooms with occupancy."""
    by_date = raw.get("byDateAndHour") or {}
    if not by_date:
        raise ValueError("Metis payload has no 'byDateAndHour' data")

    dates = sorted(by_date)
    days: dict[int, str] = {}
    for iso_date in dates:
        weekday = dt.date.fromisoformat(iso_date).isoweekday()
        days[weekday] = iso_date

    capacities: dict[str, str] = {}
    building_of: dict[str, str] = {}
    name_of: dict[str, str] = {}

    # For each (date, hour) the rows are the rooms available in that hour.
    available: dict[tuple[int, int], set[str]] = {}
    hours_by_day: dict[int, set[int]] = {}

    for iso_date, hours in by_date.items():
        weekday = dt.date.fromisoformat(iso_date).isoweekday()
        for hour_key, rows in hours.items():
            hour = int(hour_key)
            hours_by_day.setdefault(weekday, set()).add(hour)
            free: set[str] = set()
            for row in rows:
                if len(row) < 6:
                    continue
                building_label = str(row[3]).strip()
                room = str(row[4]).strip().upper()
                capacity = str(row[5]).strip()
                if not room or " " not in room:
                    continue
                free.add(room)
                capacities[room] = capacity
                building_of[room] = room.split(" ")[0]
                name_of[room] = building_label or building_name(building_of[room])
            available[(weekday, hour)] = free

    all_rooms = sorted(capacities)

    # Occupancy is stored per room: room -> weekday -> hour -> is booked.
    occupancy: dict[str, dict[int, dict[int, bool]]] = {
        room: {day: {} for day in days} for room in all_rooms
    }

    for (weekday, hour), free in available.items():
        for room in all_rooms:
            occupancy[room][weekday][hour] = room not in free

    # Hours the snapshot does not carry at all. Their occupancy is unknown,
    # not free: the University answers an hour it knows about with a "no
    # rooms available" row, so a missing hour means the hour was never
    # asked for.
    all_hours = sorted({hour for hours in hours_by_day.values() for hour in hours})
    missing = tuple(
        hour
        for hour in range(min(all_hours), max(all_hours) + 1)
        if hour not in all_hours
    )

    rooms = tuple(
        Room(
            room=room,
            building=building_of[room],
            building_name=name_of[room],
            capacity=capacities[room],
            occupancy={
                day: {hour: occupancy[room][day][hour] for hour in sorted(occupancy[room][day])}
                for day in sorted(occupancy[room])
                if occupancy[room][day]
            },
            hours_missing=missing,
        )
        for room in all_rooms
    )

    return MetisSnapshot(
        week_start=dates[0],
        week_end=dates[-1],
        days=days,
        rooms=rooms,
        hours_missing=missing,
    )


def load_snapshot(path: str | Path) -> MetisSnapshot:
    """Read and parse the Metis space database from disk."""
    return parse_metis(load_metis(path))
