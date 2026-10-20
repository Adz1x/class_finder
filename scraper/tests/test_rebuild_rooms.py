"""Tests for rebuilding the rooms without refetching the timetable.

The timetable and the space database have different clocks. The timetable is
the whole catalogue; the space database publishes one week at a time. When a
new week of room occupancy arrives, the catalogue should not be refetched -
that would put 370 requests on the University's servers to change one file.
"""

from __future__ import annotations

import json
from argparse import Namespace

from uoft_scraper.api import TtbClient
from uoft_scraper.build import build_dataset, write_dataset
from uoft_scraper.cli import _rebuild_rooms
from uoft_scraper.metis import parse_metis
from uoft_scraper.models import ClassMeeting


def make_client(page_001: dict, isp100h5: dict) -> TtbClient:
    """A client that serves two saved pages and reports their combined total."""
    total = len(rows_of(page_001)) + len(rows_of(isp100h5))

    def transport(endpoint, payload, timeout, user_agent):
        page = payload["page"]
        source = page_001 if page == 1 else isp100h5
        if page > 2:
            return {"payload": {"pageableCourse": {"courses": [], "total": total}}}
        return {
            "payload": {
                "pageableCourse": {
                    "courses": rows_of(source),
                    "total": total,
                }
            }
        }

    return TtbClient(transport=transport)


def rows_of(payload: dict) -> list[dict]:
    return payload["payload"]["pageableCourse"]["courses"]


def _write_capture(path, metis_sample: dict, extra_hour: str) -> None:
    """A capture that includes an hour the space database's selector omits."""
    raw = json.loads(json.dumps(metis_sample))
    for hours in raw["byDateAndHour"].values():
        hours[extra_hour] = [
            "No rooms available. Please see 'More resources' at the top of this page"
        ]
    path.write_text(json.dumps(raw), encoding="utf-8")


def test_a_class_meeting_survives_a_round_trip(tmp_path, page_001, isp100h5, metis_sample):
    """The dataset can be read back without going to the API again."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))
    write_dataset(result, tmp_path)

    rows = json.loads((tmp_path / "campus" / "UTM.json").read_text(encoding="utf-8"))
    meeting = ClassMeeting.from_json(rows[0])

    assert meeting.to_json() == rows[0]


def test_the_rooms_can_be_rebuilt_without_refetching_the_catalogue(
    tmp_path, page_001, isp100h5, metis_sample
):
    """A new week of occupancy must not disturb the catalogue."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))
    write_dataset(result, tmp_path)

    campus_before = (tmp_path / "campus" / "UTM.json").read_bytes()
    rooms_before = json.loads(
        (tmp_path / "rooms" / "UTM.json").read_text(encoding="utf-8")
    )["rooms"]
    assert any(room["hoursMissing"] == [13] for room in rooms_before)

    capture = tmp_path / "metis.json"
    _write_capture(capture, metis_sample, "13")

    assert _rebuild_rooms(
        Namespace(data=str(tmp_path), metis=str(capture))
    ) == 0

    # The catalogue is byte-for-byte what it was.
    assert (tmp_path / "campus" / "UTM.json").read_bytes() == campus_before

    # The hour the first capture missed is published now.
    rooms_after = json.loads(
        (tmp_path / "rooms" / "UTM.json").read_text(encoding="utf-8")
    )["rooms"]
    assert all(room["hoursMissing"] == [] for room in rooms_after)


def test_the_rebuild_refuses_a_catalogue_that_does_not_add_up(
    tmp_path, page_001, isp100h5, metis_sample
):
    """A dataset whose files disagree with its own metadata is not rebuilt."""
    client = make_client(page_001, isp100h5)
    result = build_dataset(client, parse_metis(metis_sample))
    write_dataset(result, tmp_path)

    campus = tmp_path / "campus" / "UTM.json"
    campus.write_text("[]", encoding="utf-8")

    capture = tmp_path / "metis.json"
    _write_capture(capture, metis_sample, "13")

    assert _rebuild_rooms(
        Namespace(data=str(tmp_path), metis=str(capture))
    ) == 1
