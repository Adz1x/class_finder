"""End-to-end tests for building the dataset from saved API payloads."""

from __future__ import annotations

import json

from uoft_scraper.api import TtbClient
from uoft_scraper.build import build_dataset
from uoft_scraper.metis import parse_metis
from uoft_scraper.parse import parse_courses


def rows_of(payload: dict) -> list[dict]:
    return payload["payload"]["pageableCourse"]["courses"]


def make_client(page_001: dict, isp100h5: dict) -> TtbClient:
    """A client that serves two saved pages and reports their combined total."""
    total = len(rows_of(page_001)) + len(rows_of(isp100h5))

    def transport(endpoint, payload, timeout, user_agent):
        page = payload["page"]
        source = page_001 if page == 1 else isp100h5
        if page > 2:
            return {"payload": {"pageableCourse": {"courses": [], "total": total}}}
        # The saved fixtures carry the real catalogue total; the synthetic
        # catalogue served here is just those rows.
        return {
            "payload": {
                "pageableCourse": {
                    "courses": rows_of(source),
                    "total": total,
                }
            }
        }

    return TtbClient(transport=transport)


def test_dataset_contains_the_users_own_class(page_001, isp100h5, metis_sample):
    """ISP100H5 must be present - it was missing from the previous dataset."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    codes = {meeting.course_code for meeting in result.meetings}
    assert "ISP100H5" in codes

    meetings = [m for m in result.meetings if m.course_code == "ISP100H5"]
    assert meetings
    for meeting in meetings:
        assert meeting.building_code == "MN"
        assert meeting.room is None


def test_no_meeting_ever_carries_an_invented_room(page_001, isp100h5, metis_sample):
    """Every room in the dataset must have been published by the source."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    published_rooms = {
        (meeting.get("building") or {}).get("buildingRoomNumber")
        for payload in (page_001, isp100h5)
        for row in rows_of(payload)
        for section in row.get("sections") or []
        for meeting in section.get("meetingTimes") or []
    }
    published_rooms.discard("")
    published_rooms.discard(None)

    for meeting in result.meetings:
        if meeting.room is not None:
            assert meeting.room in published_rooms


def test_snapshot_reports_provenance(page_001, isp100h5, metis_sample):
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    snapshot = result.snapshot
    assert snapshot.course_rows_fetched == snapshot.course_rows_expected == 22
    assert snapshot.class_meetings == len(result.meetings)
    assert snapshot.snapshot_week_start == "2026-09-30"
    assert snapshot.snapshot_week_end == "2026-10-01"
    assert snapshot.meetings_with_published_room == 0


def test_campus_comes_from_the_api_field(page_001, isp100h5, metis_sample):
    """A St. George course is UTSG even when it meets in a UTM building."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    keys = {meeting.campus_key for meeting in result.meetings}
    assert "UTSG" in keys
    assert "UTM" in keys
    for meeting in result.meetings:
        if meeting.campus == "St. George":
            assert meeting.campus_key == "UTSG"
        if meeting.campus == "University of Toronto at Mississauga":
            assert meeting.campus_key == "UTM"


def test_deep_pages_are_covered(page_037):
    """Rows beyond the old scraper's 148-page cutoff still parse."""
    meetings = parse_courses(rows_of(page_037))

    assert meetings
    assert all(meeting.course_code for meeting in meetings)


def test_json_payload_shape(page_001, isp100h5, metis_sample):
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    payload = result.meetings[0].to_json()
    assert set(payload) == {
        "courseCode",
        "courseTitle",
        "sectionName",
        "sectionType",
        "sectionNumber",
        "teachMethod",
        "instructors",
        "campus",
        "campusKey",
        "facultyCode",
        "session",
        "sessionCode",
        "day",
        "start",
        "end",
        "buildingCode",
        "buildingName",
        "room",
    }
    json.dumps(payload)  # must be serialisable
