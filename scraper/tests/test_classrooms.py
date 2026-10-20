"""The classroom inventories the University publishes per campus.

St. George's Space Management service lists every classroom of every St.
George building, with the number of students it seats. The application
publishes that inventory, so it has to be checked like the rest of the
dataset: a file that says it belongs to one campus while sitting in
another, or a classroom with no room number, is a broken file.
"""

from __future__ import annotations

import json
from argparse import Namespace
from pathlib import Path

from uoft_scraper.cli import _verify

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"

MEETING = {
    "campusKey": "UTSG",
    "courseCode": "ISP100H5",
    "sessionCode": "20269",
    "sectionName": "LEC01",
    "day": 1,
    "start": "10:00",
    "end": "11:00",
    "buildingCode": "SS",
    "buildingName": "Sidney Smith Hall",
    "room": None,
    "instructors": [],
}

META = {
    "courseRowsFetched": 1,
    "courseRowsExpected": 1,
    "classMeetings": 1,
    "campusBreakdown": {"UTSG": 1},
    "rooms": 0,
    "sessions": ["20269"],
}


def write_dataset(root: Path, classrooms: dict | None = None) -> Path:
    """A minimal dataset the verifier accepts."""
    (root / "campus").mkdir(parents=True, exist_ok=True)
    (root / "campus" / "UTSG.json").write_text(
        json.dumps([MEETING]), encoding="utf-8"
    )
    (root / "rooms.json").write_text("[]", encoding="utf-8")
    (root / "meta.json").write_text(json.dumps(META), encoding="utf-8")
    if classrooms is not None:
        (root / "classrooms").mkdir(parents=True, exist_ok=True)
        (root / "classrooms" / "UTSG.json").write_text(
            json.dumps(classrooms), encoding="utf-8"
        )
    return root


def verify(root: Path) -> int:
    return _verify(Namespace(data=str(root), live=False))


def test_the_committed_inventory_passes_the_verifier():
    """The dataset that ships is checked by the same code path as a rebuild."""
    assert verify(DATA) == 0


def test_a_valid_inventory_is_accepted(tmp_path):
    inventory = {
        "campus": "UTSG",
        "source": "https://lsm.utoronto.ca/webapp/f?p=210:1",
        "buildings": {"SS": "Sidney Smith Hall"},
        "classrooms": {"SS": [{"room": "2001", "name": None, "capacity": 60}]},
    }
    assert verify(write_dataset(tmp_path, inventory)) == 0


def test_an_inventory_that_names_the_wrong_campus_is_rejected(tmp_path):
    inventory = {
        "campus": "UTM",
        "buildings": {"SS": "Sidney Smith Hall"},
        "classrooms": {"SS": [{"room": "2001", "name": None, "capacity": 60}]},
    }
    assert verify(write_dataset(tmp_path, inventory)) == 1


def test_a_classroom_without_a_room_number_is_rejected(tmp_path):
    inventory = {
        "campus": "UTSG",
        "buildings": {"SS": "Sidney Smith Hall"},
        "classrooms": {"SS": [{"room": "", "name": None, "capacity": 60}]},
    }
    assert verify(write_dataset(tmp_path, inventory)) == 1


def test_a_classroom_with_an_impossible_capacity_is_rejected(tmp_path):
    inventory = {
        "campus": "UTSG",
        "buildings": {"SS": "Sidney Smith Hall"},
        "classrooms": {"SS": [{"room": "2001", "name": None, "capacity": 0}]},
    }
    assert verify(write_dataset(tmp_path, inventory)) == 1
