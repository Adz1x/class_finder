"""Turn raw ``getPageableCourses`` rows into :class:`ClassMeeting` records.

Parsing rules, all of them verified against the live API:

* ``course.code`` already carries the full course **and section** code
  (``ISP100H5``, ``CSC108H1``, ``ABP102Y1``). It is used verbatim.
* ``course.sectionCode`` is the **session** (``F`` / ``S`` / ``Y``), *not* the
  section number. It is kept as its own field and never concatenated onto
  the course code.
* The section number lives in ``sections[].sectionNumber`` and the section
  label in ``sections[].name`` (``LEC0104``).
* ``building.buildingRoomNumber`` is an **empty string for every meeting**.
  The room is therefore ``None`` unless the source publishes one. Rooms are
  never guessed.
* Cancelled sections (``cancelInd == "Y"``) and meetings without a building,
  a day, or a positive duration are dropped.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from .models import ClassMeeting, campus_key

#: Building codes that mean "not in a physical classroom".
NON_PHYSICAL_BUILDINGS = frozenset(
    {
        "ON",
        "OFF",
        "TBA",
        "ONL",
        "NULL",
        "NONE",
        "NOTE",
        "SYNC",
        "ASYNC",
        "INTERNET",
        "DIST",
        "ZZ",
    }
)

#: Building names we are confident about. Anything else is reported as
#: "Name not listed" by the UI rather than invented.
#:
#: The table lives in ``data/building_names.json`` so that every name carries
#: a source and can be audited. Names from Cobalt (the University of Toronto's
#: own open-data project) were only accepted where the campus Cobalt records
#: for the building matches the campus of the timetable classes that meet
#: there - see the generator that produced the file.
_BUILDING_NAMES_PATH = Path(__file__).resolve().parents[3] / "data" / "building_names.json"


def _load_building_names() -> dict[str, str]:
    try:
        payload = json.loads(_BUILDING_NAMES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    buildings = payload.get("buildings") or {}
    return {
        code: str(entry["name"])
        for code, entry in buildings.items()
        if isinstance(entry, dict) and entry.get("name")
    }


BUILDING_NAMES: dict[str, str] = _load_building_names()

#: Milliseconds per hour, used to turn ``millisofday`` into a clock time.
MS_PER_HOUR = 3_600_000


def millis_to_clock(millis: int) -> str:
    """Convert a millisecond-of-day value into a ``HH:MM`` string."""
    minutes = int(millis // 60_000)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def building_name(code: str) -> str:
    """Return a human name for a building code, without inventing one."""
    return BUILDING_NAMES.get(code, f"{code} Building")


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _instructor_names(section: dict[str, Any]) -> tuple[str, ...]:
    names: list[str] = []
    for instructor in section.get("instructors") or []:
        full = _clean(instructor.get("firstName")) + " " + _clean(instructor.get("lastName"))
        full = full.strip()
        if full:
            names.append(full)
    return tuple(names)


def parse_course_row(row: dict[str, Any]) -> list[ClassMeeting]:
    """Parse one ``getPageableCourses`` row into zero or more meetings."""
    course_code = _clean(row.get("code"))
    if not course_code:
        return []

    course_title = _clean(row.get("name"))
    campus = _clean(row.get("campus"))
    faculty_code = _clean((row.get("faculty") or {}).get("code"))
    session = _clean(row.get("sectionCode"))

    meetings: list[ClassMeeting] = []
    for section in row.get("sections") or []:
        if _clean(section.get("cancelInd")).upper() == "Y":
            continue

        section_name = _clean(section.get("name"))
        section_type = _clean(section.get("type"))
        section_number = _clean(section.get("sectionNumber"))
        teach_method = _clean(section.get("teachMethod"))
        instructors = _instructor_names(section)

        for meeting in section.get("meetingTimes") or []:
            building = meeting.get("building") or {}
            building_code = _clean(building.get("buildingCode")).upper()
            if not building_code or building_code in NON_PHYSICAL_BUILDINGS:
                continue

            # The API publishes no room numbers. Keep whatever it gives us,
            # and keep nothing when it gives us an empty string.
            raw_room = _clean(building.get("buildingRoomNumber"))
            room = raw_room or None

            start = meeting.get("start") or {}
            end = meeting.get("end") or {}
            day = start.get("day")
            start_millis = start.get("millisofday")
            end_millis = end.get("millisofday")
            if not day or start_millis is None or end_millis is None:
                continue
            if end_millis <= start_millis:
                continue

            published_name = _clean(building.get("buildingName"))
            meetings.append(
                ClassMeeting(
                    course_code=course_code,
                    course_title=course_title,
                    section_name=section_name,
                    section_type=section_type,
                    section_number=section_number,
                    teach_method=teach_method,
                    instructors=instructors,
                    campus=campus,
                    campus_key=campus_key(campus),
                    faculty_code=faculty_code,
                    session=session,
                    session_code=_clean(meeting.get("sessionCode")),
                    day=int(day),
                    start=millis_to_clock(int(start_millis)),
                    end=millis_to_clock(int(end_millis)),
                    building_code=building_code,
                    building_name=published_name or building_name(building_code),
                    room=room,
                )
            )
    return meetings


def count_raw_meeting_times(rows: Iterable[dict[str, Any]]) -> int:
    """Count every ``meetingTimes`` entry the API published, before filtering.

    The difference between this and the number of meetings that survive the
    filters is the filter funnel. It has to be measured, not remembered: the
    README and the project report both cite it, and a number nobody can
    reproduce is not a number worth citing.
    """
    total = 0
    for row in rows:
        for section in row.get("sections") or []:
            total += len(section.get("meetingTimes") or [])
    return total


def parse_courses(rows: Iterable[dict[str, Any]]) -> list[ClassMeeting]:
    """Parse many rows, dropping exact duplicates."""
    seen: set[tuple[Any, ...]] = set()
    meetings: list[ClassMeeting] = []
    for row in rows:
        for meeting in parse_course_row(row):
            key = (
                meeting.course_code,
                meeting.session_code,
                meeting.section_name,
                meeting.day,
                meeting.start,
                meeting.end,
                meeting.building_code,
                meeting.room,
            )
            if key in seen:
                continue
            seen.add(key)
            meetings.append(meeting)
    return meetings
