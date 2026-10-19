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
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    courses = (data.get('payload') or {}).get('pageableCourse') or {}
    total = courses.get('total',0)
    course_list = courses.get('courses',[])
    print('total',total,'returned',len(course_list))
    found=0
    for c in course_list:
        code=c.get('code','')
        for sec in c.get('sections',[]):
            for mt in sec.get('meetingTimes',[]):
                bldg=mt.get('building') or {}
                bc=str(bldg.get('buildingCode') or '').strip().upper()
                rn=str(bldg.get('buildingRoomNumber') or '').strip().upper()
                if bc=='MN' and rn=='3210':
                    print('FOUND',code,sec.get('name'),mt)
                    found+=1
    print('found count',found)
    if found==0:
        print('No MN 3210 in first page, trying search for any MN rooms')
        mn_rooms=set()
        for c in course_list:
            for sec in c.get('sections',[]):
                for mt in sec.get('meetingTimes',[]):
                    bldg=mt.get('building') or {}
                    bc=str(bldg.get('buildingCode') or '').strip().upper()
                    rn=str(bldg.get('buildingRoomNumber') or '').strip().upper()
                    if bc=='MN':
                        mn_rooms.add(rn)
        print('MN rooms in page:',sorted(mn_rooms))
except Exception as e:
    print('Error',e)
