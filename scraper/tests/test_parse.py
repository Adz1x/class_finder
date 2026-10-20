"""Tests for parsing raw catalogue rows into class meetings."""

from __future__ import annotations

from uoft_scraper.parse import (
    BUILDING_NAMES,
    measure_funnel,
    millis_to_clock,
    parse_course_row,
    parse_courses,
)


def rows_of(payload: dict) -> list[dict]:
    return payload["payload"]["pageableCourse"]["courses"]


def test_course_code_is_used_verbatim(isp100h5):
    """`course.code` already contains the section code. It is never extended.

    The old scraper appended the *session* letter, producing labels like
    "ISP100H5F" that no student would ever type.
    """
    meetings = parse_courses(rows_of(isp100h5))

    assert meetings
    codes = {meeting.course_code for meeting in meetings}
    assert codes == {"ISP100H5"}
    assert "ISP100H5F" not in codes


def test_section_metadata_is_preserved(isp100h5):
    meetings = parse_courses(rows_of(isp100h5))

    lec = next(m for m in meetings if m.section_name == "LEC0106")
    assert lec.section_number == "0106"
    assert lec.section_type == "Lecture"
    assert lec.teach_method == "LEC"
    assert lec.course_title == "Writing for University and Beyond"
    assert lec.instructors == ("Kathryn Franklin",)


def test_the_users_own_class_is_parsed_correctly(isp100h5):
    """ISP100H5 meets in MN at 12:00 on Monday."""
    meetings = parse_courses(rows_of(isp100h5))

    monday_noon = [
        m
        for m in meetings
        if m.day == 1 and m.start == "12:00" and m.end == "15:00"
    ]
    assert monday_noon, "expected Monday 12:00-15:00 meetings"
    for meeting in monday_noon:
        assert meeting.building_code == "MN"
        assert meeting.campus_key == "UTM"
        assert meeting.campus == "University of Toronto at Mississauga"


def test_room_is_none_when_the_api_publishes_none(isp100h5):
    """The API never publishes room numbers. They must not be invented."""
    meetings = parse_courses(rows_of(isp100h5))

    assert all(meeting.room is None for meeting in meetings)


def test_no_meeting_in_the_catalogue_carries_an_invented_room(page_001, page_037):
    for payload in (page_001, page_037):
        for meeting in parse_courses(rows_of(payload)):
            assert meeting.room is None


def test_cancelled_sections_are_dropped(edge_row):
    meetings = parse_courses([edge_row])

    section_names = {m.section_name for m in meetings}
    assert "TUT0102" not in section_names  # cancelInd == "Y"


def test_online_meetings_are_dropped(edge_row):
    meetings = parse_courses([edge_row])

    assert "SEM0103" not in {m.section_name for m in meetings}  # building "ON"


def test_zero_length_meetings_are_dropped(edge_row):
    meetings = parse_courses([edge_row])

    assert "PRC0104" not in {m.section_name for m in meetings}  # end <= start


def test_published_rooms_are_kept_when_the_source_provides_them(edge_row):
    meetings = parse_courses([edge_row])

    lec = next(m for m in meetings if m.section_name == "LEC0105")
    assert lec.room == "1085"
    assert lec.building_code == "SS"


def test_building_names_are_not_invented():
    assert BUILDING_NAMES["MN"] == "Maanjiwe Nendamowinan"
    # An unknown code keeps its code rather than claiming a name.
    from uoft_scraper.parse import building_name

    assert building_name("ZZZ") == "ZZZ Building"


def test_millis_to_clock():
    assert millis_to_clock(0) == "00:00"
    assert millis_to_clock(43_200_000) == "12:00"
    assert millis_to_clock(54_000_000) == "15:00"
    assert millis_to_clock(32_400_000) == "09:00"
    assert millis_to_clock(37_800_000) == "10:30"


def test_session_is_kept_separate_from_the_course_code():
    row = {
        "code": "CSC108H1",
        "sectionCode": "F",
        "name": "Introduction to Computer Science",
        "campus": "St. George",
        "faculty": {"code": "ARTSC"},
        "sections": [
            {
                "name": "LEC0101",
                "type": "Lecture",
                "teachMethod": "LEC",
                "sectionNumber": "0101",
                "cancelInd": "N",
                "instructors": [],
                "meetingTimes": [
                    {
                        "start": {"day": 1, "millisofday": 32_400_000},
                        "end": {"day": 1, "millisofday": 37_800_000},
                        "building": {
                            "buildingCode": "BA",
                            "buildingRoomNumber": "",
                            "buildingName": None,
                        },
                        "sessionCode": "20269",
                    }
                ],
            }
        ],
    }

    (meeting,) = parse_course_row(row)

    assert meeting.course_code == "CSC108H1"
    assert meeting.session == "F"
    assert meeting.session_code == "20269"
    assert meeting.campus_key == "UTSG"
    assert meeting.room is None


def test_the_funnel_accounts_for_every_meeting_time(page_001, isp100h5):
    """The project report quotes this funnel, so it has to add up.

    The counter and the parser are two pieces of code. If they ever drift,
    the report would be quoting a fiction - so the test ties them together.
    """
    rows = rows_of(page_001) + rows_of(isp100h5)
    funnel = measure_funnel(rows)

    assert funnel.final == len(parse_courses(rows))
    assert funnel.raw >= funnel.final
    assert (
        funnel.raw
        - funnel.dropped_cancelled
        - funnel.dropped_building
        - funnel.dropped_invalid_time
        - funnel.dropped_duplicate
        == funnel.final
    )
