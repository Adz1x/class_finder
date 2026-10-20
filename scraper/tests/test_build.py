"""End-to-end tests for building the dataset from saved API payloads."""

from __future__ import annotations

import json

from uoft_scraper.api import TtbClient
from uoft_scraper.build import BuildResult, build_dataset, write_dataset
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


def test_the_dataset_is_written_one_file_per_campus(
    tmp_path, page_001, isp100h5, metis_sample
):
    """The app fetches one campus at a time, so the dataset is stored that way."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))
    write_dataset(result, tmp_path)

    files = sorted((tmp_path / "campus").glob("*.json"))
    assert files, "no campus files were written"
    assert not (tmp_path / "classes.json").exists(), (
        "the single whole-catalogue file is gone: it cost 8.3 MB on first load"
    )

    total = 0
    for path in files:
        rows = json.loads(path.read_text(encoding="utf-8"))
        assert rows, f"{path.name} is empty"
        assert all(row["campusKey"] == path.stem for row in rows)
        total += len(rows)

    # The split must not lose or invent a single meeting.
    assert total == len(result.meetings)

    meta = json.loads((tmp_path / "meta.json").read_text(encoding="utf-8"))
    assert meta["classMeetings"] == total
    assert meta["campusBreakdown"] == {
        path.stem: len(json.loads(path.read_text(encoding="utf-8")))
        for path in files
    }


def test_the_written_dataset_is_deterministic(tmp_path, page_001, isp100h5, metis_sample):
    """The same catalogue must produce the same bytes.

    The API returns rows in a different order on every run, and the scraper
    fetches them in parallel, so without a sort every rebuild would produce
    a different file and `git diff` would be useless.
    """
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    shuffled = BuildResult(
        meetings=list(reversed(result.meetings)),
        rooms=result.rooms,
        snapshot=result.snapshot,
        divisions=result.divisions,
        faculty_breakdown=result.faculty_breakdown,
    )

    write_dataset(result, tmp_path / "a")
    write_dataset(shuffled, tmp_path / "b")

    written = sorted((tmp_path / "a" / "campus").glob("*.json"))
    assert written
    for path in written:
        assert path.read_bytes() == (tmp_path / "b" / "campus" / path.name).read_bytes()


def test_the_raw_meeting_time_count_is_recorded(page_001, isp100h5, metis_sample):
    """The filter funnel has to be measurable, not remembered."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    snapshot = result.snapshot
    assert snapshot.raw_meeting_times_seen >= snapshot.class_meetings
    assert snapshot.raw_meeting_times_seen > 0


def test_every_classroom_belongs_to_a_campus(page_001, isp100h5, metis_sample):
    """The space database publishes UTM's classrooms, so they say so."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))

    for room in result.rooms:
        assert room.campus_key == "UTM"
        assert room.to_json()["campusKey"] == "UTM"
