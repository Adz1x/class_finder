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
BUILDING_NAMES: dict[str, str] = {
    # UTM
    "MN": "Maanjiwe Nendamowinan",
    "IB": "Instructional Centre (UTM)",
    "DH": "Deerfield Hall",
    "CC": "Communication, Culture and Technology (CCIT)",
    "DV": "William G. Davis Building",
    "KN": "Kaneff Centre / Innovation Complex",
    "NE": "North Building",
    "HB": "Hazel McCallion Academic Learning Centre",
    "SH": "Science Building (UTM)",
    # UTSG
    "BA": "Bahen Centre for Information Technology",
    "SS": "Sidney Smith Hall",
    "MP": "McLennan Physical Laboratories",
    "MS": "Medical Sciences Building",
    "MY": "Myhal Centre for Engineering Innovation",
    "GB": "Galbraith Building",
    "SF": "Sandford Fleming Building",
    "WB": "Wallberg Building",
    "UC": "University College",
    "VC": "Victoria College (Old Vic)",
    "NF": "Northrop Frye Hall",
    "CR": "Carr Hall",
    "BR": "Brennan Hall",
    "RW": "Ramsay Wright Laboratories",
    "ES": "Earth Sciences Centre",
    "LM": "Lash Miller Chemical Laboratories",
    "EX": "Exam Centre",
    "OI": "OISE",
    "WI": "Wilson Hall (New College)",
    "WE": "Wetmore Hall (New College)",
    "IN": "Innis College",
    "WW": "Woodsworth College",
    "BL": "Claude T. Bissell Building",
    "PB": "Leslie Dan Pharmacy Building",
    "AB": "Astronomy and Astrophysics Building",
    # UTSC
    "IC": "Instructional Centre (UTSC)",
    "IA": "Sam Ibrahim Building",
    "HL": "Highland Hall",
    "KW": "Kina Wiiya Enadong Building",
    "BV": "Bladen Wing",
    "HW": "Humanities Wing",
    "MW": "Social Sciences Building",
    "SW": "Science Wing (UTSC)",
    "SY": "Environmental Science & Chemistry Building",
    "AA": "Arts & Administration Building",
    "AC": "Academic Resource Centre",
}

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
