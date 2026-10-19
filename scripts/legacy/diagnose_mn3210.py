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
page_size = 50
courses, total = fetch_page(divisions, 1, page_size)
print("total", total)
mn_found = []
for c in courses:
    code = c.get('code','')
    for sec in c.get('sections',[]):
        for mt in sec.get('meetingTimes',[]):
            bldg = mt.get('building') or {}
            bc = str(bldg.get('buildingCode') or '').strip().upper()
            rn = str(bldg.get('buildingRoomNumber') or '').strip().upper()
            if bc == 'MN':
                mn_found.append({
                    'code': code,
                    'sec': sec.get('name'),
                    'bc': bc,
                    'rn': rn,
                    'session': mt.get('sessionCode'),
                    'day': mt.get('start',{}).get('day'),
                    'start': mt.get('start',{}).get('millisofday'),
                    'end': mt.get('end',{}).get('millisofday')
                })
print("MN rooms in page 1:", len(mn_found))
rooms_set = set()
for e in mn_found:
    rooms_set.add(e['rn'])
print("Unique room numbers:", sorted(rooms_set))
# Search for empty room numbers
empty = [e for e in mn_found if not e['rn'] or e['rn'] in ('','TBA','ONL','NULL','NONE')]
print("MN entries with empty/TBA room:", len(empty))
if empty:
    print(empty[:5])
