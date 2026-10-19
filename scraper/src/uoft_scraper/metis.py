"""Parse the official UTM Classroom Space Database (Metis).

The file lists, for every hour of a given week, the rooms that are
*available* in that hour. A room that is not listed for an hour is therefore
booked for that hour. That inference is the only occupancy signal UofT
publishes, and it is recorded here explicitly rather than being assumed
elsewhere.

Two properties of the data are handled carefully:

* The snapshot covers a single week. The weekday of each date is derived
  from the ISO date itself — no hard-coded date-to-weekday table.
* The Metis form has no row for 13:00, so the occupancy of the 13:00 hour
  is **unknown**, not "free". Missing hours are reported in the dataset so
  the UI can say so instead of silently claiming a room is available.
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

    # Hours the Metis form does not publish at all (13:00 in the 2026-27
    # Fall snapshot). Their occupancy is unknown, not free.
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
