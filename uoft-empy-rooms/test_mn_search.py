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

# Search all pages to find MN 3210
all_courses = list(course_list)
total = courses.get('total',0)
print('total:',total,'page1 got',len(all_courses))

# Check first page for MN rooms
mn_rooms_page1 = set()
for c in all_courses:
    for sec in c.get('sections',[]):
        for mt in sec.get('meetingTimes',[]):
            bldg=mt.get('building') or {}
            bc=str(bldg.get('buildingCode') or '').strip().upper()
            rn=str(bldg.get('buildingRoomNumber') or '').strip().upper()
            if bc=='MN':
                mn_rooms_page1.add(rn)
print('MN rooms page1:',sorted(mn_rooms_page1))

# Now check sessionCode mapping
for c in all_courses[:5]:
    print('Course:',c.get('code'),'sectionCode:',c.get('sectionCode'))
    for sec in c.get('sections',[]):
        for mt in sec.get('meetingTimes',[]):
            bldg=mt.get('building') or {}
            bc=str(bldg.get('buildingCode') or '').strip().upper()
            rn=str(bldg.get('buildingRoomNumber') or '').strip().upper()
            sc=mt.get('sessionCode') or ''
            print(f"  mt: bc={bc}, rn={rn}, sessionCode={sc}, day={mt.get('start',{}).get('day')}, ms={mt.get('start',{}).get('millisofday')}")