import json, urllib.request

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
        "pageSize": 10,
        "direction": "asc"
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            courses = (data.get("payload") or {}).get("pageableCourse", {}).get("courses", [])
            return courses
    except Exception as e:
        print("Error fetching", course_code, division, e)
        return []

# Try different query variations
variants = [
    ("CSC108H1", "ARTSC"),
    ("CSC108H1", "APSC"),
    ("MAT137Y1", "ARTSC"),
    ("MAT137Y1", "APSC"),
]

for code, div in variants:
    courses = fetch_course(code, div)
    print(f"{code} {div}: {len(courses)} courses")
    if courses:
        print("  first code:", courses[0].get('code'))
