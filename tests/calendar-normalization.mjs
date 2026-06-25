import assert from "node:assert/strict";
import {
  normalizeGoogleCalendarItems,
  normalizeMicrosoftCalendarItems,
  parseIcsCalendarData
} from "../src/calendar.mjs";

const googleEvents = normalizeGoogleCalendarItems([
  {
    id: "google-instance-1",
    summary: "Recurring Class",
    recurringEventId: "google-series",
    start: { dateTime: "2026-06-25T15:00:00Z" },
    end: { dateTime: "2026-06-25T16:00:00Z" },
    status: "confirmed"
  },
  {
    id: "google-exception-1",
    summary: "Recurring Class - Moved",
    recurringEventId: "google-series",
    originalStartTime: { dateTime: "2026-06-26T15:00:00Z" },
    start: { dateTime: "2026-06-26T17:00:00Z" },
    end: { dateTime: "2026-06-26T18:00:00Z" },
    status: "confirmed"
  },
  {
    id: "google-cancelled",
    summary: "Cancelled Instance",
    recurringEventId: "google-series",
    start: { dateTime: "2026-06-27T15:00:00Z" },
    end: { dateTime: "2026-06-27T16:00:00Z" },
    status: "cancelled"
  }
]);
assert.equal(googleEvents.length, 2);
assert.equal(googleEvents[1].originalTitle, "Recurring Class - Moved");
assert.equal(googleEvents[1].recurring, true);
assert.equal(googleEvents[1].startsAt, "2026-06-26T17:00:00.000Z");

const microsoftEvents = normalizeMicrosoftCalendarItems([
  {
    id: "microsoft-occurrence",
    subject: "Weekly Sabha",
    type: "occurrence",
    start: { dateTime: "2026-06-25T15:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-06-25T16:00:00", timeZone: "UTC" },
    isCancelled: false
  },
  {
    id: "microsoft-exception",
    subject: "Weekly Sabha - Moved",
    type: "exception",
    start: { dateTime: "2026-06-26T17:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-06-26T18:00:00", timeZone: "UTC" },
    isCancelled: false
  },
  {
    id: "microsoft-cancelled",
    subject: "Cancelled",
    type: "occurrence",
    start: { dateTime: "2026-06-27T15:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-06-27T16:00:00", timeZone: "UTC" },
    isCancelled: true
  }
]);
assert.equal(microsoftEvents.length, 2);
assert.equal(microsoftEvents[1].originalTitle, "Weekly Sabha - Moved");
assert.equal(microsoftEvents[1].recurring, true);
assert.equal(microsoftEvents[1].startsAt, "2026-06-26T17:00:00.000Z");

const icsEvents = parseIcsCalendarData([
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:ics-series",
  "DTSTART:20260625T150000Z",
  "DTEND:20260625T160000Z",
  "RRULE:FREQ=DAILY;COUNT=3",
  "EXDATE:20260626T150000Z",
  "SUMMARY:ICS Recurring Class",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ics-series",
  "RECURRENCE-ID:20260627T150000Z",
  "DTSTART:20260627T170000Z",
  "DTEND:20260627T180000Z",
  "SUMMARY:ICS Recurring Class - Moved",
  "END:VEVENT",
  "END:VCALENDAR"
].join("\r\n"), new Date("2026-06-24T00:00:00Z"), new Date("2026-06-30T00:00:00Z"));
assert.equal(icsEvents.length, 2);
assert.equal(icsEvents[0].startsAt, "2026-06-25T15:00:00.000Z");
assert.equal(icsEvents[1].startsAt, "2026-06-27T17:00:00.000Z");
assert.equal(icsEvents[1].originalTitle, "ICS Recurring Class - Moved");

console.log("Calendar recurrence normalization checks passed");
