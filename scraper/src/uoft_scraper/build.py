"""Build the class + room dataset that the app consumes.

Outputs (all under ``--out``):

``classes.json``
    Every class meeting, with the full metadata the API publishes.
``rooms.json``
    The UTM classroom inventory and its occupancy for the snapshot week.
``meta.json``
    Provenance: how many rows were fetched vs. expected, the snapshot week,
    and the source URLs.
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
from .parse import parse_courses


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
    for meeting in meetings:
        if meeting.faculty_code:
            breakdown[meeting.faculty_code] = breakdown.get(meeting.faculty_code, 0) + 1

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


def write_dataset(result: BuildResult, out_dir: str | Path) -> dict[str, Path]:
    """Write the three JSON files and return their paths."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    paths = {
        "classes": out / "classes.json",
        "rooms": out / "rooms.json",
        "meta": out / "meta.json",
    }
    paths["classes"].write_text(
        json.dumps([meeting.to_json() for meeting in result.meetings], separators=(",", ":")),
        encoding="utf-8",
    )
    paths["rooms"].write_text(
        json.dumps([room.to_json() for room in result.rooms], separators=(",", ":")),
        encoding="utf-8",
    )
    paths["meta"].write_text(
        json.dumps(result.snapshot.to_json(), indent=2), encoding="utf-8"
    )
    return paths
