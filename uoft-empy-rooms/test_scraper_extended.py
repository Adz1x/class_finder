import json, urllib.request
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

tests = [
    ("CSC108H1", "ARTSC"),
    ("MAT137Y1", "ARTSC"),
    ("PHY151H1", "ARTSC"),
    ("STA247H1", "ARTSC"),
]

for code, div in tests:
    print(f"\n=== {code} [{div}] ===")
    try:
        courses = fetch_course(code, div)
        if not courses:
            print("No courses found")
            continue
        c = courses[0]
        print("Found:", c.get('code'), c.get('sectionCode'))
        rooms_present = 0
        rooms_missing = 0
        weird_buildings = set()
        non_hour = []
        for sec in c.get('sections', []):
            for mt in sec.get('meetingTimes', []):
                bldg = mt.get('building', {})
                room = bldg.get('buildingRoomNumber') or ''
                bcode = bldg.get('buildingCode') or ''
                start_ms = mt.get('start',{}).get('millisofday')
                end_ms = mt.get('end',{}).get('millisofday')
                if room.strip():
                    rooms_present += 1
                else:
                    rooms_missing += 1
                if bcode and bcode not in ['BA','SS','MP','MS','MY','GB','SF','WB','UC','VC','NF','CR','BR','RW','ES','LM','EX','OI','WI','WE','IN','WW','BL','PB','AB']:
                    weird_buildings.add(bcode)
                if start_ms:
                    start_min = ms_to_minutes(start_ms)
                    if start_min % 60 != 0:
                        non_hour.append(ms_to_time_str(start_ms))
        print(f"Rooms present: {rooms_present}, missing: {rooms_missing}")
        if weird_buildings:
            print(f"Weird buildings: {weird_buildings}")
        if non_hour:
            print(f"Non-hour starts: {non_hour}")
    except Exception as e:
        print("Error:", e)
