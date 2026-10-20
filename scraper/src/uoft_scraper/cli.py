"""Command line entry point for the UofT scraper."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Sequence

from .api import DEFAULT_BASE_URL, DEFAULT_SESSIONS, TtbClient
from .build import BuildResult, build_dataset, write_dataset
from .metis import load_snapshot
from .models import ClassMeeting, Snapshot
from .parse import measure_funnel

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
    print(
        f"  meeting times seen  : {snapshot.raw_meeting_times_seen} "
        f"(before filters; {snapshot.raw_meeting_times_seen - snapshot.class_meetings} dropped)"
    )
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
    print("  meetings per campus :")
    for key, count in sorted(snapshot.campus_breakdown.items()):
        print(f"      {key:<10} {count}")
    for name, path in paths.items():
        print(f"  wrote {name:<14} -> {path} ({path.stat().st_size / 1024:.0f} KB)")
    print("=" * 68)

    if snapshot.course_rows_fetched != snapshot.course_rows_expected:
        print("FAILED: incomplete fetch", file=sys.stderr)
        return 1
    return 0


def _rebuild_rooms(args: argparse.Namespace) -> int:
    """Rebuild the dataset with a new space database snapshot.

    The timetable and the space database have different clocks. The
    timetable is the whole catalogue and changes when the University
    changes it; the space database publishes one week at a time and is
    re-captured weekly. Refetching 370 pages of the timetable to swap one
    week of room occupancy would be wasteful and would put load on the
    University's servers for no reason, so this command keeps the committed
    catalogue and replaces only the rooms and the snapshot provenance.
    """
    data_dir = Path(args.data)
    metis = load_snapshot(args.metis)

    campus_dir = data_dir / "campus"
    rows: list[dict] = []
    for path in sorted(campus_dir.glob("*.json")):
        rows.extend(json.loads(path.read_text(encoding="utf-8")))

    committed = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))
    if committed["classMeetings"] != len(rows):
        print(
            f"FAILED: meta says {committed['classMeetings']} class meetings but "
            f"the campus files hold {len(rows)}",
            file=sys.stderr,
        )
        return 1

    snapshot = Snapshot(
        generated_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        sessions=tuple(committed["sessions"]),
        snapshot_week_start=metis.week_start,
        snapshot_week_end=metis.week_end,
        snapshot_week_days=tuple(sorted(metis.days)),
        course_rows_fetched=committed["courseRowsFetched"],
        course_rows_expected=committed["courseRowsExpected"],
        class_meetings=len(rows),
        rooms=len(metis.rooms),
        meetings_with_published_room=committed["meetingsWithPublishedRoom"],
        divisions=tuple(committed["divisions"]),
        source_urls=committed["sourceUrls"],
        raw_meeting_times_seen=committed.get("rawMeetingTimesSeen", 0),
        filter_funnel=committed.get("filterFunnel", {}),
        campus_breakdown=committed.get("campusBreakdown", {}),
    )

    result = BuildResult(
        meetings=[ClassMeeting.from_json(row) for row in rows],
        rooms=list(metis.rooms),
        snapshot=snapshot,
        divisions=list(committed["divisions"]),
        faculty_breakdown=committed.get("facultyBreakdown", {}),
    )
    paths = write_dataset(result, data_dir)

    missing = sorted({hour for room in metis.rooms for hour in room.hours_missing})
    print("=" * 68)
    print("ROOMS REBUILT (catalogue unchanged)")
    print("=" * 68)
    print(
        f"  metis snapshot week : {snapshot.snapshot_week_start} .. "
        f"{snapshot.snapshot_week_end} "
        f"(weekdays {list(snapshot.snapshot_week_days)})"
    )
    print(f"  class meetings      : {snapshot.class_meetings} (unchanged)")
    print(f"  rooms in inventory  : {snapshot.rooms}")
    print(
        "  hours the source does not publish : "
        + (", ".join(f"{hour:02d}:00" for hour in missing) if missing else "none")
    )
    for name, path in paths.items():
        print(f"  wrote {name:<14} -> {path} ({path.stat().st_size / 1024:.0f} KB)")
    print("=" * 68)
    return 0


def _funnel(args: argparse.Namespace) -> int:
    """Fetch the catalogue and account for every meeting time it published.

    This is the number the project report quotes, so it has to be measurable
    rather than remembered.
    """
    client = TtbClient(base_url=args.base_url, sessions=tuple(args.sessions))
    rows = client.fetch_all_courses()
    funnel = measure_funnel(rows)

    print("=" * 68)
    print("FILTER FUNNEL")
    print("=" * 68)
    print(f"  course rows fetched      : {len(rows)}")
    print(f"  meeting times published  : {funnel.raw}")
    print(f"    - cancelled sections   : {funnel.dropped_cancelled}")
    print(f"    - no physical building : {funnel.dropped_building}")
    print(f"    - invalid time range   : {funnel.dropped_invalid_time}")
    print(f"    - repeated by the API  : {funnel.dropped_duplicate}")
    print(f"  class meetings kept      : {funnel.final}")
    print("=" * 68)
    return 0


def _verify(args: argparse.Namespace) -> int:
    """Check the dataset's invariants.

    Offline checks are structural. ``--live`` additionally re-fetches the
    catalogue and asserts the dataset still matches what the API publishes.
    """
    data_dir = Path(args.data)
    # The rooms are stored one file per campus, each with its provenance.
    rooms_dir = data_dir / "rooms"
    rooms: list[dict] = []
    for path in sorted(rooms_dir.glob("*.json")) if rooms_dir.is_dir() else []:
        rooms.extend(json.loads(path.read_text(encoding="utf-8"))["rooms"])
    meta = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))

    failures: list[str] = []

    # The dataset is stored one file per campus key. Reading them back and
    # unioning them is the check that the split never lost or invented a
    # meeting.
    campus_dir = data_dir / "campus"
    campus_files = sorted(campus_dir.glob("*.json")) if campus_dir.is_dir() else []
    if not campus_files:
        failures.append(f"no campus files found in {campus_dir}")

    classes: list[dict] = []
    per_campus: dict[str, int] = {}
    for path in campus_files:
        rows = json.loads(path.read_text(encoding="utf-8"))
        per_campus[path.stem] = len(rows)
        classes.extend(rows)

    expected_breakdown: dict[str, int] = meta.get("campusBreakdown") or {}
    for key, count in sorted(expected_breakdown.items()):
        if key not in per_campus:
            failures.append(f"campus file missing for {key} ({count} meetings)")
        elif per_campus[key] != count:
            failures.append(
                f"campus {key} holds {per_campus[key]} meetings, "
                f"meta says {count}"
            )
    for key in sorted(set(per_campus) - set(expected_breakdown)):
        failures.append(f"campus file {key} is not listed in meta.campusBreakdown")

    if meta["courseRowsFetched"] != meta["courseRowsExpected"]:
        failures.append(
            f"course rows fetched ({meta['courseRowsFetched']}) != expected "
            f"({meta['courseRowsExpected']})"
        )

    if meta["classMeetings"] != len(classes):
        failures.append(
            f"meta classMeetings ({meta['classMeetings']}) != the "
            f"{len(classes)} meetings in the campus files"
        )

    # The funnel has to add up: every meeting time the API published is
    # either in the dataset or accounted for by a named filter.
    funnel = meta.get("filterFunnel") or {}
    if funnel:
        raw = meta.get("rawMeetingTimesSeen", funnel.get("rawMeetingTimesSeen"))
        dropped = sum(
            value
            for key, value in funnel.items()
            if key.startswith("dropped") and isinstance(value, int)
        )
        if raw is not None and raw - dropped != meta["classMeetings"]:
            failures.append(
                f"the filter funnel does not add up: {raw} published - "
                f"{dropped} dropped != {meta['classMeetings']} kept"
            )
    # meta.rooms counts the rooms of the space database, which is the file
    # the scraper writes. The other campuses' rooms come from their own
    # sources and are checked for shape below.
    metis_rooms = 0
    metis_path = rooms_dir / "UTM.json"
    if metis_path.is_file():
        metis_rooms = len(
            json.loads(metis_path.read_text(encoding="utf-8"))["rooms"]
        )
    if meta["rooms"] != metis_rooms:
        failures.append(
            f"meta rooms ({meta['rooms']}) != the rooms in data/rooms/UTM.json "
            f"({metis_rooms})"
        )

    for path in sorted(rooms_dir.glob("*.json")) if rooms_dir.is_dir() else []:
        file = json.loads(path.read_text(encoding="utf-8"))
        if file.get("campus") != path.stem:
            failures.append(
                f"rooms file {path.name} says it belongs to {file.get('campus')!r}"
            )
        for room in file.get("rooms", []):
            if room.get("campusKey") != path.stem:
                failures.append(
                    f"room {room.get('room')} in {path.name} has campus "
                    f"{room.get('campusKey')!r}"
                )
                break

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

    # The classroom inventories the University publishes per campus. They
    # carry no meeting, so the only things to check are that the file says
    # which campus it belongs to and that every classroom has the room
    # number and capacity the source gave it.
    classroom_dir = data_dir / "classrooms"
    classroom_files = (
        sorted(classroom_dir.glob("*.json")) if classroom_dir.is_dir() else []
    )
    classroom_count = 0
    for path in classroom_files:
        inventory = json.loads(path.read_text(encoding="utf-8"))
        if inventory.get("campus") != path.stem:
            failures.append(
                f"classroom file {path.name} says it belongs to "
                f"{inventory.get('campus')!r}"
            )
        for building, building_rooms in (inventory.get("classrooms") or {}).items():
            for classroom in building_rooms:
                classroom_count += 1
                if not classroom.get("room"):
                    failures.append(
                        f"classroom without a room number in {path.name} ({building})"
                    )
                    break
                capacity = classroom.get("capacity")
                if capacity is not None and capacity <= 0:
                    failures.append(
                        f"classroom {classroom['room']} in {building} has a "
                        f"capacity of {capacity}"
                    )
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
        f"verify OK: {len(classes)} class meetings across "
        f"{len(per_campus)} campuses, {len(rooms)} rooms, "
        f"{classroom_count} published classrooms, "
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

    rebuild = sub.add_parser(
        "rebuild-rooms",
        help="replace the rooms with a new space database snapshot, keeping the catalogue",
    )
    rebuild.add_argument("--data", default=str(DEFAULT_OUT), help="dataset directory")
    rebuild.add_argument("--metis", default=str(DEFAULT_METIS), help="Metis space database")
    rebuild.set_defaults(func=_rebuild_rooms)

    verify = sub.add_parser("verify", help="check the generated dataset")
    verify.add_argument("--data", default=str(DEFAULT_OUT), help="dataset directory")
    verify.add_argument(
        "--live", action="store_true", help="also re-fetch the catalogue and compare"
    )
    verify.set_defaults(func=_verify)

    funnel = sub.add_parser(
        "funnel", help="fetch the catalogue and account for every meeting time"
    )
    funnel.add_argument("--base-url", default=DEFAULT_BASE_URL, help="TTB API base URL")
    funnel.add_argument(
        "--sessions",
        nargs="+",
        default=list(DEFAULT_SESSIONS),
        help="session codes to include (default: 20269 20271)",
    )
    funnel.set_defaults(func=_funnel)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
