import json, urllib.request
from scrape_uoft import ms_to_time_str

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

def fetch_with_campus(course_code, division, campus_code):
    payload = {
        "courseCodeAndTitleProps": {"courseCode": course_code, "courseTitle": "", "courseSectionCode": "", "searchCourseDescription": False},
        "departmentProps": [],
        "campuses": [campus_code], # Try adding campus here
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
        "pageSize": 10,
        "direction": "asc"
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return (data.get("payload") or {}).get("pageableCourse", {}).get("courses", [])

# Test CSC108H5 on UTM
print("Testing UTM with campus filter...")
courses = fetch_with_campus("CSC108H5", "ERIN", "UTM")
if courses:
    for sec in courses[0].get('sections', []):
        for mt in sec.get('meetingTimes', []):
            room = mt.get('building', {}).get('buildingRoomNumber')
            print(f"Course: {courses[0].get('code')} Section: {sec.get('name')} Room: '{room}'")
else:
    print("No courses found for UTM test")

# Test CSC108H1 on UTSG
print("\nTesting UTSG with campus filter...")
courses = fetch_with_campus("CSC108H1", "ARTSC", "UTSG")
if courses:
    for sec in courses[0].get('sections', []):
        for mt in sec.get('meetingTimes', []):
            room = mt.get('building', {}).get('buildingRoomNumber')
            print(f"Course: {courses[0].get('code')} Section: {sec.get('name')} Room: '{room}'")
else:
    print("No courses found for UTSG test")
