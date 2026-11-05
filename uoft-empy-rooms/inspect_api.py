import json, urllib.request

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

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
    "divisions":["ERIN"],
    "creditWeights":[],
    "availableSpace":False,
    "waitListable":False,
    "page":1,
    "pageSize":50,
    "direction":"asc"
}

req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"Mozilla/5.0"}, method="POST")
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode('utf-8'))
courses = (data.get('payload') or {}).get('pageableCourse') or {}
course_list = courses.get('courses',[])
print(json.dumps(course_list[0], indent=2)[:4000])
