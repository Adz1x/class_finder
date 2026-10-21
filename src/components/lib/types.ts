export type Term = "F" | "S";

export interface ClassMeeting {
  courseCode: string;
  courseTitle: string;
  sectionName: string;
  sectionType: string;
  sectionNumber: string;
  teachMethod: string;
  instructors: string[];
  campus: string;
  campusKey: string;
  facultyCode: string;
  session: string;
  sessionCode: string;
  day: number;
  start: string;
  end: string;
  buildingCode: string;
  buildingName: string;
  /** Room published by the timetable source, or null when it publishes none. */
  room: string | null;
}

export interface Room {
  room: string;
  building: string;
  /** Some campuses publish the room without a building name. */
  buildingName: string | null;
  capacity: string;
  /** The campus the classroom belongs to. */
  campusKey: string;
  /** day (1 = Monday) -> hour -> is the room booked. */
  occupancy: Record<string, Record<string, boolean>>;
  /** Hours the source does not publish at all. */
  hoursMissing: number[];
}

export interface Classroom {
  /** The building the classroom is in. */
  building: string;
  /** The room number, as the University lists it: "1130". */
  room: string;
  /** The room's name, when it has one: "Adel Sedra Auditorium". */
  name: string | null;
  /** How many students it seats, when the University publishes it. */
  capacity: number | null;
  /** The teaching space type: "Lecture Theatre", "Classroom", … */
  type?: string | null;
  /** The AV equipment the University lists for the room. */
  features?: string | null;
  /** Whether the room is listed as physically accessible. */
  physicalAccessibility?: string | null;
  /** Whether the room has an assistive listening system. */
  assistiveListening?: string | null;
  /** The remaining fields Scarborough publishes, kept as published. */
  aura?: string | null;
  emergencyPhone?: string | null;
  entrances?: string | null;
}

export interface Meta {
  generatedAt: string;
  sessions: string[];
  snapshotWeekStart: string;
  snapshotWeekEnd: string;
  snapshotWeekDays: number[];
  courseRowsFetched: number;
  courseRowsExpected: number;
  classMeetings: number;
  rooms: number;
  meetingsWithPublishedRoom: number;
  divisions: string[];
  sourceUrls: Record<string, string>;
}

/** Where a campus's classroom occupancy came from, and for which week. */
export interface Availability {
  source: string;
  sourceUrl: string;
  weekStart: string;
  weekEnd: string;
}

export interface Dataset {
  /** The campus this payload holds. */
  campus: string;
  classes: ClassMeeting[];
  rooms: Room[];
  /** Classrooms the University lists for this campus, without occupancy. */
  classrooms: Classroom[];
  /** The published occupancy for this campus, if there is any. */
  availability: Availability | null;
  meta: Meta;
}

/** What `/api/schedule/<campus>` returns. */
export interface CampusPayload {
  campus: string;
  classes: ClassMeeting[];
  rooms: Room[];
  classrooms: Classroom[];
  availability: Availability | null;
  meta: Meta;
}

export interface TimeContext {
  uoftDay: number;
  nowMins: number;
  time12: string;
  dayName: string;
  term: Term;
  termLabel: string;
}

export type RoomState = "free" | "busy" | "unknown";

export interface RoomStatus {
  state: RoomState;
  statusTitle: string;
  nextFreeText: string;
  subText: string;
  /** Hour the room is booked until, when known. */
  busyUntil: string | null;
  /**
   * Minutes since midnight at which the room is next free, or null when
   * there is no known free hour left in the day. Rooms are ordered by it.
   */
  nextFreeAt: number | null;
}

export interface ScheduleBlock {
  day: number;
  start: string;
  end: string;
  title: string;
  subtitle: string;
  lane: number;
  lanes: number;
  courseCode?: string;
  room?: string | null;
}
