import json, urllib.request, sys
from scrape_uoft import ms_to_time_str, ms_to_minutes

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

def fetch_course(course_code, division):
    payload = {
        "courseCodeAndTitleProps": {"courseCode": course_code, "courseTitle": "", "courseSectionCode": "", "searchCourseDescription": False},
        "departmentProps": [],
        "campuses": [],
        "sessions": ["20269","20271"],
        "requirementProps": [],
        "instructor": "",
        "courseLevels": [],
        "deliveryModes": [],
        "dayPreferences": [],
        "timePreferences": [],
        "divisions": [division],
        "creditWeights": [],
        "availableSpace": False,
        "waitListable": False,
        "page": 1,
        "pageSize": 50,
        "direction": "asc"
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        courses = (data.get("payload") or {}).get("pageableCourse", {}).get("courses", [])
        return courses

def analyze_course(course_code, division):
    print(f"\n=== Analyzing {course_code} [{division}] ===")
    try:
        courses = fetch_course(course_code, division)
    except Exception as e:
        print("Fetch error:", e)
        return
    if not courses:
        print("No courses found")
        return
    total_meetings = 0
    missing_room = 0
    missing_time = 0
    odd_times = []
    for c in courses:
        code = c.get('code')
        sec_code = c.get('sectionCode')
        for sec in c.get('sections', []):
            sec_name = sec.get('name')
            for mt in sec.get('meetingTimes', []):
                total_meetings += 1
                bldg = mt.get('building', {})
                room = bldg.get('buildingRoomNumber') or ''
                start = mt.get('start', {})
                end = mt.get('end', {})
                day = start.get('day')
                start_ms = start.get('millisofday')
                end_ms = end.get('millisofday')
                if not room or room.strip() == '':
                    missing_room += 1
                if not day or start_ms is None or end_ms is None or end_ms <= start_ms:
                    missing_time += 1
                    continue
                start_str = ms_to_time_str(start_ms)
                end_str = ms_to_time_str(end_ms)
                start_min = ms_to_minutes(start_ms)
                end_min = ms_to_minutes(end_ms)
                # Check non-hour start
                if start_min % 60 != 0:
                    odd_times.append((day, start_str, end_str, code, sec_name))
                # Print first few
                if total_meetings <= 20:
                    print(f"  {code}{sec_code} {sec_name} day{day} {start_str}-{end_str} bldg {bldg.get('buildingCode')} room '{room}'")
    print(f"Total meetings: {total_meetings}, missing room: {missing_room}, missing/invalid time: {missing_time}")
    if odd_times:
        print(f"Non-hour start times found: {len(odd_times)} examples:")
        for ex in odd_times[:10]:
            print(" ", ex)

# Test set
tests = [
    ("ANT101H5", "ERIN"),
    ("CSC108H5", "ERIN"),
    ("MAT137Y1", "ARTSC"),
]

for code, div in tests:
    analyze_course(code, div)
