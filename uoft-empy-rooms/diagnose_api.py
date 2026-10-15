import json, urllib.request
from scrape_uoft import ms_to_time_str

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
        return (data.get("payload") or {}).get("pageableCourse", {})

course_code = "CSC108H5"
division = "ERIN"
pageable = fetch_course(course_code, division)
courses = pageable.get('courses', [])
print("Total courses:", pageable.get('total'))
for c in courses[:2]:
    print("\nCourse:", c.get('code'), c.get('sectionCode'))
    for sec in c.get('sections', [])[:3]:
        print(" Section:", sec.get('name'))
        for mt in sec.get('meetingTimes', [])[:2]:
            bldg = mt.get('building', {})
            start = mt.get('start', {})
            end = mt.get('end', {})
            print("  day", start.get('day'), ms_to_time_str(start.get('millisofday')), "-", ms_to_time_str(end.get('millisofday')), "bldg", bldg.get('buildingCode'), "room", repr(bldg.get('buildingRoomNumber')), "session", mt.get('sessionCode'))
