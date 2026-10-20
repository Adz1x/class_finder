import type { ClassMeeting, Dataset, Meta, Room } from "@/components/lib/types";

function meeting(overrides: Partial<ClassMeeting> = {}): ClassMeeting {
  return {
    courseCode: "ISP100H5",
    courseTitle: "Writing for University and Beyond",
    sectionName: "LEC0104",
    sectionType: "Lecture",
    sectionNumber: "0104",
    teachMethod: "LEC",
    instructors: ["Kathryn Franklin"],
    campus: "University of Toronto at Mississauga",
    campusKey: "UTM",
    facultyCode: "ERIN",
    session: "F",
    sessionCode: "20269",
    day: 1,
    start: "12:00",
    end: "15:00",
    buildingCode: "MN",
    buildingName: "Maanjiwe Nendamowinan",
    room: null,
    ...overrides,
  };
}

/** Builds a UTM classroom, for the tests that need a specific occupancy. */
export function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    room: "MN 2100",
    building: "MN",
    buildingName: "Maanjiwe Nendamowinan",
    capacity: "60",
    campusKey: "UTM",
    // The published band, 07:00 to 20:00, with no hole in it. The first
    // capture of this data copied the hour list from the space database's
    // own time selector, which omits 13:00, and the hole was reported as a
    // fact about the University. It was a fact about the capture.
    occupancy: {
      1: {
        7: false,
        8: false,
        9: true,
        10: false,
        11: true,
        12: true,
        13: true,
        14: false,
        15: true,
        16: true,
        17: true,
        18: true,
        19: false,
        20: false,
      },
      2: { 9: false },
    },
    hoursMissing: [],
    ...overrides,
  };
}

const meta: Meta = {
  generatedAt: "2026-10-19T21:40:41.833805+00:00",
  sessions: ["20269", "20271"],
  snapshotWeekStart: "2026-10-19",
  snapshotWeekEnd: "2026-10-23",
  snapshotWeekDays: [1, 2, 3, 4, 5],
  courseRowsFetched: 7383,
  courseRowsExpected: 7383,
  classMeetings: 21408,
  rooms: 65,
  meetingsWithPublishedRoom: 0,
  divisions: ["APSC", "ARCLA", "ARTSC", "ERIN", "FIS", "FPEH", "MUSIC", "SCAR"],
  sourceUrls: {
    courses: "https://api.easi.utoronto.ca/ttb/getPageableCourses",
  },
};

/**
 * The dataset is served one campus at a time, so the fixture is too: each
 * entry is exactly what `/api/schedule/<KEY>` would return.
 */
export const sampleDatasets: Record<string, Dataset> = {
  UTM: {
    campus: "UTM",
    meta,
    classrooms: [],
    availability: {
      source: "UofT Classroom Space Database",
      sourceUrl: "https://metis.utm.utoronto.ca/space/",
      weekStart: "2026-10-19",
      weekEnd: "2026-10-23",
    },
    rooms: [
      makeRoom(),
      makeRoom({ room: "MN 3200", occupancy: { 1: { 9: false, 12: false } } }),
      makeRoom({ room: "IB 379", building: "IB", buildingName: "Instructional Centre" }),
    ],
    classes: [
      meeting(),
      meeting({ sectionName: "LEC0105", instructors: ["Zhaozhe Wang"] }),
      meeting({ sessionCode: "20271", session: "S" }),
      meeting({
        courseCode: "CSC148H1",
        courseTitle: "Introduction to Computer Science (Mental Health)",
        sectionName: "LEC0201",
        buildingCode: "IB",
        buildingName: "Instructional Centre (UTM)",
        day: 2,
        start: "15:00",
        end: "17:00",
      }),
    ],
  },
  UTSG: {
    campus: "UTSG",
    meta,
    availability: null,
    rooms: [],
    classrooms: [
      { building: "BA", room: "1130", name: "Auditorium", capacity: 159 },
      { building: "BA", room: "1160", name: "Adel Sedra Auditorium", capacity: 300 },
    ],
    classes: [
      meeting({
        courseCode: "CSC108H1",
        courseTitle: "Introduction to Computer Science",
        sectionName: "LEC0101",
        campus: "St. George",
        campusKey: "UTSG",
        buildingCode: "BA",
        buildingName: "Bahen Centre for Information Technology",
        day: 3,
        start: "10:00",
        end: "11:00",
      }),
    ],
  },
  UTSC: {
    campus: "UTSC",
    meta,
    availability: null,
    rooms: [],
    classrooms: [],
    classes: [
      meeting({
        courseCode: "ABP102Y1",
        sectionName: "LEC0101",
        campus: "Scarborough",
        campusKey: "UTSC",
        buildingCode: "AA",
        buildingName: "Arts & Administration Building",
        day: 2,
        start: "09:00",
        end: "12:00",
      }),
    ],
  },
};

/**
 * Every campus at once. The pure functions in `schedule.ts` do not care
 * which campus a meeting belongs to, so they are tested against the whole
 * catalogue.
 */
export const sampleClasses = Object.values(sampleDatasets).flatMap(
  (dataset) => dataset.classes,
);

/** Every classroom in the sample. */
export const sampleRooms = sampleDatasets.UTM.rooms;
