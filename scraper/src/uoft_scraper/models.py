"""Domain models for the class + room dataset.

Design rule that the whole pipeline obeys: **a value is either published by
the source or it is absent.** Nothing here is inferred, guessed or
back-filled. In particular ``ClassMeeting.room`` is ``None`` whenever the
timetable API did not publish a room number, which is the case for every
class in the 2026-27 Fall/Winter sessions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Day-of-week numbering used by the UofT API: 1 = Monday ... 7 = Sunday.
MONDAY = 1
SUNDAY = 7

#: Campus keys used by the UI. The API's ``campus`` field is the source of
#: truth; the building code is a *separate* axis.
CAMPUS_KEYS: dict[str, str] = {
    "St. George": "UTSG",
    "Scarborough": "UTSC",
    "University of Toronto at Mississauga": "UTM",
    "Sheridan College": "SHERIDAN",
    "Centennial College": "CENTENNIAL",
    "Off Campus": "OFF",
}


def campus_key(campus: str | None) -> str:
    """Map an API ``campus`` string onto a short key.

    Unknown campuses become a slug of the campus name rather than being
    dropped, so no data is lost.
    """
    if not campus:
        return "UNKNOWN"
    if campus in CAMPUS_KEYS:
        return CAMPUS_KEYS[campus]
    slug = "".join(ch if ch.isalnum() else "_" for ch in campus.upper())
    return "_".join(part for part in slug.split("_") if part) or "UNKNOWN"


@dataclass(frozen=True)
class ClassMeeting:
    """A single scheduled meeting of a single course section."""

    course_code: str
    course_title: str
    section_name: str
    section_type: str
    section_number: str
    teach_method: str
    instructors: tuple[str, ...]
    campus: str
    campus_key: str
    faculty_code: str
    session: str
    session_code: str
    day: int
    start: str
    end: str
    building_code: str
    building_name: str
    room: str | None

    def to_json(self) -> dict[str, Any]:
        return {
            "courseCode": self.course_code,
            "courseTitle": self.course_title,
            "sectionName": self.section_name,
            "sectionType": self.section_type,
            "sectionNumber": self.section_number,
            "teachMethod": self.teach_method,
            "instructors": list(self.instructors),
            "campus": self.campus,
            "campusKey": self.campus_key,
            "facultyCode": self.faculty_code,
            "session": self.session,
            "sessionCode": self.session_code,
            "day": self.day,
            "start": self.start,
            "end": self.end,
            "buildingCode": self.building_code,
            "buildingName": self.building_name,
            "room": self.room,
        }


@dataclass(frozen=True)
class Room:
    """A classroom, with the occupancy of the snapshot week it was published for."""

    room: str
    building: str
    building_name: str
    capacity: str
    occupancy: dict[int, dict[int, bool]]
    hours_missing: tuple[int, ...] = ()
    #: The campus the classroom belongs to. Metis is UTM's classroom space
    #: database, so every room in the inventory is a UTM classroom.
    campus_key: str = "UTM"

    def to_json(self) -> dict[str, Any]:
        return {
            "room": self.room,
            "building": self.building,
            "buildingName": self.building_name,
            "capacity": self.capacity,
            "campusKey": self.campus_key,
            "occupancy": {
                str(day): {str(hour): busy for hour, busy in sorted(hours.items())}
                for day, hours in sorted(self.occupancy.items())
            },
            "hoursMissing": list(self.hours_missing),
        }


@dataclass(frozen=True)
class Snapshot:
    """Provenance of a generated dataset."""

    generated_at: str
    sessions: tuple[str, ...]
    snapshot_week_start: str
    snapshot_week_end: str
    snapshot_week_days: tuple[int, ...]
    course_rows_fetched: int
    course_rows_expected: int
    class_meetings: int
    rooms: int
    meetings_with_published_room: int
    divisions: tuple[str, ...]
    source_urls: dict[str, str]
    #: Meeting times the API published before any filter was applied. The
    #: difference against ``class_meetings`` is the filter funnel, so it has
    #: to be recorded rather than remembered.
    raw_meeting_times_seen: int = 0
    #: How many meetings each campus key holds. The per-campus files must
    #: match this exactly, so the split can never drift from the totals.
    campus_breakdown: dict[str, int] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "generatedAt": self.generated_at,
            "sessions": list(self.sessions),
            "snapshotWeekStart": self.snapshot_week_start,
            "snapshotWeekEnd": self.snapshot_week_end,
            "snapshotWeekDays": list(self.snapshot_week_days),
            "courseRowsFetched": self.course_rows_fetched,
            "courseRowsExpected": self.course_rows_expected,
            "classMeetings": self.class_meetings,
            "rooms": self.rooms,
            "meetingsWithPublishedRoom": self.meetings_with_published_room,
            "divisions": list(self.divisions),
            "sourceUrls": self.source_urls,
            "rawMeetingTimesSeen": self.raw_meeting_times_seen,
            "campusBreakdown": dict(sorted(self.campus_breakdown.items())),
        }
