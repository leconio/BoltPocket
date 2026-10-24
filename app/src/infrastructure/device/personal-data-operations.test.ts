import assert from "node:assert/strict";
import test from "node:test";

import {
  PersonalDataOperations,
  type PersonalDataDependencies,
} from "./personal-data-operations.ts";

type MutableEvent = {
  id: string;
  calendarId: string;
  title: string;
  startDate: Date | string;
  endDate: Date | string;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
  timeZone?: string | null;
  url?: string | null;
};

function fixture(platform = "ios") {
  let sequence = 0;
  const events = new Map<string, MutableEvent>();
  const calendars = [
    {
      id: "native-calendar",
      title: "Personal",
      allowsModifications: true,
      isPrimary: true,
      isVisible: true,
      entityType: "event",
    },
  ];
  const dependencies: PersonalDataDependencies = {
    platform,
    createId: () => `id-${++sequence}`,
    hash: async () => "a".repeat(64),
    listCalendars: async () => calendars,
    getCalendar: async (id) => {
      const calendar = calendars.find((candidate) => candidate.id === id);
      if (!calendar) throw new Error("missing calendar");
      return calendar;
    },
    listEvents: async (calendarIds) =>
      [...events.values()].filter((event) =>
        calendarIds.includes(event.calendarId),
      ),
    getEvent: async (id) => {
      const event = events.get(id);
      if (!event) throw new Error("missing event");
      return { ...event };
    },
    createEvent: async (calendarId, details) => {
      const event: MutableEvent = {
        id: `native-event-${sequence}`,
        calendarId,
        title: details.title!,
        startDate: details.startDate!,
        endDate: details.endDate!,
        allDay: details.allDay ?? false,
        location: details.location ?? "",
        notes: details.notes ?? "",
        timeZone: details.timeZone ?? "",
        url: details.url ?? "",
      };
      events.set(event.id, event);
      return { ...event };
    },
    updateEvent: async (id, details) => {
      const event = events.get(id);
      if (!event) throw new Error("missing event");
      if (details.title !== undefined) event.title = details.title;
      if (details.startDate !== undefined) event.startDate = details.startDate;
      if (details.endDate !== undefined) event.endDate = details.endDate;
      if (details.allDay !== undefined) event.allDay = details.allDay;
      if (details.location !== undefined) event.location = details.location;
      if (details.notes !== undefined) event.notes = details.notes;
      if (details.timeZone !== undefined) event.timeZone = details.timeZone;
      if (details.url !== undefined) event.url = details.url;
    },
    deleteEvent: async (id) => {
      if (!events.delete(id)) throw new Error("missing event");
    },
    listReminders: async () => [],
    getReminder: async () => {
      throw new Error("missing reminder");
    },
    createReminder: async () => {
      throw new Error("not used");
    },
    updateReminder: async () => {
      throw new Error("not used");
    },
    deleteReminder: async () => {
      throw new Error("not used");
    },
  };
  return { dependencies, events };
}

test("calendar writes bind a deterministic patch, receipt, and usable recovery", async () => {
  const { dependencies, events } = fixture();
  const operations = new PersonalDataOperations(dependencies);
  const listed = (await operations.execute({
    action: "calendar_list",
    purpose: "Choose a calendar",
  })) as unknown as { calendars: { calendarId: string }[] };
  const calendarId = listed.calendars[0]!.calendarId;
  const created = (await operations.execute({
    action: "calendar_create",
    purpose: "Create the requested meeting",
    calendarId,
    title: "Design review",
    startAt: "2026-08-18T02:00:00.000Z",
    endAt: "2026-08-18T03:00:00.000Z",
  })) as unknown as {
    patch: { text: string; sha256: string };
    receipt: { patchSha256: string };
    recovery: { recoveryId: string };
  };

  assert.equal(created.patch.sha256, "a".repeat(64));
  assert.equal(created.receipt.patchSha256, created.patch.sha256);
  assert.match(created.patch.text, /calendar\.create/u);
  assert.equal(events.size, 1);

  const recovered = (await operations.execute({
    action: "calendar_recover",
    purpose: "Undo the new meeting",
    recoveryId: created.recovery.recoveryId,
  })) as unknown as {
    result: { recovered: boolean };
    patch: { sha256: string };
    receipt: { patchSha256: string };
    recovery: { recoveryId: string };
  };
  assert.equal(recovered.result.recovered, true);
  assert.equal(recovered.receipt.patchSha256, recovered.patch.sha256);
  assert.ok(recovered.recovery.recoveryId);
  assert.equal(events.size, 0);
});

test("calendar event updates recheck the exact target before applying", async () => {
  const { dependencies, events } = fixture();
  events.set("native-event", {
    id: "native-event",
    calendarId: "native-calendar",
    title: "Before",
    startDate: "2026-08-18T02:00:00.000Z",
    endDate: "2026-08-18T03:00:00.000Z",
    allDay: false,
  });
  let reads = 0;
  const originalGet = dependencies.getEvent;
  const operations = new PersonalDataOperations({
    ...dependencies,
    getEvent: async (id) => {
      reads += 1;
      if (reads === 2) events.get(id)!.title = "Changed elsewhere";
      return originalGet(id);
    },
  });
  const listed = (await operations.execute({
    action: "calendar_events",
    purpose: "Find the event",
    startAt: "2026-08-18T00:00:00.000Z",
    endAt: "2026-08-19T00:00:00.000Z",
  })) as unknown as { events: { eventId: string }[] };
  await assert.rejects(
    operations.execute({
      action: "calendar_update",
      purpose: "Rename the event",
      eventId: listed.events[0]!.eventId,
      title: "After",
    }),
    /已经变化/u,
  );
  assert.equal(events.get("native-event")?.title, "Changed elsewhere");
});

test("Android reminders report the platform limit instead of fabricating data", async () => {
  const { dependencies } = fixture("android");
  const operations = new PersonalDataOperations(dependencies);
  await assert.rejects(
    operations.execute({
      action: "reminder_list",
      purpose: "Read reminders",
    }),
    /仅在 iOS/u,
  );
});
