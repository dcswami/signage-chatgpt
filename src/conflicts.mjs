export function deterministicConflictEvent(events, selectedExternalEventId = "") {
  const sorted = [...events].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt)
    || left.endsAt.localeCompare(right.endsAt)
    || String(left.externalEventId).localeCompare(String(right.externalEventId))
  );
  return sorted.find(event => event.externalEventId === selectedExternalEventId) || sorted[0];
}

export function eventsForKiosk(events, conflicts) {
  const hiddenEventIds = new Set();
  for (const conflict of conflicts) {
    const conflictEvents = events.filter(event => conflict.eventIds.includes(event.id));
    const winner = deterministicConflictEvent(conflictEvents, conflict.selectedExternalEventId);
    for (const event of conflictEvents) {
      if (event.id !== winner?.id) hiddenEventIds.add(event.id);
    }
  }
  return events.filter(event => !hiddenEventIds.has(event.id));
}
