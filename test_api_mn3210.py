import json
import urllib.request

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

payload = {
    "courseCodeAndTitleProps": {"courseCode": "", "courseTitle": "", "courseSectionCode": "", "searchCourseDescription": False},
    "departmentProps": [],
    "campuses": [],
    "sessions": ["20269", "20271"],
    "requirementProps": [],
    "instructor": "",
    "courseLevels": [],
    "deliveryModes": [],
    "dayPreferences": [],
    "timePreferences": [],
    "divisions": ["ERIN"],
    "creditWeights": [],
    "availableSpace": False,
    "waitListable": False,
    "page": 1,
    "pageSize": 50,
    "direction": "asc"
}

req = urllib.request.Request(API_URL, data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    method="POST")
with urllib.request.urlopen(req, timeout=25) as resp:
    data = json.loads(resp.read().decode("utf-8"))
    pageable = (data.get("payload") or {}).get("pageableCourse") or {}
    courses = pageable.get("courses") or []
    print(f"Total courses: {pageable.get('total')}")
    found=[]
    for c in courses:
        code=c.get("code","")
        for sec in c.get("sections",[]):
            for mt in sec.get("meetingTimes",[]):
                bldg=mt.get("building") or {}
                bcode=str(bldg.get("buildingCode") or "").strip().upper()
                rnum=str(bldg.get("buildingRoomNumber") or "").strip().upper()
                if bcode=="MN":
                    if rnum=="3210" or rnum=="":
                        found.append((code, sec.get("name"), bcode, rnum, mt.get("sessionCode")))
    print(f"MN courses found: {len(found)}")
    for f in found[:50]:
        print(f)
