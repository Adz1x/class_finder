import json, urllib.request, math, time
from concurrent.futures import ThreadPoolExecutor, as_completed

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

def fetch_page(divisions, page, page_size=50):
    payload = {
        "courseCodeAndTitleProps": {"courseCode":"", "courseTitle":"", "courseSectionCode":"", "searchCourseDescription":False},
        "departmentProps": [],
        "campuses": [],
        "sessions": ["20269","20271"],
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
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        pageable = (data.get("payload") or {}).get("pageableCourse") or {}
        return (pageable.get("courses") or []), (pageable.get("total") or 0)

def analyze_division(divisions, campus_name):
    print(f"\n=== {campus_name} divisions {divisions} ===")
    first, total = fetch_page(divisions, 1)
    print(f"Total courses reported: {total}")
    if total == 0:
        print("No courses")
        return
    sample = first[:3]
    rooms_missing = 0
    rooms_present = 0
    meetings = 0
    building_codes = set()
    for c in sample:
        for sec in c.get('sections', []):
            for mt in sec.get('meetingTimes', []):
                meetings += 1
                bldg = mt.get('building', {})
                room = bldg.get('buildingRoomNumber') or ''
                bcode = bldg.get('buildingCode') or ''
                building_codes.add(bcode)
                if room.strip():
                    rooms_present += 1
                else:
                    rooms_missing += 1
    print(f"Sample meetings: {meetings}, rooms present: {rooms_present}, missing: {rooms_missing}")
    print(f"Building codes in sample: {sorted(building_codes)}")

campus_divisions = {
    "UTM": ["ERIN"],
    "UTSG": ["ARTSC","APSC","FALD","MUSIC","FPHE"],
    "UTSC": ["SCAR"]
}

for campus, divs in campus_divisions.items():
    # test first division only for speed
    analyze_division(divs[:1], campus)
