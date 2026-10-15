import json
import urllib.request

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

def ms_to_time_str(ms_val):
    total_minutes = int(ms_val // 60000)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"

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
        "pageSize": 10,
        "direction": "asc"
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        courses = (data.get("payload") or {}).get("pageableCourse", {}).get("courses", [])
        return courses

print("Testing ANT101H5 from local debug file")
with open('debug_sample_course.json') as f:
    d = json.load(f)
    code = d.get('code')
    print("Course code:", code)
    for sec in d.get('sections', [])[:2]:
        print(" Section:", sec.get('name'))
        for mt in sec.get('meetingTimes', [])[:1]:
            start_ms = mt['start']['millisofday']
            end_ms = mt['end']['millisofday']
            print("  day", mt['start']['day'], ms_to_time_str(start_ms), "-", ms_to_time_str(end_ms))

print("\nTesting live fetch for CSC108H5")
try:
    courses = fetch_course("CSC108H5", "ERIN")
    print("Fetched", len(courses), "courses")
    if courses:
        c = courses[0]
        print("Code:", c.get('code'), "SectionCode:", c.get('sectionCode'))
        for sec in c.get('sections', [])[:2]:
            print(" Section:", sec.get('name'))
            for mt in sec.get('meetingTimes', [])[:2]:
                start_ms = mt['start']['millisofday']
                end_ms = mt['end']['millisofday']
                print("  day", mt['start']['day'], ms_to_time_str(start_ms), "-", ms_to_time_str(end_ms), "building", mt.get('building',{}).get('buildingCode'), "room", mt.get('building',{}).get('buildingRoomNumber'))
except Exception as e:
    print("Fetch error:", e)
