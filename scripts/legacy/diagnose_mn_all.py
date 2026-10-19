import json, urllib.request, math

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
page_size = 50
courses, total = fetch_page(divisions, 1, page_size)
total_pages = math.ceil(total/page_size)
print("total", total, "pages", total_pages)

found_mn_room = []
found_empty = 0
checked = 0
for p in range(1, min(21, total_pages+1)):
    courses, _ = fetch_page(divisions, p, page_size)
    for c in courses:
        code = c.get('code','')
        for sec in c.get('sections',[]):
            for mt in sec.get('meetingTimes',[]):
                bldg = mt.get('building') or {}
                bc = str(bldg.get('buildingCode') or '').strip().upper()
                rn = str(bldg.get('buildingRoomNumber') or '').strip().upper()
                if bc == 'MN':
                    checked += 1
                    if rn and rn not in ('','TBA','ONL','NULL','NONE','NOTE'):
                        found_mn_room.append((code, sec.get('name'), rn, mt.get('sessionCode')))
                    else:
                        found_empty += 1
    print("page", p, "checked", checked, "non-empty rooms", len(found_mn_room))
    
print("Total MN meetings checked:", checked)
print("Empty room count:", found_empty)
print("Non-empty MN rooms found:", len(found_mn_room))
if found_mn_room:
    rooms = set(r[2] for r in found_mn_room)
    print("Unique non-empty room numbers:", sorted(rooms))
    # print first few
    for r in found_mn_room[:10]:
        print(r)
