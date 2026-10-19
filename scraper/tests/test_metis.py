"""Tests for the UTM Classroom Space Database parser."""

from __future__ import annotations

import datetime as dt

from uoft_scraper.metis import parse_metis


def test_weekday_is_derived_from_the_iso_date(metis_sample):
    """No hard-coded date-to-weekday table: 2026-09-30 is a Wednesday."""
    snapshot = parse_metis(metis_sample)

    assert snapshot.days[3] == "2026-09-30"  # Wednesday
    assert snapshot.days[4] == "2026-10-01"  # Thursday
    assert dt.date.fromisoformat(snapshot.days[3]).isoweekday() == 3


def test_the_thirteenth_hour_is_reported_as_missing(metis_sample):
    """The Metis form has no 13:00 row, so 13:00 occupancy is unknown."""
    snapshot = parse_metis(metis_sample)

    assert snapshot.hours_missing == (13,)


def test_missing_hours_are_not_claimed_to_be_free(metis_sample):
    snapshot = parse_metis(metis_sample)

    for room in snapshot.rooms:
        for day, hours in room.occupancy.items():
            assert 13 not in hours, "13:00 must be absent, not 'free'"
            assert room.hours_missing == (13,)


def test_rooms_absent_from_an_hour_are_booked(metis_sample):
    """A room listed for an hour is free; a room not listed is booked."""
    snapshot = parse_metis(metis_sample)

    raw = metis_sample["byDateAndHour"]
    iso = "2026-09-30"
    listed = {row[4].strip().upper() for row in raw[iso]["10"]}
    assert listed, "fixture should list rooms for Wednesday 10:00"

    for room in snapshot.rooms:
        busy = room.occupancy[3][10]
        assert busy is (room.room not in listed)


def test_room_inventory_is_complete(metis_sample):
    snapshot = parse_metis(metis_sample)

    assert len(snapshot.rooms) == 65
    assert all(room.capacity for room in snapshot.rooms)
    assert {room.building for room in snapshot.rooms} == {"MN", "IB", "DH", "CC", "DV", "KN"}


def test_snapshot_week_is_reported(metis_sample):
    snapshot = parse_metis(metis_sample)

    assert snapshot.week_start == "2026-09-30"
    assert snapshot.week_end == "2026-10-01"


def test_rooms_serialise_with_string_keys(metis_sample):
    snapshot = parse_metis(metis_sample)
    payload = snapshot.rooms[0].to_json()

    assert all(isinstance(day, str) for day in payload["occupancy"])
    assert all(isinstance(hour, str) for hours in payload["occupancy"].values() for hour in hours)
