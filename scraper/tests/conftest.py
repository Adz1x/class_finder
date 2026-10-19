"""Shared pytest fixtures.

All tests run against saved API payloads. The only test that touches the
network is marked ``live`` and is deselected by default.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    with open(FIXTURES / name, "r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def page_001() -> dict:
    """First page of the real catalogue (20 rows, total 7383)."""
    return load_fixture("page_001.json")


@pytest.fixture
def page_037() -> dict:
    """A page deep in the catalogue - the range the old scraper never reached."""
    return load_fixture("page_037.json")


@pytest.fixture
def isp100h5() -> dict:
    """The user's own class, as returned by getCoursesByCodeAndSectionCode."""
    return load_fixture("isp100h5.json")


@pytest.fixture
def metis_sample() -> dict:
    """Two days of the official UTM Classroom Space Database."""
    return load_fixture("metis_sample.json")


@pytest.fixture
def edge_row() -> dict:
    """A hand-written row covering cancelled/online/zero-length/published-room cases."""
    return load_fixture("edge_cases_row.json")
