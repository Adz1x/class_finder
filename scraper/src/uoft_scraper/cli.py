"""Command line entry point for the UofT scraper."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from .api import DEFAULT_BASE_URL, DEFAULT_SESSIONS, TtbClient
from .build import build_dataset, write_dataset
from .metis import load_snapshot

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_METIS = REPO_ROOT / "data" / "utm_metis_data.json"
DEFAULT_OUT = REPO_ROOT / "data"


def _build(args: argparse.Namespace) -> int:
    client = TtbClient(
        base_url=args.base_url,
        sessions=tuple(args.sessions),
        max_workers=args.max_workers,
    )
    metis = load_snapshot(args.metis)
    result = build_dataset(client, metis)
    paths = write_dataset(result, args.out)

    snapshot = result.snapshot
    print("=" * 68)
    print("SCRAPE SUMMARY")
    print("=" * 68)
    print(
        f"  course rows fetched : {snapshot.course_rows_fetched} "
        f"(expected {snapshot.course_rows_expected})"
    )
    print(f"  class meetings      : {snapshot.class_meetings}")
    print(f"  rooms in inventory  : {snapshot.rooms}")
    print(
        f"  published rooms     : {snapshot.meetings_with_published_room} "
        f"(the UofT API publishes none for these sessions)"
    )
    print(
        f"  metis snapshot week : {snapshot.snapshot_week_start} .. "
        f"{snapshot.snapshot_week_end} "
        f"(weekdays {list(snapshot.snapshot_week_days)})"
    )
    print(f"  divisions covered   : {', '.join(result.divisions)}")
    for division, count in result.faculty_breakdown.items():
        print(f"      {division:<8} {count}")
    for name, path in paths.items():
        print(f"  wrote {name:<8} -> {path} ({path.stat().st_size / 1024:.0f} KB)")
    print("=" * 68)

    if snapshot.course_rows_fetched != snapshot.course_rows_expected:
        print("FAILED: incomplete fetch", file=sys.stderr)
        return 1
    return 0


def _verify(args: argparse.Namespace) -> int:
    """Check the dataset's invariants.

    Offline checks are structural. ``--live`` additionally re-fetches the
    catalogue and asserts the dataset still matches what the API publishes.
    """
    data_dir = Path(args.data)
    classes = json.loads((data_dir / "classes.json").read_text(encoding="utf-8"))
    rooms = json.loads((data_dir / "rooms.json").read_text(encoding="utf-8"))
    meta = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))

    failures: list[str] = []

    if meta["courseRowsFetched"] != meta["courseRowsExpected"]:
        failures.append(
            f"course rows fetched ({meta['courseRowsFetched']}) != expected "
            f"({meta['courseRowsExpected']})"
        )

    if meta["classMeetings"] != len(classes):
        failures.append(
            f"meta classMeetings ({meta['classMeetings']}) != classes.json ({len(classes)})"
        )
    if meta["rooms"] != len(rooms):
        failures.append(f"meta rooms ({meta['rooms']}) != rooms.json ({len(rooms)})")

    known_rooms = {room["room"] for room in rooms}
    fabricated = sorted(
        {
            meeting["room"]
            for meeting in classes
            if meeting.get("room") and meeting["room"] not in known_rooms
        }
    )
    if fabricated:
        failures.append(
            "class meetings reference rooms that are not in the published "
            f"room inventory: {fabricated[:10]}"
        )

    seen: set[tuple] = set()
    duplicates = 0
    for meeting in classes:
        key = (
            meeting["courseCode"],
            meeting["sessionCode"],
            meeting["sectionName"],
            meeting["day"],
            meeting["start"],
            meeting["end"],
            meeting["buildingCode"],
            meeting.get("room"),
        )
        if key in seen:
            duplicates += 1
        seen.add(key)
    if duplicates:
        failures.append(f"{duplicates} duplicate class meetings")

    for meeting in classes:
        if not 1 <= meeting["day"] <= 7:
            failures.append(f"invalid day {meeting['day']} in {meeting['courseCode']}")
            break
        if meeting["end"] <= meeting["start"]:
            failures.append(f"invalid time range in {meeting['courseCode']}")
            break

    if args.live:
        client = TtbClient(sessions=tuple(meta["sessions"]))
        rows = client.fetch_all_courses()
        from .parse import parse_courses

        fresh = parse_courses(rows)
        fresh_keys = {
            (
                m.course_code,
                m.session_code,
                m.section_name,
                m.day,
                m.start,
                m.end,
                m.building_code,
                m.room,
            )
            for m in fresh
        }
        stored_keys = {
            (
                m["courseCode"],
                m["sessionCode"],
                m["sectionName"],
                m["day"],
                m["start"],
                m["end"],
                m["buildingCode"],
                m.get("room"),
            )
            for m in classes
        }
        if fresh_keys != stored_keys:
            failures.append(
                "dataset does not match the live API: "
                f"{len(fresh_keys - stored_keys)} missing, "
                f"{len(stored_keys - fresh_keys)} extra"
            )
        else:
            print(f"live check: dataset matches all {len(fresh_keys)} live meetings")

    if failures:
        print("VERIFY FAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(
        f"verify OK: {len(classes)} class meetings, {len(rooms)} rooms, "
        f"{meta['courseRowsFetched']} course rows, "
        f"{sum(1 for m in classes if m.get('room'))} meetings with a published room"
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="uoft-scraper", description="Build the UofT class + room dataset"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="fetch the catalogue and write the dataset")
    build.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    build.add_argument("--metis", default=str(DEFAULT_METIS), help="Metis space database")
    build.add_argument(
        "--base-url", default=DEFAULT_BASE_URL, help="TTB API base URL"
    )
    build.add_argument(
        "--sessions",
        nargs="+",
        default=list(DEFAULT_SESSIONS),
        help="session codes to include (default: 20269 20271)",
    )
    build.add_argument("--max-workers", type=int, default=8)
    build.set_defaults(func=_build)

    verify = sub.add_parser("verify", help="check the generated dataset")
    verify.add_argument("--data", default=str(DEFAULT_OUT), help="dataset directory")
    verify.add_argument(
        "--live", action="store_true", help="also re-fetch the catalogue and compare"
    )
    verify.set_defaults(func=_verify)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
