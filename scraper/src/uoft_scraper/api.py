"""Client for the UofT Timetable Builder (TTB) public API.

Two properties of this API drive the whole design and are the reason the
previous version of this scraper silently dropped 60% of the catalogue:

1.  ``getPageableCourses`` **ignores** the ``pageSize`` you send and always
    returns **20 rows per page**, no matter whether you ask for 10, 50 or
    500. The number of pages therefore has to be derived from the number of
    rows actually returned, not from the page size you requested.
2.  ``payload.pageableCourse.total`` is the authoritative count of rows for
    the current filter. If the number of rows collected does not match it,
    the fetch is incomplete and **must** fail loudly rather than write a
    partial dataset.

The API also never publishes room numbers: ``building.buildingRoomNumber``
is an empty string for every meeting in every session. See ``parse.py``.
"""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Sequence

DEFAULT_BASE_URL = "https://api.easi.utoronto.ca/ttb"
DEFAULT_SESSIONS: tuple[str, ...] = ("20269", "20271")
USER_AGENT = "class-finder/2.0 (+https://github.com/Adz1x/class_finder)"

#: The server caps responses at this many rows. Requesting more is ignored.
SERVER_PAGE_SIZE = 20


class TtbError(RuntimeError):
    """Raised when the API cannot be read completely or consistently."""


@dataclass
class Page:
    """One page of ``getPageableCourses``."""

    courses: list[dict[str, Any]]
    total: int
    page: int


@dataclass
class TtbClient:
    """Small, retrying client for the TTB API.

    The transport is injectable so tests never touch the network.
    """

    base_url: str = DEFAULT_BASE_URL
    sessions: tuple[str, ...] = DEFAULT_SESSIONS
    timeout: float = 45.0
    max_retries: int = 4
    max_workers: int = 8
    user_agent: str = USER_AGENT
    sleep: Callable[[float], None] = time.sleep
    transport: Callable[[str, dict[str, Any], float, str], dict[str, Any]] | None = None

    # ------------------------------------------------------------------ HTTP

    def _post(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.transport is not None:
            return self.transport(endpoint, payload, self.timeout, self.user_agent)

        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/{endpoint}",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": self.user_agent,
            },
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:  # pragma: no cover - network
                detail = exc.read()[:200].decode("utf-8", "replace")
                last_error = TtbError(f"HTTP {exc.code} from {endpoint}: {detail}")
                # 4xx other than 429 will not get better by retrying.
                if exc.code < 500 and exc.code != 429:
                    raise last_error from exc
            except Exception as exc:  # pragma: no cover - network
                last_error = exc
            if attempt < self.max_retries:
                self.sleep(attempt * 1.2)
        raise TtbError(f"GET {endpoint} failed after {self.max_retries} attempts: {last_error}")

    def _get(self, endpoint: str) -> dict[str, Any]:
        if self.transport is not None:
            return self.transport(endpoint, None, self.timeout, self.user_agent)
        request = urllib.request.Request(
            f"{self.base_url}/{endpoint}",
            headers={"Accept": "application/json", "User-Agent": self.user_agent},
            method="GET",
        )
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:  # pragma: no cover - network
                detail = exc.read()[:200].decode("utf-8", "replace")
                last_error = TtbError(f"HTTP {exc.code} from {endpoint}: {detail}")
                if exc.code < 500 and exc.code != 429:
                    raise last_error from exc
            except Exception as exc:  # pragma: no cover - network
                last_error = exc
            if attempt < self.max_retries:
                self.sleep(attempt * 1.2)
        raise TtbError(f"GET {endpoint} failed after {self.max_retries} attempts: {last_error}")

    # --------------------------------------------------------------- payloads

    def _course_payload(self, page: int, divisions: Sequence[str]) -> dict[str, Any]:
        return {
            "courseCodeAndTitleProps": {
                "courseCode": "",
                "courseTitle": "",
                "courseSectionCode": "",
                "searchCourseDescription": False,
            },
            "departmentProps": [],
            "campuses": [],
            "sessions": list(self.sessions),
            "requirementProps": [],
            "instructor": "",
            "courseLevels": [],
            "deliveryModes": [],
            "dayPreferences": [],
            "timePreferences": [],
            "divisions": list(divisions),
            "creditWeights": [],
            "availableSpace": False,
            "waitListable": False,
            "page": page,
            # The server ignores this. It is sent for documentation value only;
            # the real page count is derived from the rows actually returned.
            "pageSize": SERVER_PAGE_SIZE,
            "direction": "asc",
        }

    # ----------------------------------------------------------------- public

    def fetch_page(self, page: int, divisions: Sequence[str] = ()) -> Page:
        """Fetch a single page of courses."""
        raw = self._post("getPageableCourses", self._course_payload(page, divisions))
        pageable = (raw.get("payload") or {}).get("pageableCourse") or {}
        courses = pageable.get("courses") or []
        total = int(pageable.get("total") or 0)
        return Page(courses=courses, total=total, page=page)

    def fetch_all_courses(self, divisions: Sequence[str] = ()) -> list[dict[str, Any]]:
        """Fetch **every** course row for the configured sessions.

        Raises :class:`TtbError` if the collected rows do not match the
        ``total`` the API reported. A partial dataset is never returned.
        """
        first = self.fetch_page(1, divisions)
        total = first.total
        if total <= 0:
            return []
        if not first.courses:
            raise TtbError("API reported rows but returned an empty first page")

        # The server caps the page size, so derive the page count from the
        # number of rows we actually got back.
        per_page = len(first.courses)
        pages = math.ceil(total / per_page)

        courses: list[dict[str, Any]] = list(first.courses)
        if pages > 1:
            with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
                futures = {
                    pool.submit(self.fetch_page, page, divisions): page
                    for page in range(2, pages + 1)
                }
                for future in as_completed(futures):
                    courses.extend(future.result().courses)

        if len(courses) != total:
            raise TtbError(
                f"incomplete fetch: collected {len(courses)} rows but the API "
                f"reported {total} (pages needed: {pages}, rows per page: {per_page})"
            )

        # Rows are keyed by (code, session). A duplicate means the catalogue
        # shifted underneath us and the page boundaries are no longer valid.
        unique: dict[tuple[str, str], dict[str, Any]] = {}
        for course in courses:
            key = (str(course.get("code") or ""), str(course.get("sectionCode") or ""))
            unique[key] = course
        if len(unique) != total:
            raise TtbError(
                f"duplicate course rows: collected {len(courses)} rows but only "
                f"{len(unique)} distinct (code, session) pairs; expected {total}"
            )

        return list(unique.values())

    def fetch_divisions(self) -> list[dict[str, Any]]:
        """Return the list of faculties the API knows about."""
        raw = self._get("getMatchingDivisions")
        payload = raw.get("payload")
        if isinstance(payload, list):
            return payload
        return []

    def fetch_reference_data(self) -> dict[str, Any]:
        """Return session/division/campus reference data."""
        raw = self._get("reference-data")
        payload = raw.get("payload")
        return payload if isinstance(payload, dict) else {}
