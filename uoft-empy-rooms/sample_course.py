import json, urllib.request

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

def fetch_page(divisions, page, page_size=50):
    payload = {
        "courseCodeAndTitleProps": {"courseCode":"","courseTitle":"","courseSectionCode":"","searchCourseDescription":False},
        "departmentProps":[],
        "campuses":[],
        "sessions":["20269","20271"],
        "requirementProps":[],
        "instructor":"",
        "courseLevels":[],
        "deliveryModes":[],
        "dayPreferences":[],
        "timePreferences":[],
        "divisions":divisions,
        "creditWeights":[],
        "availableSpace":False,
        "waitListable":False,
        "page":page,
        "pageSize":page_size,
        "direction":"asc"
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    pageable = (data.get('payload') or {}).get('pageableCourse') or {}
    return pageable.get('courses') or [], pageable.get('total') or 0

divisions = ["ERIN"]
courses, total = fetch_page(divisions, 1, 50)
c = courses[0]
print(json.dumps(c, indent=2)[:2000])
