import json
import time
import urllib.request

API_URL = "https://api.easi.utoronto.ca/ttb/getPageableCourses"

# Divisions covering St. George (ARTSC, APSC, FALD, MUSIC), UTM (ERIN), and UTSC (SCAR)
CAMPUS_DIVISIONS = {
    "UTSG": ["ARTSC", "APSC", "FALD", "MUSIC"],
    "UTM": ["ERIN"],
    "UTSC": ["SCAR"]
}

# 20269 = Fall 2026, 20271 = Winter 2027
SESSIONS = ["20269", "20271"]

# Official UofT Building Directory Lookup
BUILDING_NAMES = {
    # St. George (UTSG)
    "BA": "Bahen Centre for Information Technology",
    "SS": "Sidney Smith Hall",
    "MP": "McLennan Physical Laboratories",
    "MS": "Medical Sciences Building",
    "MY": "Myhal Centre for Engineering Innovation",
    "GB": "Galbraith Building",
    "SF": "Sandford Fleming Building",
    "WB": "Wallberg Building",
    "UC": "University College",
    "VC": "Victoria College (Old Vic)",
    "NF": "Northrop Frye Hall",
    "CR": "Carr Hall",
    "BR": "Brennan Hall",
    "JM": "John M. Kelly Library",
    "TF": "Teefy Hall",
    "RW": "Ramsay Wright Laboratories",
    "ES": "Earth Sciences Centre",
    "LM": "Lash Miller Chemical Laboratories",
    "EX": "Exam Centre",
    "OI": "Ontario Institute for Studies in Education (OISE)",
    "WI": "Wilson Hall (New College)",
    "WE": "Wetmore Hall (New College)",
    "IN": "Innis College",
    "WW": "Woodsworth College",
    "BL": "Claude T. Bissell Building",
    "FE": "FEUT Building",
    "AB": "Astronomy and Astrophysics Building",
    # Mississauga (UTM)
    "CC": "Communication, Culture and Technology (CCT)",
    "DH": "Deerfield Hall",
    "IB": "Instructional Centre",
    "KN": "Kaneff Centre",
    "MN": "Maanjiwe nendamowinan",
    "DV": "William G. Davis Building",
    "NE": "North Building",
    "SH": "Science Building",
    # Scarborough (UTSC)
    "AA": "Arts & Administration Building",
    "AC": "Academic Resource Centre",
    "BV": "Bladen Wing",
    "HL": "Highland Hall",
    "HW": "Humanities Wing",
    "IA": "Sam Ibrahim Building",
    "IC": "Instructional Centre (UTSC)",
    "KW": "Kina Wiiya Enadong Building",
    "MW": "Social Sciences Building",
    "SW": "Science Wing",
    "SY": "Environmental Science & Chemistry Building"
}

def ms_to_time_str(ms_from_midnight):
    """Converts milliseconds from midnight to 'HH:MM' 24-hour format."""
    total_minutes = int(ms_from_midnight // 60000)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"

def fetch_division_courses(divisions, sessions):
    courses = []
    page = 1
    page_size = 50
    
    while True:
        payload = {
            "courseCodeAndTitleProps": {
                "courseCode": "",
                "courseTitle": "",
                "courseSectionCode": "",
                "searchCourseDescription": False
            },
            "departmentProps": [],
            "campuses": [],
            "sessions": sessions,
            "requirementProps": [],
            "instructor": "",
            "courseLevels": [],
            "deliveryModes": [],
            "dayPreferences": [],
            "timePreferences": [],
            "divisions": divisions,
            "creditWeights": [],
            "availableSpace": False,
            "waitListable": False,
            "page": page,
            "pageSize": page_size,
            "direction": "asc"
        }
        
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (UofT-Empty-Rooms-Scraper)"
            },
            method="POST"
        )
        
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                page_courses = data.get("payload", {}).get("pageableCourse", {}).get("courses", [])
                total_courses = data.get("payload", {}).get("pageableCourse", {}).get("total", 0)
                
                if not page_courses:
                    break
                    
                courses.extend(page_courses)
                print(f"  Fetched page {page} ({len(courses)}/{total_courses} courses)...")
                
                if len(courses) >= total_courses:
                    break
                page += 1
                time.sleep(0.25)  # Polite rate-limiting
        except Exception as e:
            print(f"  Warning on page {page}: {e}")
            break
            
    return courses

def build_room_database():
    db = {"UTSG": {}, "UTM": {}, "UTSC": {}}
    
    for campus, divisions in CAMPUS_DIVISIONS.items():
        print(f"\nScraping {campus} ({', '.join(divisions)})...")
        courses = fetch_division_courses(divisions, SESSIONS)
        
        for course in courses:
            course_code = course.get("code", "")
            section_code = course.get("sectionCode", "")  # F, S, or Y
            
            for section in course.get("sections", []):
                sec_name = section.get("name", "")  # e.g. LEC0101
                
                for mt in section.get("meetingTimes", []):
                    bldg_code = (mt.get("building", {}) or {}).get("buildingCode", "")
                    room_num = (mt.get("building", {}) or {}).get("buildingRoomNumber", "")
                    
                    if not bldg_code or not room_num or bldg_code in ("ON", "OFF", "TBA"):
                        continue
                        
                    start_info = mt.get("start", {}) or {}
                    end_info = mt.get("end", {}) or {}
                    day = start_info.get("day")  # 1 = Mon, 2 = Tue, ..., 5 = Fri
                    start_ms = start_info.get("millisofday")
                    end_ms = end_info.get("millisofday")
                    
                    if not day or start_ms is None or end_ms is None:
                        continue
                        
                    bldg_name = BUILDING_NAMES.get(bldg_code, f"{bldg_code} Building")
                    if bldg_code not in db[campus]:
                        db[campus][bldg_code] = {
                            "code": bldg_code,
                            "name": bldg_name,
                            "rooms": {}
                        }
                        
                    full_room = f"{bldg_code} {room_num}"
                    if full_room not in db[campus][bldg_code]["rooms"]:
                        db[campus][bldg_code]["rooms"][full_room] = []
                        
                    slot = {
                        "day": day,
                        "start": ms_to_time_str(start_ms),
                        "end": ms_to_time_str(end_ms),
                        "course": f"{course_code}{section_code} ({sec_name})",
                        "term": section_code
                    }
                    
                    # Avoid duplicate entries
                    if slot not in db[campus][bldg_code]["rooms"][full_room]:
                        db[campus][bldg_code]["rooms"][full_room].append(slot)
                        
    # Sort slots chronologically per room
    for campus in db:
        for bldg in db[campus]:
            for room in db[campus][bldg]["rooms"]:
                db[campus][bldg]["rooms"][room].sort(key=lambda x: (x["day"], x["start"]))
                
    with open("rooms_data.js", "w", encoding="utf-8") as f:
        f.write("window.UOFT_ROOMS_DATA = ")
        json.dump(db, f, indent=2)
        f.write(";\n")
        
    print("\nSuccess! Saved complete schedule data to rooms_data.js")

if __name__ == "__main__":
    build_room_database()