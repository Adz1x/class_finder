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

function room(overrides: Partial<Room> = {}): Room {
  return {
    room: "MN 2100",
    building: "MN",
    buildingName: "Maanjiwe Nendamowinan",
    capacity: "60",
    campusKey: "UTM",
    occupancy: {
      1: { 7: false, 8: false, 9: true, 12: true, 14: false },
      2: { 9: false },
    },
    hoursMissing: [13],
    ...overrides,
  };
}

const meta: Meta = {
  generatedAt: "2026-10-19T21:40:41.833805+00:00",
  sessions: ["20269", "20271"],
  snapshotWeekStart: "2026-09-30",
  snapshotWeekEnd: "2026-10-06",
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
    rooms: [
      room(),
      room({ room: "MN 3200", occupancy: { 1: { 9: false, 12: false } } }),
      room({ room: "IB 379", building: "IB", buildingName: "Instructional Centre" }),
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
    rooms: [],
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
    rooms: [],
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
