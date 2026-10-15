import hashlib
import json
import math
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"
SESSIONS = ["20269", "20271"]

CAMPUS_DIVISIONS = {
    "UTM": ["ERIN"],
    "UTSG": ["ARTSC", "APSC", "FALD", "MUSIC", "FPHE"],
    "UTSC": ["SCAR"]
}

BUILDING_NAMES = {
    # UTM
    "MN": "Maanjiwe Nendamowinan",
    "IB": "Instructional Centre (UTM)",
    "DH": "Deerfield Hall",
    "CC": "Communication, Culture and Technology (CCIT)",
    "DV": "William G. Davis Building",
    "KN": "Kaneff Centre / Innovation Complex",
    "NE": "North Building",
    "HB": "Hazel McCallion Academic Learning Centre",
    "SH": "Science Building",
    # UTSG
    "BA": "Bahen Centre for Information Technology",
    "SS": "Sidney Smith Hall",
    "MP": "McLennan Physical Laboratories",
    "MS": "Medical Sciences Building",
    "MY": "Myhal Centre for Engineering Innovation",
    "GB": "Galbraith Building",
    "SF": "Sandford Fleming Building",
    "WB": "Wallberg Building",
    "UC": "University College",
    "VC": "Victoria College (Old Vic)",
    "NF": "Northrop Frye Hall",
    "CR": "Carr Hall",
    "BR": "Brennan Hall",
    "RW": "Ramsay Wright Laboratories",
    "ES": "Earth Sciences Centre",
    "LM": "Lash Miller Chemical Laboratories",
    "EX": "Exam Centre",
    "OI": "OISE",
    "WI": "Wilson Hall (New College)",
    "WE": "Wetmore Hall (New College)",
    "IN": "Innis College",
    "WW": "Woodsworth College",
    "BL": "Claude T. Bissell Building",
    "PB": "Leslie Dan Pharmacy Building",
    "AB": "Astronomy and Astrophysics Building",
    # UTSC
    "IC": "Instructional Centre (UTSC)",
    "IA": "Sam Ibrahim Building",
    "HL": "Highland Hall",
    "KW": "Kina Wiiya Enadong Building",
    "BV": "Bladen Wing",
    "HW": "Humanities Wing",
    "MW": "Social Sciences Building",
    "SW": "Science Wing",
    "SY": "Environmental Science & Chemistry Building",
    "AA": "Arts & Administration Building",
    "AC": "Academic Resource Centre"
}

REAL_BUILDING_ROOMS = {
    "MN": ["1170", "1210", "2100", "2110", "2130", "2150", "2190", "2210", "2260", "2262", "2264", "2266", "3100", "3120", "3140", "3150", "3160", "3170", "3180", "3190", "3220", "3295"],
    "IB": ["110", "120", "140", "150", "200", "210", "220", "235", "240", "245", "250", "260", "270", "280", "320", "335", "340", "345", "350", "360", "370", "377", "379", "380", "385", "390", "395"],
    "DH": ["2060", "2070", "2080", "3000", "4001"],
    "CC": ["1080", "1140", "2134", "2150", "3124", "3150"],
    "DV": ["2072", "2074", "2080", "2082"],
    "KN": ["137"],
    "BA": ["1130", "1160", "1170", "1180", "1190", "1200", "1210", "1220", "1230", "1240", "2135", "2139", "2145", "2155", "2165", "2175", "2185", "2195"],
    "SS": ["1069", "1070", "1072", "1073", "1074", "1083", "1084", "1085", "1086", "1087", "1088", "2102", "2106", "2108", "2110", "2117", "2118", "2125", "2127", "2135"],
    "MY": ["150", "315", "320", "330", "350", "360", "370", "380", "420", "430", "440", "480", "490"],
    "MP": ["102", "103", "118", "134", "137", "202", "203"],
    "MS": ["2158", "2170", "2172", "3153", "3154", "4171", "4279"],
    "UC": ["140", "152", "161", "163", "179", "244", "256", "328"],
    "GB": ["119", "120", "220", "221", "244", "248", "303", "304", "404", "405"],
    "SF": ["1101", "1105", "2202", "3201", "3202"],
    "WB": ["116", "119", "130", "219", "342"],
    "RW": ["110", "117", "140", "142", "143"],
    "LM": ["128", "155", "157", "158", "159", "161", "162"],
    "ES": ["1050", "B142", "B149", "4001"],
    "WI": ["523", "524", "1016", "1017", "2006"],
    "WE": ["51", "54", "69", "74", "75"],
    "WW": ["119", "120", "121", "126"],
    "IN": ["107", "204", "209", "222", "312"],
    "BL": ["112", "114", "205", "305", "313", "325"],
    "VC": ["101", "115", "206", "211", "212", "215"],
    "NF": ["003", "004", "006", "007", "113", "119"],
    "IC": ["120", "130", "200", "204", "208", "212", "220", "230", "300", "302", "320", "326"],
    "IA": ["1050", "1150", "2010", "2020", "2070", "2150", "3050"],
    "HL": ["001", "006", "008", "B101", "B106", "B108"],
    "KW": ["110", "120", "220", "240"],
    "BV": ["260", "264", "340", "355", "361", "363"],
    "HW": ["214", "215", "216", "308", "402", "408"],
    "MW": ["110", "120", "130", "140", "160", "170", "223", "262"],
    "SW": ["128", "143", "309", "319"],
    "SY": ["110"]
}

DATE_TO_DAY = {
    "2026-10-05": 1, # Monday
    "2026-10-06": 2, # Tuesday
    "2026-09-30": 3, # Wednesday
    "2026-10-01": 4, # Thursday
    "2026-10-02": 5  # Friday
}

# When the timetable API gives no room number, the scraper used to GUESS a room (assign_smart_room).
# Guesses are what cause overlapping classes in one room.
#   False = keep guessed rooms but tag them {"estimated": true} so the site can show them as unconfirmed
#   True  = drop guessed rooms entirely (only real, confirmed room bookings are kept)
SKIP_ESTIMATED_ROOMS = False

def ms_to_time_str(ms_val):
    total_minutes = int(ms_val // 60000)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"

def load_utm_metis_data():
    """Loads official UTM Classroom Space Database JSON and derives exact busy intervals and capacities."""
    paths = [
        "utm_metis_data.json",
        os.path.expanduser("~/Downloads/utm_metis_data.json")
    ]
    metis_raw = None
    for p in paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                metis_raw = json.load(f)
            print(f"Loaded official UTM Classroom Space Database from {p}!")
            break

    if not metis_raw:
        return {}, {}

    capacities = {}
    all_utm_rooms = set()
    open_by_day_hour = {1: {}, 2: {}, 3: {}, 4: {}, 5: {}}

    by_date = metis_raw.get("byDateAndHour", {})
    for date_str, hours_dict in by_date.items():
        day_num = DATE_TO_DAY.get(date_str)
        if not day_num:
            continue
        for hr_str, rows in hours_dict.items():
            hr_int = int(hr_str)
            open_set = set()
            for r in rows:
                if len(r) >= 6 and " " in r[4]:
                    room_name = r[4].strip().upper()
                    cap = r[5].strip()
                    all_utm_rooms.add(room_name)
                    capacities[room_name] = cap
                    open_set.add(room_name)
            open_by_day_hour[day_num][hr_int] = open_set

    # Any hour in [8..20] (except 13 which metis form omits) where a room is NOT in open_set means it is OCCUPIED
    busy_utm = {rm: {1: set(), 2: set(), 3: set(), 4: set(), 5: set()} for rm in all_utm_rooms}
    checked_hours = [8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20]
    for day_num in range(1, 6):
        for hr in checked_hours:
            open_rooms = open_by_day_hour[day_num].get(hr, set())
            for rm in all_utm_rooms:
                if rm not in open_rooms:
                    busy_utm[rm][day_num].add(hr)

    return capacities, busy_utm

def assign_smart_room(bldg_code, course_code, sec_name, day, start_hr, end_hr, busy_utm):
    rooms = REAL_BUILDING_ROOMS.get(bldg_code, ["101", "102", "105", "110", "201", "205"])
    digest = int(hashlib.md5(f"{course_code}-{sec_name}".encode("utf-8")).hexdigest(), 16)

    # If we have official UTM Metis busy data for this building, pick a room in this building that is actually busy at this hour
    if busy_utm and bldg_code in ("MN", "IB", "DH", "CC", "DV", "KN"):
        candidates = []
        for rm_num in rooms:
            full_rm = f"{bldg_code} {rm_num}"
            if full_rm in busy_utm and int(day) in busy_utm[full_rm]:
                check_hr = start_hr if start_hr != 13 else 12
                if check_hr in busy_utm[full_rm][int(day)]:
                    candidates.append(rm_num)
        if candidates:
            return candidates[digest % len(candidates)]

    return rooms[digest % len(rooms)]

def fetch_single_page(divisions, page, page_size=50):
    payload = {
        "courseCodeAndTitleProps": {
            "courseCode": "",
            "courseTitle": "",
            "courseSectionCode": "",
            "searchCourseDescription": False
        },
        "departmentProps": [],
        "campuses": [],
        "sessions": SESSIONS,
        "requirementProps": [],
        "instructor": "",
        "courseLevels": [],
        "deliveryModes": [],
        "dayPreferences": [],
        "timePreferences": [],
        "divisions": divisions,
        "creditWeights": [],
        "availableSpace": False,
        "waitListable": False,
        "page": page,
        "pageSize": page_size,
        "direction": "asc"
    }

    for attempt in range(1, 5):
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                pageable = (data.get("payload") or {}).get("pageableCourse") or {}
                return (pageable.get("courses") or []), (pageable.get("total") or 0)
        except Exception:
            time.sleep(attempt * 1.2)
    return [], 0

def fetch_all_courses(campus, divisions):
    page_size = 50
    first_courses, total = fetch_single_page(divisions, 1, page_size)
    if not first_courses or total == 0:
        return []

    total_pages = math.ceil(total / page_size)
    print(f"  [{campus}] Found {total} courses ({total_pages} pages). Downloading...")

    all_courses = list(first_courses)
    if total_pages > 1:
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(fetch_single_page, divisions, p, page_size): p
                for p in range(2, total_pages + 1)
            }
            completed = 1
            for future in as_completed(futures):
                c_list, _ = future.result()
                all_courses.extend(c_list)
                completed += 1
                if completed % 15 == 0 or completed == total_pages:
                    print(f"  [{campus}] {completed}/{total_pages} pages ({len(all_courses)}/{total} courses)")
    return all_courses

def build_room_database():
    capacities, busy_utm = load_utm_metis_data()
    db = {"UTM": {}, "UTSG": {}, "UTSC": {}}
    term_counts = {"F": 0, "S": 0, "Y": 0}

    # Pre-seed all 65 official UTM rooms from utm_metis_data.json so every UTM room is present
    for full_rm in sorted(busy_utm.keys()):
        bldg_code = full_rm.split(" ")[0]
        bldg_name = BUILDING_NAMES.get(bldg_code, f"{bldg_code} Building")
        if bldg_code not in db["UTM"]:
            db["UTM"][bldg_code] = {"code": bldg_code, "name": bldg_name, "rooms": {}, "capacities": {}}
        db["UTM"][bldg_code]["rooms"][full_rm] = []
        if full_rm in capacities:
            db["UTM"][bldg_code]["capacities"][full_rm] = capacities[full_rm]

    for campus, divisions in CAMPUS_DIVISIONS.items():
        print(f"\n=== Scraping {campus} ({', '.join(divisions)}) ===")
        courses = fetch_all_courses(campus, divisions)

        for course in courses:
            course_code = str(course.get("code") or "").strip().upper()
            section_code = str(course.get("sectionCode") or "").strip().upper()

            if section_code == "Y" or course_code.endswith(("Y1", "Y3", "Y5")):
                section_code = "Y"
            elif section_code not in ("F", "S", "Y"):
                section_code = "F"

            term_counts[section_code] = term_counts.get(section_code, 0) + 1

            for section in (course.get("sections") or []):
                if str(section.get("cancelInd") or "").upper() == "Y":
                    continue

                sec_name = str(section.get("name") or "").strip().upper()
                for mt in (section.get("meetingTimes") or []):
                    bldg_obj = mt.get("building") or {}
                    bldg_code = str(bldg_obj.get("buildingCode") or "").strip().upper()
                    room_num = str(bldg_obj.get("buildingRoomNumber") or "").strip().upper()

                    if not bldg_code or bldg_code in ("ON", "OFF", "TBA", "ONL", "NULL", "NONE", "NOTE"):
                        continue

                    start_info = mt.get("start") or {}
                    end_info = mt.get("end") or {}
                    day = start_info.get("day")
                    start_ms = start_info.get("millisofday")
                    end_ms = end_info.get("millisofday")

                    if not day or start_ms is None or end_ms is None or end_ms <= start_ms:
                        continue

                    start_hr = int(start_ms // 3600000)
                    end_hr = int(end_ms // 3600000)

                    room_estimated = False
                    if not room_num or room_num in ("TBA", "ONL", "SYNC", "ASYNC"):
                        room_estimated = True
                        room_num = assign_smart_room(
                            bldg_code,
                            f"{course_code}{section_code}",
                            sec_name,
                            day,
                            start_hr,
                            end_hr,
                            busy_utm if campus == "UTM" else None
                        )
                        if SKIP_ESTIMATED_ROOMS:
                            continue

                    bldg_name = bldg_obj.get("buildingName") or BUILDING_NAMES.get(bldg_code, f"{bldg_code} Building")
                    if bldg_code not in db[campus]:
                        db[campus][bldg_code] = {"code": bldg_code, "name": bldg_name, "rooms": {}, "capacities": {}}

                    full_room = f"{bldg_code} {room_num}"
                    if full_room not in db[campus][bldg_code]["rooms"]:
                        db[campus][bldg_code]["rooms"][full_room] = []

                    mt_sess = str(mt.get("sessionCode") or "").strip()
                    if section_code == "Y":
                        term_flag = "Y"
                    elif mt_sess == "20271":
                        term_flag = "S"
                    elif mt_sess == "20269":
                        term_flag = "F"
                    else:
                        term_flag = section_code

                    slot = {
                        "day": int(day),
                        "start": ms_to_time_str(start_ms),
                        "end": ms_to_time_str(end_ms),
                        "course": f"{course_code}{section_code} ({sec_name})",
                        "term": term_flag
                    }
                    if room_estimated:
                        slot["estimated"] = True
                    if slot not in db[campus][bldg_code]["rooms"][full_room]:
                        db[campus][bldg_code]["rooms"][full_room].append(slot)

    # Also ensure any UTM official busy hour from Metis not already covered by a Fall course is marked on the schedule
    for full_rm, days_map in busy_utm.items():
        bldg_code = full_rm.split(" ")[0]
        existing_slots = db["UTM"][bldg_code]["rooms"].get(full_rm, [])
        for day_num, hrs in days_map.items():
            for hr in sorted(hrs):
                hr_start = f"{hr:02d}:00"
                hr_end = f"{hr+1:02d}:00"
                covered = any(
                    s["day"] == day_num and s["term"] in ("F", "Y") and s["start"] <= hr_start and s["end"] >= hr_end
                    for s in existing_slots
                )
                if not covered:
                    existing_slots.append({
                        "day": day_num,
                        "start": hr_start,
                        "end": hr_end,
                        "course": "Booked Class / Lab (UTM Registrar)",
                        "term": "F"
                    })

    print("\n================ SCRAPE SUMMARY ================")
    print(f"Course Breakdown: Fall (F) = {term_counts.get('F', 0)}, Winter (S) = {term_counts.get('S', 0)}, Full-Year (Y) = {term_counts.get('Y', 0)}")
    for campus in ("UTM", "UTSG", "UTSC"):
        b_count = len(db[campus])
        r_count = sum(len(b["rooms"]) for b in db[campus].values())
        s_count = sum(sum(len(r) for r in b["rooms"].values()) for b in db[campus].values())
        print(f"  {campus}: {b_count} buildings | {r_count} classrooms | {s_count} weekly class times")
        for bldg in db[campus]:
            for room in db[campus][bldg]["rooms"]:
                db[campus][bldg]["rooms"][room].sort(key=lambda x: (x["day"], x["start"], x["end"]))
    print("================================================")

    with open("rooms_data.js", "w", encoding="utf-8") as f:
        f.write("window.UOFT_ROOMS_DATA = ")
        json.dump(db, f, indent=2)
        f.write(";\n")
    print("\nSUCCESS! Saved rooms_data.js with UTM Official Space Database + All UofT Courses!")

if __name__ == "__main__":
    build_room_database()
