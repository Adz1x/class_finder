"""Tests for the TTB API client.

The regression these guard against is the one that cost 60% of the
catalogue: the server caps pages at 20 rows whatever ``pageSize`` says, and
the previous client computed the page count from the page size it had
*requested* instead of from the rows it actually received.
"""

from __future__ import annotations

import math

import pytest

from uoft_scraper.api import SERVER_PAGE_SIZE, TtbClient, TtbError


def synthetic_transport(total: int, rows_per_page: int = SERVER_PAGE_SIZE):
    """Serve a synthetic catalogue and record which pages were requested."""
    rows = [
        {"code": f"TST{index:05d}H1", "sectionCode": "F", "sections": []}
        for index in range(total)
    ]
    requested: list[int] = []

    def transport(endpoint, payload, timeout, user_agent):
        assert endpoint == "getPageableCourses"
        page = payload["page"]
        requested.append(page)
        start = (page - 1) * rows_per_page
        return {
            "payload": {
                "pageableCourse": {
                    "courses": rows[start : start + rows_per_page],
                    "total": total,
                }
            }
        }

    return transport, requested


def test_page_count_is_derived_from_rows_returned_not_page_size():
    """7383 rows at 20 rows per page needs 370 pages, not 148."""
    total = 7383
    transport, requested = synthetic_transport(total)
    client = TtbClient(transport=transport)

    courses = client.fetch_all_courses()

    assert len(courses) == total
    assert len(requested) == math.ceil(total / SERVER_PAGE_SIZE) == 370
    # The old behaviour: ceil(total / 50).
    assert math.ceil(total / 50) == 148
    assert len(requested) != math.ceil(total / 50)


def test_every_page_is_fetched_exactly_once():
    transport, requested = synthetic_transport(200)
    client = TtbClient(transport=transport)

    client.fetch_all_courses()

    assert sorted(requested) == list(range(1, 11))


def test_incomplete_fetch_raises_instead_of_returning_partial_data():
    """A truncated catalogue must fail loudly, never be written to disk."""
    rows = [{"code": f"TST{i:05d}H1", "sectionCode": "F", "sections": []} for i in range(5)]

    def transport(endpoint, payload, timeout, user_agent):
        page = payload["page"]
        if page == 1:
            # The API claims 100 rows exist...
            return {"payload": {"pageableCourse": {"courses": rows, "total": 100}}}
        # ...but the following pages come back empty.
        return {"payload": {"pageableCourse": {"courses": [], "total": 100}}}

    client = TtbClient(transport=transport)

    with pytest.raises(TtbError, match="incomplete fetch"):
        client.fetch_all_courses()


def test_duplicate_rows_are_detected():
    """A catalogue that shifts mid-pagination would produce duplicate rows."""

    def transport(endpoint, payload, timeout, user_agent):
        page = payload["page"]
        same = {"code": "DUPE0001H1", "sectionCode": "F", "sections": []}
        return {"payload": {"pageableCourse": {"courses": [same], "total": 3}}}

    client = TtbClient(transport=transport)

    with pytest.raises(TtbError, match="duplicate course rows"):
        client.fetch_all_courses()


def test_empty_catalogue_returns_no_courses():
    def transport(endpoint, payload, timeout, user_agent):
        return {"payload": {"pageableCourse": {"courses": [], "total": 0}}}

    client = TtbClient(transport=transport)

    assert client.fetch_all_courses() == []


def test_fetch_page_exposes_total(page_001):
    client = TtbClient(transport=lambda *args: page_001)

    page = client.fetch_page(1)

    assert page.total == 7383
    assert len(page.courses) == SERVER_PAGE_SIZE


def test_request_payload_requests_the_documented_page_size():
    captured = {}

    def transport(endpoint, payload, timeout, user_agent):
        captured.update(payload)
        return {"payload": {"pageableCourse": {"courses": [], "total": 0}}}

    client = TtbClient(transport=transport, sessions=("20269", "20271"))
    client.fetch_page(1)

    assert captured["pageSize"] == SERVER_PAGE_SIZE
    assert captured["sessions"] == ["20269", "20271"]
    assert captured["page"] == 1
    assert captured["direction"] == "asc"


def test_divisions_are_passed_through():
    captured = {}

    def transport(endpoint, payload, timeout, user_agent):
        captured.update(payload)
        return {"payload": {"pageableCourse": {"courses": [], "total": 0}}}

    client = TtbClient(transport=transport)
    client.fetch_page(1, divisions=("ERIN", "ARTSC"))

    assert captured["divisions"] == ["ERIN", "ARTSC"]


def test_fetch_divisions_returns_reference_list():
    payload = [{"label": "University of Toronto Mississauga", "value": "ERIN"}]

    client = TtbClient(transport=lambda *args: {"payload": payload})

    assert client.fetch_divisions() == payload
