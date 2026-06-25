import assert from "node:assert/strict";
import { deterministicConflictEvent, eventsForKiosk } from "../src/conflicts.mjs";

const events = [
  { id: "later", externalEventId: "event-b", startsAt: "2026-06-25T15:30:00.000Z", endsAt: "2026-06-25T16:30:00.000Z" },
  { id: "earliest-z", externalEventId: "event-z", startsAt: "2026-06-25T15:00:00.000Z", endsAt: "2026-06-25T16:00:00.000Z" },
  { id: "earliest-a", externalEventId: "event-a", startsAt: "2026-06-25T15:00:00.000Z", endsAt: "2026-06-25T16:00:00.000Z" },
  { id: "independent", externalEventId: "event-c", startsAt: "2026-06-25T18:00:00.000Z", endsAt: "2026-06-25T19:00:00.000Z" }
];
const conflict = {
  eventIds: ["later", "earliest-z", "earliest-a"],
  selectedExternalEventId: null
};

assert.equal(deterministicConflictEvent(events.slice(0, 3)).id, "earliest-a");
assert.equal(deterministicConflictEvent(events.slice(0, 3), "event-b").id, "later");
assert.deepEqual(eventsForKiosk(events, [conflict]).map(event => event.id), ["earliest-a", "independent"]);
assert.deepEqual(
  eventsForKiosk(events, [{ ...conflict, selectedExternalEventId: "event-b" }]).map(event => event.id),
  ["later", "independent"]
);

console.log("Calendar conflict policy checks passed");
