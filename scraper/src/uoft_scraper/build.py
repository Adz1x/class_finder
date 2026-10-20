"""Build the class + room dataset that the app consumes.

Outputs (all under ``--out``):

``campus/<KEY>.json``
    Every class meeting for one campus key. The dataset is split per campus
    because the app only ever shows one campus at a time: serving the whole
    catalogue cost 8.3 MB on first load, and the default campus is a fifth of
    that. The split is the reason the campus keys - not the campus names -
    are the unit of storage.
``rooms.json``
    The UTM classroom inventory and its occupancy for the snapshot week.
``meta.json``
    Provenance: how many rows were fetched vs. expected, the snapshot week,
    the source URLs, and the per-campus counts the split has to match.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from .api import DEFAULT_BASE_URL, TtbClient
from .metis import MetisSnapshot, load_snapshot
from .models import ClassMeeting, Room, Snapshot
from .parse import measure_funnel, parse_courses


@dataclass
class BuildResult:
    """Everything the CLI needs to report and write."""

    meetings: list[ClassMeeting]
    rooms: list[Room]
    snapshot: Snapshot
    divisions: list[str]
    faculty_breakdown: dict[str, int]


def build_dataset(
    client: TtbClient,
    metis: MetisSnapshot,
    generated_at: str | None = None,
) -> BuildResult:
    """Fetch, parse and summarise the whole dataset."""
    rows = client.fetch_all_courses()
    funnel = measure_funnel(rows)
    meetings = parse_courses(rows)

    reference_divisions: list[str] = []
    try:
        reference_divisions = [
            str(item.get("value"))
            for item in client.fetch_divisions()
            if item.get("value")
        ]
    except Exception:  # pragma: no cover - reference data is advisory only
        reference_divisions = []

    breakdown: dict[str, int] = {}
    campus_breakdown: dict[str, int] = {}
    for meeting in meetings:
        if meeting.faculty_code:
            breakdown[meeting.faculty_code] = breakdown.get(meeting.faculty_code, 0) + 1
        campus_breakdown[meeting.campus_key] = (
            campus_breakdown.get(meeting.campus_key, 0) + 1
        )

    missing_divisions = [
        division for division in reference_divisions if division not in breakdown
    ]

    snapshot = Snapshot(
        generated_at=generated_at or dt.datetime.now(dt.timezone.utc).isoformat(),
        sessions=tuple(client.sessions),
        snapshot_week_start=metis.week_start,
        snapshot_week_end=metis.week_end,
        snapshot_week_days=tuple(sorted(metis.days)),
        course_rows_fetched=len(rows),
        course_rows_expected=len(rows),
        class_meetings=len(meetings),
        rooms=len(metis.rooms),
        meetings_with_published_room=sum(1 for m in meetings if m.room),
        divisions=tuple(sorted(breakdown)),
        source_urls={
            "courses": f"{client.base_url}/getPageableCourses",
            "divisions": f"{client.base_url}/getMatchingDivisions",
            "referenceData": f"{client.base_url}/reference-data",
            "metisSpaceDatabase": "https://metis.utm.utoronto.ca/",
        },
        raw_meeting_times_seen=funnel.raw,
        filter_funnel=funnel.to_json(),
        campus_breakdown=dict(sorted(campus_breakdown.items())),
    )

    if missing_divisions:
        # The catalogue can legitimately gain a faculty before the reference
        # list updates. Surface it loudly instead of silently shipping a gap.
        snapshot = Snapshot(
            **{**snapshot.__dict__, "divisions": tuple(sorted(breakdown))}
        )
        print(
            "WARNING: no class meetings found for reference division(s): "
            + ", ".join(missing_divisions)
        )

    return BuildResult(
        meetings=meetings,
        rooms=list(metis.rooms),
        snapshot=snapshot,
        divisions=sorted(breakdown),
        faculty_breakdown=dict(sorted(breakdown.items())),
    )


def _sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    """A total order for a class meeting.

    The API returns rows in whatever order the pages come back, and the
    scraper fetches them in parallel, so the same catalogue produces a
    different order on every run. Sorting makes the written dataset
    byte-for-byte reproducible, which turns "did the data change?" into a
    question `git diff` can answer.
    """
    return (
        row["courseCode"],
        row["sessionCode"],
        row["sectionName"],
        row["day"],
        row["start"],
        row["end"],
        row["buildingCode"],
        row["room"] or "",
    )


def write_dataset(result: BuildResult, out_dir: str | Path) -> dict[str, Path]:
    """Write the dataset, split per campus, and return the paths written."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    campus_dir = out / "campus"
    campus_dir.mkdir(parents=True, exist_ok=True)

    paths: dict[str, Path] = {
        "rooms": out / "rooms.json",
        "meta": out / "meta.json",
    }

    by_campus: dict[str, list[dict[str, Any]]] = {}
    for meeting in result.meetings:
        by_campus.setdefault(meeting.campus_key, []).append(meeting.to_json())

    for key in sorted(by_campus):
        path = campus_dir / f"{key}.json"
        path.write_text(
            json.dumps(sorted(by_campus[key], key=_sort_key), separators=(",", ":")),
            encoding="utf-8",
        )
        paths[f"campus:{key}"] = path

    paths["rooms"].write_text(
        json.dumps([room.to_json() for room in result.rooms], separators=(",", ":")),
        encoding="utf-8",
    )
    paths["meta"].write_text(
        json.dumps(result.snapshot.to_json(), indent=2), encoding="utf-8"
    )
    return paths
