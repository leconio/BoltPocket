import type * as ExpoCalendar from "expo-calendar";

import type { AgentDeviceCapabilityInput } from "@/application/ports/device-capabilities";

type CalendarKind = "event" | "reminder";

type NativeCalendar = Readonly<{
  id: string;
  title: string;
  allowsModifications: boolean;
  isPrimary?: boolean;
  isVisible?: boolean;
  entityType?: string;
  sourceTitle?: string;
}>;

type EventDetails = Readonly<{
  title?: string;
  startDate?: Date;
  endDate?: Date;
  allDay?: boolean;
  location?: string;
  notes?: string;
  timeZone?: string;
  url?: string;
}>;

type NativeEvent = Readonly<{
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
}>;

type ReminderDetails = Readonly<{
  title?: string;
  startDate?: Date;
  dueDate?: Date;
  allDay?: boolean;
  completed?: boolean;
  completionDate?: Date | null;
  location?: string;
  notes?: string;
  timeZone?: string;
  url?: string;
}>;

type NativeReminder = Readonly<{
  id: string;
  calendarId: string;
  title?: string;
  startDate?: Date | string;
  dueDate?: Date | string;
  allDay?: boolean;
  completed?: boolean;
  completionDate?: Date | string;
  location?: string | null;
  notes?: string | null;
  timeZone?: string | null;
  url?: string | null;
}>;

export type PersonalDataDependencies = Readonly<{
  platform: string;
  resolvePlatform?: () => Promise<string>;
  createId: () => string;
  hash: (value: string) => Promise<string>;
  listCalendars: (kind: CalendarKind) => Promise<readonly NativeCalendar[]>;
  getCalendar: (id: string) => Promise<NativeCalendar>;
  listEvents: (
    calendarIds: readonly string[],
    start: Date,
    end: Date,
  ) => Promise<readonly NativeEvent[]>;
  getEvent: (id: string) => Promise<NativeEvent>;
  createEvent: (
    calendarId: string,
    details: EventDetails,
  ) => Promise<NativeEvent>;
  updateEvent: (id: string, details: EventDetails) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  listReminders: (
    calendarId: string,
    start: Date | null,
    end: Date | null,
    completed?: boolean,
  ) => Promise<readonly NativeReminder[]>;
  getReminder: (id: string) => Promise<NativeReminder>;
  createReminder: (
    calendarId: string,
    details: ReminderDetails,
  ) => Promise<NativeReminder>;
  updateReminder: (id: string, details: ReminderDetails) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
}>;

type Recovery =
  | Readonly<{
      kind: "calendar-created";
      calendarId: string;
      eventId: string;
      expected: EventSnapshot;
    }>
  | Readonly<{
      kind: "calendar-updated";
      eventId: string;
      before: EventSnapshot;
      expected: EventSnapshot;
    }>
  | Readonly<{
      kind: "calendar-deleted";
      before: EventSnapshot;
    }>
  | Readonly<{
      kind: "reminder-created";
      calendarId: string;
      reminderId: string;
      expected: ReminderSnapshot;
    }>
  | Readonly<{
      kind: "reminder-updated";
      reminderId: string;
      before: ReminderSnapshot;
      expected: ReminderSnapshot;
    }>
  | Readonly<{
      kind: "reminder-deleted";
      before: ReminderSnapshot;
    }>;

type EventSnapshot = ReturnType<typeof eventSnapshot>;
type ReminderSnapshot = ReturnType<typeof reminderSnapshot>;

const DEFAULT_DEPENDENCIES: PersonalDataDependencies = {
  platform: "native",
  resolvePlatform: async () => (await import("react-native")).Platform.OS,
  createId: () => `personal-${runtimeId()}`,
  hash: async (value) => {
    const Crypto = await import("expo-crypto");
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  },
  listCalendars: async (kind) => {
    const Calendar = await calendarApi();
    return (
      await Calendar.getCalendars(
        kind === "event"
          ? Calendar.EntityTypes.EVENT
          : Calendar.EntityTypes.REMINDER,
      )
    ).map(calendarRecord);
  },
  getCalendar: async (id) => {
    const Calendar = await calendarApi();
    return calendarRecord(await Calendar.ExpoCalendar.get(id));
  },
  listEvents: async (calendarIds, start, end) => {
    const Calendar = await calendarApi();
    return (await Calendar.listEvents([...calendarIds], start, end)).map(
      eventRecord,
    );
  },
  getEvent: async (id) => {
    const Calendar = await calendarApi();
    return eventRecord(await Calendar.ExpoCalendarEvent.get(id));
  },
  createEvent: async (calendarId, details) => {
    const Calendar = await calendarApi();
    const calendar = await Calendar.ExpoCalendar.get(calendarId);
    return eventRecord(await calendar.createEvent(details));
  },
  updateEvent: async (id, details) => {
    const Calendar = await calendarApi();
    const event = await Calendar.ExpoCalendarEvent.get(id);
    await event.update(details);
  },
  deleteEvent: async (id) => {
    const Calendar = await calendarApi();
    const event = await Calendar.ExpoCalendarEvent.get(id);
    await event.delete();
  },
  listReminders: async (calendarId, start, end, completed) => {
    const Calendar = await calendarApi();
    const calendar = await Calendar.ExpoCalendar.get(calendarId);
    const status =
      completed === undefined
        ? null
        : completed
          ? Calendar.ReminderStatus.COMPLETED
          : Calendar.ReminderStatus.INCOMPLETE;
    return (await calendar.listReminders(start, end, status)).flatMap(
      (reminder) => {
        const record = reminderRecord(reminder);
        return record ? [record] : [];
      },
    );
  },
  getReminder: async (id) => {
    const Calendar = await calendarApi();
    const reminder = reminderRecord(
      await Calendar.ExpoCalendarReminder.get(id),
    );
    if (!reminder) throw new Error("提醒事项没有稳定的系统 ID。");
    return reminder;
  },
  createReminder: async (calendarId, details) => {
    const Calendar = await calendarApi();
    const calendar = await Calendar.ExpoCalendar.get(calendarId);
    const reminder = reminderRecord(
      await calendar.createReminder(
        details as unknown as Partial<ExpoCalendar.ExpoCalendarReminder>,
      ),
    );
    if (!reminder) throw new Error("系统没有返回提醒事项 ID。");
    return reminder;
  },
  updateReminder: async (id, details) => {
    const Calendar = await calendarApi();
    const reminder = await Calendar.ExpoCalendarReminder.get(id);
    await reminder.update(
      details as unknown as Partial<ExpoCalendar.ModifiableReminderProperties>,
    );
  },
  deleteReminder: async (id) => {
    const Calendar = await calendarApi();
    const reminder = await Calendar.ExpoCalendarReminder.get(id);
    await reminder.delete();
  },
};

export class PersonalDataOperations {
  readonly #dependencies: PersonalDataDependencies;
  readonly #calendars: NativeHandleRegistry;
  readonly #events: NativeHandleRegistry;
  readonly #reminders: NativeHandleRegistry;
  readonly #recoveries = new Map<string, Recovery>();

  constructor(dependencies: PersonalDataDependencies = DEFAULT_DEPENDENCIES) {
    this.#dependencies = dependencies;
    this.#calendars = new NativeHandleRegistry(
      "calendar",
      dependencies.createId,
    );
    this.#events = new NativeHandleRegistry("event", dependencies.createId);
    this.#reminders = new NativeHandleRegistry(
      "reminder",
      dependencies.createId,
    );
  }

  async execute(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    switch (input.action) {
      case "calendar_list":
        return this.#listCalendars("event", signal);
      case "calendar_events":
        return this.#listEvents(input, signal);
      case "calendar_create":
        return this.#createEvent(input, signal);
      case "calendar_update":
        return this.#updateEvent(input, signal);
      case "calendar_delete":
        return this.#deleteEvent(input, signal);
      case "calendar_recover":
        return this.#recover(input, "calendar", signal);
      case "reminder_list":
        return this.#listReminders(input, signal);
      case "reminder_create":
        return this.#createReminder(input, signal);
      case "reminder_update":
        return this.#updateReminder(input, signal);
      case "reminder_delete":
        return this.#deleteReminder(input, signal);
      case "reminder_recover":
        return this.#recover(input, "reminder", signal);
      default:
        throw new Error("不是日历或提醒事项动作。");
    }
  }

  async #listCalendars(kind: CalendarKind, signal?: AbortSignal) {
    await this.#assertPlatform(kind);
    assertNotAborted(signal);
    const calendars = await this.#dependencies.listCalendars(kind);
    assertNotAborted(signal);
    return Object.freeze({
      kind,
      count: calendars.length,
      calendars: calendars
        .map((calendar) => this.#publicCalendar(calendar))
        .sort((left, right) => left.title.localeCompare(right.title)),
    });
  }

  async #listEvents(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    const range = dateRange(input.startAt, input.endAt, false);
    if (!range.start || !range.end) throw new Error("日历查询时间范围无效。");
    const calendars = await this.#selectedCalendars("event", input.calendarId);
    assertNotAborted(signal);
    const events = await this.#dependencies.listEvents(
      calendars.map((calendar) => calendar.id),
      range.start,
      range.end,
    );
    const limit = boundedInteger(input.maxResults, 1, 100, 50);
    const selected = [...events]
      .sort(
        (left, right) =>
          dateValue(left.startDate).getTime() -
          dateValue(right.startDate).getTime(),
      )
      .slice(0, limit);
    return Object.freeze({
      range: range.public,
      count: selected.length,
      truncated: events.length > selected.length,
      events: selected.map((event) => this.#publicEvent(event)),
    });
  }

  async #createEvent(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    const calendar = await this.#writableCalendar("event", input.calendarId);
    const details = eventDetails(input, true);
    const after = eventSnapshotFromDetails(calendar.id, details);
    const patch = await this.#patch("calendar.create", null, after);
    const currentCalendar = await this.#dependencies.getCalendar(calendar.id);
    if (!currentCalendar.allowsModifications) {
      throw new Error("目标日历已变为只读，请重新列出日历。");
    }
    assertNotAborted(signal);
    const created = await this.#dependencies.createEvent(calendar.id, details);
    const verified = await this.#dependencies.getEvent(created.id);
    const expected = eventSnapshot(verified);
    const recoveryId = this.#storeRecovery({
      kind: "calendar-created",
      calendarId: calendar.id,
      eventId: created.id,
      expected,
    });
    return this.#mutationResult(
      "calendar_create",
      patch,
      recoveryId,
      this.#publicEvent(verified),
    );
  }

  async #updateEvent(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    const id = this.#events.resolve(requiredText(input.eventId, "eventId"));
    const beforeNative = await this.#dependencies.getEvent(id);
    const before = eventSnapshot(beforeNative);
    const details = eventDetails(input, false);
    if (Object.keys(details).length === 0) {
      throw new Error("calendar_update 至少需要一个要修改的字段。");
    }
    const after = mergeEventSnapshot(before, details);
    validateEventSnapshot(after);
    const patch = await this.#patch("calendar.update", before, after);
    const current = eventSnapshot(await this.#dependencies.getEvent(id));
    assertSameSnapshot(current, before, "日程在应用前已经变化，请重新读取。");
    assertNotAborted(signal);
    await this.#dependencies.updateEvent(id, details);
    const verified = eventSnapshot(await this.#dependencies.getEvent(id));
    assertSameSnapshot(verified, after, "系统没有完整应用日程修改。");
    const recoveryId = this.#storeRecovery({
      kind: "calendar-updated",
      eventId: id,
      before,
      expected: verified,
    });
    return this.#mutationResult(
      "calendar_update",
      patch,
      recoveryId,
      this.#publicEventSnapshot(verified, id),
    );
  }

  async #deleteEvent(input: AgentDeviceCapabilityInput, signal?: AbortSignal) {
    const id = this.#events.resolve(requiredText(input.eventId, "eventId"));
    const before = eventSnapshot(await this.#dependencies.getEvent(id));
    const patch = await this.#patch("calendar.delete", before, null);
    const current = eventSnapshot(await this.#dependencies.getEvent(id));
    assertSameSnapshot(current, before, "日程在删除前已经变化，请重新读取。");
    assertNotAborted(signal);
    await this.#dependencies.deleteEvent(id);
    const recoveryId = this.#storeRecovery({
      kind: "calendar-deleted",
      before,
    });
    return this.#mutationResult("calendar_delete", patch, recoveryId, {
      deleted: true,
      eventId: input.eventId,
    });
  }

  async #listReminders(
    input: AgentDeviceCapabilityInput,
    signal?: AbortSignal,
  ) {
    await this.#assertPlatform("reminder");
    const range = dateRange(input.startAt, input.endAt, false);
    const calendars = await this.#selectedCalendars(
      "reminder",
      input.calendarId,
    );
    const reminders: NativeReminder[] = [];
    for (const calendar of calendars) {
      assertNotAborted(signal);
      reminders.push(
        ...(await this.#dependencies.listReminders(
          calendar.id,
          range.start,
          range.end,
          input.completed,
        )),
      );
    }
    const limit = boundedInteger(input.maxResults, 1, 100, 50);
    const selected = reminders
      .sort(
        (left, right) =>
          (optionalDateValue(left.dueDate)?.getTime() ??
            Number.MAX_SAFE_INTEGER) -
          (optionalDateValue(right.dueDate)?.getTime() ??
            Number.MAX_SAFE_INTEGER),
      )
      .slice(0, limit);
    return Object.freeze({
      platform: "ios",
      range: range.public,
      count: selected.length,
      truncated: reminders.length > selected.length,
      reminders: selected.map((reminder) => this.#publicReminder(reminder)),
    });
  }

  async #createReminder(
    input: AgentDeviceCapabilityInput,
    signal?: AbortSignal,
  ) {
    await this.#assertPlatform("reminder");
    const calendar = await this.#writableCalendar("reminder", input.calendarId);
    const details = reminderDetails(input, true);
    const after = reminderSnapshotFromDetails(calendar.id, details);
    const patch = await this.#patch("reminder.create", null, after);
    const currentCalendar = await this.#dependencies.getCalendar(calendar.id);
    if (!currentCalendar.allowsModifications) {
      throw new Error("目标提醒列表已变为只读，请重新列出。");
    }
    assertNotAborted(signal);
    const created = await this.#dependencies.createReminder(
      calendar.id,
      details,
    );
    const verified = await this.#dependencies.getReminder(created.id);
    const expected = reminderSnapshot(verified);
    const recoveryId = this.#storeRecovery({
      kind: "reminder-created",
      calendarId: calendar.id,
      reminderId: created.id,
      expected,
    });
    return this.#mutationResult(
      "reminder_create",
      patch,
      recoveryId,
      this.#publicReminder(verified),
    );
  }

  async #updateReminder(
    input: AgentDeviceCapabilityInput,
    signal?: AbortSignal,
  ) {
    await this.#assertPlatform("reminder");
    const id = this.#reminders.resolve(
      requiredText(input.reminderId, "reminderId"),
    );
    const before = reminderSnapshot(await this.#dependencies.getReminder(id));
    const details = reminderDetails(input, false);
    if (Object.keys(details).length === 0) {
      throw new Error("reminder_update 至少需要一个要修改的字段。");
    }
    const after = mergeReminderSnapshot(before, details);
    const patch = await this.#patch("reminder.update", before, after);
    const current = reminderSnapshot(await this.#dependencies.getReminder(id));
    assertSameSnapshot(
      current,
      before,
      "提醒事项在应用前已经变化，请重新读取。",
    );
    assertNotAborted(signal);
    await this.#dependencies.updateReminder(id, details);
    const verified = reminderSnapshot(await this.#dependencies.getReminder(id));
    assertSameSnapshot(verified, after, "系统没有完整应用提醒事项修改。");
    const recoveryId = this.#storeRecovery({
      kind: "reminder-updated",
      reminderId: id,
      before,
      expected: verified,
    });
    return this.#mutationResult(
      "reminder_update",
      patch,
      recoveryId,
      this.#publicReminderSnapshot(verified, id),
    );
  }

  async #deleteReminder(
    input: AgentDeviceCapabilityInput,
    signal?: AbortSignal,
  ) {
    await this.#assertPlatform("reminder");
    const id = this.#reminders.resolve(
      requiredText(input.reminderId, "reminderId"),
    );
    const before = reminderSnapshot(await this.#dependencies.getReminder(id));
    const patch = await this.#patch("reminder.delete", before, null);
    const current = reminderSnapshot(await this.#dependencies.getReminder(id));
    assertSameSnapshot(
      current,
      before,
      "提醒事项在删除前已经变化，请重新读取。",
    );
    assertNotAborted(signal);
    await this.#dependencies.deleteReminder(id);
    const recoveryId = this.#storeRecovery({
      kind: "reminder-deleted",
      before,
    });
    return this.#mutationResult("reminder_delete", patch, recoveryId, {
      deleted: true,
      reminderId: input.reminderId,
    });
  }

  async #recover(
    input: AgentDeviceCapabilityInput,
    family: "calendar" | "reminder",
    signal?: AbortSignal,
  ) {
    await this.#assertPlatform(family === "calendar" ? "event" : "reminder");
    const recoveryId = requiredText(input.recoveryId, "recoveryId");
    const recovery = this.#recoveries.get(recoveryId);
    if (!recovery || !recovery.kind.startsWith(family)) {
      throw new Error("恢复操作不存在、已使用或不属于当前能力。");
    }
    let result: Readonly<Record<string, unknown>>;
    let nextRecovery: Recovery;
    let patch: Readonly<{ text: string; sha256: string }>;
    if (recovery.kind === "calendar-created") {
      const current = eventSnapshot(
        await this.#dependencies.getEvent(recovery.eventId),
      );
      assertSameSnapshot(
        current,
        recovery.expected,
        "日程已变化，不能安全恢复。",
      );
      patch = await this.#patch(
        "calendar.recover.delete-created",
        current,
        null,
      );
      assertNotAborted(signal);
      await this.#dependencies.deleteEvent(recovery.eventId);
      result = { deletedCreatedEvent: true };
      nextRecovery = { kind: "calendar-deleted", before: current };
    } else if (recovery.kind === "calendar-updated") {
      const current = eventSnapshot(
        await this.#dependencies.getEvent(recovery.eventId),
      );
      assertSameSnapshot(
        current,
        recovery.expected,
        "日程已变化，不能安全恢复。",
      );
      patch = await this.#patch(
        "calendar.recover.restore-updated",
        current,
        recovery.before,
      );
      assertNotAborted(signal);
      await this.#dependencies.updateEvent(
        recovery.eventId,
        eventDetailsFromSnapshot(recovery.before),
      );
      const verified = eventSnapshot(
        await this.#dependencies.getEvent(recovery.eventId),
      );
      assertSameSnapshot(
        verified,
        recovery.before,
        "系统没有完整恢复日程修改。",
      );
      result = this.#publicEventSnapshot(verified, recovery.eventId);
      nextRecovery = {
        kind: "calendar-updated",
        eventId: recovery.eventId,
        before: current,
        expected: verified,
      };
    } else if (recovery.kind === "calendar-deleted") {
      const calendar = await this.#dependencies.getCalendar(
        recovery.before.calendarId,
      );
      if (!calendar.allowsModifications) throw new Error("原日历当前不可写。");
      patch = await this.#patch(
        "calendar.recover.recreate-deleted",
        null,
        recovery.before,
      );
      assertNotAborted(signal);
      const restored = await this.#dependencies.createEvent(
        recovery.before.calendarId,
        eventDetailsFromSnapshot(recovery.before),
      );
      const verified = await this.#dependencies.getEvent(restored.id);
      const expected = eventSnapshot(verified);
      result = this.#publicEvent(verified);
      nextRecovery = {
        kind: "calendar-created",
        calendarId: recovery.before.calendarId,
        eventId: restored.id,
        expected,
      };
    } else if (recovery.kind === "reminder-created") {
      const current = reminderSnapshot(
        await this.#dependencies.getReminder(recovery.reminderId),
      );
      assertSameSnapshot(
        current,
        recovery.expected,
        "提醒事项已变化，不能安全恢复。",
      );
      patch = await this.#patch(
        "reminder.recover.delete-created",
        current,
        null,
      );
      assertNotAborted(signal);
      await this.#dependencies.deleteReminder(recovery.reminderId);
      result = { deletedCreatedReminder: true };
      nextRecovery = { kind: "reminder-deleted", before: current };
    } else if (recovery.kind === "reminder-updated") {
      const current = reminderSnapshot(
        await this.#dependencies.getReminder(recovery.reminderId),
      );
      assertSameSnapshot(
        current,
        recovery.expected,
        "提醒事项已变化，不能安全恢复。",
      );
      patch = await this.#patch(
        "reminder.recover.restore-updated",
        current,
        recovery.before,
      );
      assertNotAborted(signal);
      await this.#dependencies.updateReminder(
        recovery.reminderId,
        reminderDetailsFromSnapshot(recovery.before),
      );
      const verified = reminderSnapshot(
        await this.#dependencies.getReminder(recovery.reminderId),
      );
      assertSameSnapshot(
        verified,
        recovery.before,
        "系统没有完整恢复提醒事项修改。",
      );
      result = this.#publicReminderSnapshot(verified, recovery.reminderId);
      nextRecovery = {
        kind: "reminder-updated",
        reminderId: recovery.reminderId,
        before: current,
        expected: verified,
      };
    } else {
      const calendar = await this.#dependencies.getCalendar(
        recovery.before.calendarId,
      );
      if (!calendar.allowsModifications)
        throw new Error("原提醒列表当前不可写。");
      patch = await this.#patch(
        "reminder.recover.recreate-deleted",
        null,
        recovery.before,
      );
      assertNotAborted(signal);
      const restored = await this.#dependencies.createReminder(
        recovery.before.calendarId,
        reminderDetailsFromSnapshot(recovery.before),
      );
      const verified = await this.#dependencies.getReminder(restored.id);
      const expected = reminderSnapshot(verified);
      result = this.#publicReminder(verified);
      nextRecovery = {
        kind: "reminder-created",
        calendarId: recovery.before.calendarId,
        reminderId: restored.id,
        expected,
      };
    }
    this.#recoveries.delete(recoveryId);
    const nextRecoveryId = this.#storeRecovery(nextRecovery);
    return this.#mutationResult(`${family}_recover`, patch, nextRecoveryId, {
      recovered: true,
      previousRecoveryId: recoveryId,
      recoveredAt: new Date().toISOString(),
      result,
    });
  }

  async #selectedCalendars(kind: CalendarKind, handle?: string) {
    await this.#assertPlatform(kind);
    if (handle) {
      return [
        await this.#dependencies.getCalendar(this.#calendars.resolve(handle)),
      ];
    }
    return [...(await this.#dependencies.listCalendars(kind))];
  }

  async #writableCalendar(kind: CalendarKind, handle?: string) {
    const calendars = await this.#selectedCalendars(kind, handle);
    const writable = calendars
      .filter((calendar) => calendar.allowsModifications)
      .sort(
        (left, right) =>
          Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)) ||
          Number(Boolean(right.isVisible)) - Number(Boolean(left.isVisible)) ||
          left.title.localeCompare(right.title),
      )[0];
    if (!writable) {
      throw new Error(
        kind === "event"
          ? "没有可写日历；请先在系统日历中创建或启用一个日历。"
          : "没有可写提醒列表；请先在系统提醒事项中创建或启用一个列表。",
      );
    }
    return writable;
  }

  #publicCalendar(calendar: NativeCalendar) {
    return Object.freeze({
      calendarId: this.#calendars.record(calendar.id),
      title: calendar.title,
      allowsModifications: calendar.allowsModifications,
      isPrimary: calendar.isPrimary ?? false,
      isVisible: calendar.isVisible ?? true,
      ...(calendar.entityType ? { entityType: calendar.entityType } : {}),
      ...(calendar.sourceTitle ? { source: calendar.sourceTitle } : {}),
    });
  }

  #publicEvent(event: NativeEvent) {
    return this.#publicEventSnapshot(eventSnapshot(event), event.id);
  }

  #publicEventSnapshot(snapshot: EventSnapshot, nativeId: string) {
    return Object.freeze({
      eventId: this.#events.record(nativeId),
      calendarId: this.#calendars.record(snapshot.calendarId),
      ...publicSnapshot(snapshot, ["calendarId"]),
    });
  }

  #publicReminder(reminder: NativeReminder) {
    return this.#publicReminderSnapshot(
      reminderSnapshot(reminder),
      reminder.id,
    );
  }

  #publicReminderSnapshot(snapshot: ReminderSnapshot, nativeId: string) {
    return Object.freeze({
      reminderId: this.#reminders.record(nativeId),
      calendarId: this.#calendars.record(snapshot.calendarId),
      ...publicSnapshot(snapshot, ["calendarId"]),
    });
  }

  async #patch(operation: string, before: unknown, after: unknown) {
    const text = canonicalJson({ operation, before, after });
    return Object.freeze({
      text,
      sha256: await this.#dependencies.hash(text),
    });
  }

  #storeRecovery(recovery: Recovery) {
    const id = `recovery-${this.#dependencies.createId()}`;
    this.#recoveries.set(id, recovery);
    return id;
  }

  #mutationResult(
    action: string,
    patch: Readonly<{ text: string; sha256: string }>,
    recoveryId: string,
    result: unknown,
  ) {
    return Object.freeze({
      result,
      patch,
      receipt: {
        id: `receipt-${this.#dependencies.createId()}`,
        action,
        patchSha256: patch.sha256,
        appliedAt: new Date().toISOString(),
      },
      recovery: { available: true, recoveryId },
    });
  }

  async #assertPlatform(kind: CalendarKind) {
    const platform = this.#dependencies.resolvePlatform
      ? await this.#dependencies.resolvePlatform()
      : this.#dependencies.platform;
    if (!["android", "ios"].includes(platform)) {
      throw new Error("当前平台不支持系统日历。");
    }
    if (kind === "reminder" && platform !== "ios") {
      throw new Error(
        "系统提醒事项原生接口仅在 iOS 可用；Android 不会返回伪造数据。",
      );
    }
  }
}

export function personalDataDescription(input: AgentDeviceCapabilityInput) {
  if (input.action.startsWith("calendar_")) {
    if (input.action === "calendar_list") return "读取系统日历目录";
    if (input.action === "calendar_events") {
      return `读取 ${input.startAt ?? "默认起点"} 至 ${input.endAt ?? "默认终点"} 的有界日程`;
    }
    return `执行日历动作 ${input.action}，并生成 Patch、回执和恢复操作`;
  }
  if (input.action.startsWith("reminder_")) {
    return `执行提醒事项动作 ${input.action}，并为写操作生成 Patch、回执和恢复操作`;
  }
  throw new Error("不是日历或提醒事项动作。");
}

class NativeHandleRegistry {
  readonly #prefix: string;
  readonly #createId: () => string;
  readonly #nativeByHandle = new Map<string, string>();
  readonly #handleByNative = new Map<string, string>();

  constructor(prefix: string, createId: () => string) {
    this.#prefix = prefix;
    this.#createId = createId;
  }

  record(nativeId: string) {
    const existing = this.#handleByNative.get(nativeId);
    if (existing) return existing;
    const handle = `${this.#prefix}-${this.#createId()}`;
    this.#handleByNative.set(nativeId, handle);
    this.#nativeByHandle.set(handle, nativeId);
    return handle;
  }

  resolve(handle: string) {
    const nativeId = this.#nativeByHandle.get(handle);
    if (!nativeId) {
      throw new Error(`${this.#prefix} 句柄不存在或 App 已重启，请重新列出。`);
    }
    return nativeId;
  }
}

function calendarRecord(value: ExpoCalendar.ExpoCalendar): NativeCalendar {
  return {
    id: value.id,
    title: value.title,
    allowsModifications: value.allowsModifications,
    ...(value.isPrimary === undefined ? {} : { isPrimary: value.isPrimary }),
    ...(value.isVisible === undefined ? {} : { isVisible: value.isVisible }),
    ...(value.entityType ? { entityType: value.entityType } : {}),
    ...(value.source?.name ? { sourceTitle: value.source.name } : {}),
  };
}

function eventRecord(value: ExpoCalendar.ExpoCalendarEvent): NativeEvent {
  return {
    id: value.id,
    calendarId: value.calendarId,
    title: value.title,
    startDate: value.startDate,
    endDate: value.endDate,
    allDay: value.allDay,
    location: value.location,
    notes: value.notes,
    timeZone: value.timeZone,
    url: value.url,
  };
}

function reminderRecord(
  value: ExpoCalendar.ExpoCalendarReminder,
): NativeReminder | null {
  if (!value.id || !value.calendarId) return null;
  return {
    id: value.id,
    calendarId: value.calendarId,
    title: value.title,
    startDate: value.startDate,
    dueDate: value.dueDate,
    allDay: value.allDay,
    completed: value.completed,
    completionDate: value.completionDate,
    location: value.location,
    notes: value.notes,
    timeZone: value.timeZone,
    url: value.url,
  };
}

function eventSnapshot(value: NativeEvent) {
  return Object.freeze({
    calendarId: value.calendarId,
    title: value.title,
    startAt: dateValue(value.startDate).toISOString(),
    endAt: dateValue(value.endDate).toISOString(),
    allDay: value.allDay,
    location: value.location ?? "",
    notes: value.notes ?? "",
    timeZone: value.timeZone ?? "",
    url: value.url ?? "",
  });
}

function eventSnapshotFromDetails(calendarId: string, details: EventDetails) {
  if (!details.title || !details.startDate || !details.endDate) {
    throw new Error("新日程缺少标题、开始时间或结束时间。");
  }
  return Object.freeze({
    calendarId,
    title: details.title,
    startAt: details.startDate.toISOString(),
    endAt: details.endDate.toISOString(),
    allDay: details.allDay ?? false,
    location: details.location ?? "",
    notes: details.notes ?? "",
    timeZone: details.timeZone ?? "",
    url: details.url ?? "",
  });
}

function reminderSnapshot(value: NativeReminder) {
  return Object.freeze({
    calendarId: value.calendarId,
    title: value.title ?? "",
    startAt: optionalDateValue(value.startDate)?.toISOString() ?? "",
    dueAt: optionalDateValue(value.dueDate)?.toISOString() ?? "",
    allDay: value.allDay ?? false,
    completed: value.completed ?? false,
    completionAt: optionalDateValue(value.completionDate)?.toISOString() ?? "",
    location: value.location ?? "",
    notes: value.notes ?? "",
    timeZone: value.timeZone ?? "",
    url: value.url ?? "",
  });
}

function reminderSnapshotFromDetails(
  calendarId: string,
  details: ReminderDetails,
) {
  if (!details.title) throw new Error("新提醒事项缺少标题。");
  return Object.freeze({
    calendarId,
    title: details.title,
    startAt: details.startDate?.toISOString() ?? "",
    dueAt: details.dueDate?.toISOString() ?? "",
    allDay: details.allDay ?? false,
    completed: details.completed ?? false,
    completionAt: details.completionDate?.toISOString() ?? "",
    location: details.location ?? "",
    notes: details.notes ?? "",
    timeZone: details.timeZone ?? "",
    url: details.url ?? "",
  });
}

function eventDetails(input: AgentDeviceCapabilityInput, creating: boolean) {
  const details: EventDetails = {
    ...(input.title === undefined
      ? {}
      : { title: boundedText(input.title, 240, "日程标题无效。", true) }),
    ...(input.startAt === undefined
      ? {}
      : { startDate: requiredDate(input.startAt, "startAt") }),
    ...(input.endAt === undefined
      ? {}
      : { endDate: requiredDate(input.endAt, "endAt") }),
    ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
    ...(input.location === undefined
      ? {}
      : { location: boundedText(input.location, 500, "日程地点过长。") }),
    ...(input.notes === undefined
      ? {}
      : { notes: boundedText(input.notes, 8_000, "日程备注过长。") }),
    ...(input.timeZone === undefined
      ? {}
      : { timeZone: boundedText(input.timeZone, 120, "日程时区无效。", true) }),
    ...(input.url === undefined
      ? {}
      : { url: boundedText(input.url, 2_048, "日程 URL 过长。") }),
  };
  if (creating) {
    if (!details.title || !details.startDate || !details.endDate) {
      throw new Error("calendar_create 需要 title、startAt 和 endAt。");
    }
    validateEventDates(details.startDate, details.endDate);
  }
  return details;
}

function reminderDetails(input: AgentDeviceCapabilityInput, creating: boolean) {
  const details: ReminderDetails = {
    ...(input.title === undefined
      ? {}
      : { title: boundedText(input.title, 240, "提醒标题无效。", true) }),
    ...(input.startAt === undefined
      ? {}
      : { startDate: requiredDate(input.startAt, "startAt") }),
    ...(input.dueAt === undefined
      ? {}
      : { dueDate: requiredDate(input.dueAt, "dueAt") }),
    ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
    ...(input.completed === undefined
      ? {}
      : {
          completed: input.completed,
          completionDate: input.completed ? new Date() : null,
        }),
    ...(input.location === undefined
      ? {}
      : { location: boundedText(input.location, 500, "提醒地点过长。") }),
    ...(input.notes === undefined
      ? {}
      : { notes: boundedText(input.notes, 8_000, "提醒备注过长。") }),
    ...(input.timeZone === undefined
      ? {}
      : { timeZone: boundedText(input.timeZone, 120, "提醒时区无效。", true) }),
    ...(input.url === undefined
      ? {}
      : { url: boundedText(input.url, 2_048, "提醒 URL 过长。") }),
  };
  if (creating && !details.title) {
    throw new Error("reminder_create 需要 title。");
  }
  return details;
}

function mergeEventSnapshot(before: EventSnapshot, details: EventDetails) {
  return Object.freeze({
    ...before,
    ...(details.title === undefined ? {} : { title: details.title }),
    ...(details.startDate === undefined
      ? {}
      : { startAt: details.startDate.toISOString() }),
    ...(details.endDate === undefined
      ? {}
      : { endAt: details.endDate.toISOString() }),
    ...(details.allDay === undefined ? {} : { allDay: details.allDay }),
    ...(details.location === undefined ? {} : { location: details.location }),
    ...(details.notes === undefined ? {} : { notes: details.notes }),
    ...(details.timeZone === undefined ? {} : { timeZone: details.timeZone }),
    ...(details.url === undefined ? {} : { url: details.url }),
  });
}

function mergeReminderSnapshot(
  before: ReminderSnapshot,
  details: ReminderDetails,
) {
  return Object.freeze({
    ...before,
    ...(details.title === undefined ? {} : { title: details.title }),
    ...(details.startDate === undefined
      ? {}
      : { startAt: details.startDate.toISOString() }),
    ...(details.dueDate === undefined
      ? {}
      : { dueAt: details.dueDate.toISOString() }),
    ...(details.allDay === undefined ? {} : { allDay: details.allDay }),
    ...(details.completed === undefined
      ? {}
      : { completed: details.completed }),
    ...(details.completionDate === undefined
      ? {}
      : {
          completionAt: details.completionDate?.toISOString() ?? "",
        }),
    ...(details.location === undefined ? {} : { location: details.location }),
    ...(details.notes === undefined ? {} : { notes: details.notes }),
    ...(details.timeZone === undefined ? {} : { timeZone: details.timeZone }),
    ...(details.url === undefined ? {} : { url: details.url }),
  });
}

function eventDetailsFromSnapshot(snapshot: EventSnapshot): EventDetails {
  return {
    title: snapshot.title,
    startDate: new Date(snapshot.startAt),
    endDate: new Date(snapshot.endAt),
    allDay: snapshot.allDay,
    location: snapshot.location,
    notes: snapshot.notes,
    timeZone: snapshot.timeZone,
    url: snapshot.url,
  };
}

function reminderDetailsFromSnapshot(
  snapshot: ReminderSnapshot,
): ReminderDetails {
  return {
    title: snapshot.title,
    ...(snapshot.startAt ? { startDate: new Date(snapshot.startAt) } : {}),
    ...(snapshot.dueAt ? { dueDate: new Date(snapshot.dueAt) } : {}),
    allDay: snapshot.allDay,
    completed: snapshot.completed,
    completionDate: snapshot.completionAt
      ? new Date(snapshot.completionAt)
      : null,
    location: snapshot.location,
    notes: snapshot.notes,
    timeZone: snapshot.timeZone,
    url: snapshot.url,
  };
}

function validateEventSnapshot(snapshot: EventSnapshot) {
  if (!snapshot.title) throw new Error("日程标题不能为空。");
  validateEventDates(new Date(snapshot.startAt), new Date(snapshot.endAt));
}

function validateEventDates(start: Date, end: Date) {
  if (end.getTime() <= start.getTime()) {
    throw new Error("日程结束时间必须晚于开始时间。");
  }
  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60_000) {
    throw new Error("单个日程跨度不能超过 366 天。");
  }
}

function dateRange(startValue?: string, endValue?: string, nullable = false) {
  const now = new Date();
  const start = startValue
    ? requiredDate(startValue, "startAt")
    : nullable
      ? null
      : new Date(now.getTime() - 24 * 60 * 60_000);
  const end = endValue
    ? requiredDate(endValue, "endAt")
    : nullable
      ? null
      : new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  if (start && end) {
    if (end <= start) throw new Error("查询结束时间必须晚于开始时间。");
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60_000) {
      throw new Error("单次日历查询跨度不能超过 366 天。");
    }
  }
  return {
    start,
    end,
    public: {
      startAt: start?.toISOString() ?? null,
      endAt: end?.toISOString() ?? null,
    },
  };
}

function dateValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("系统返回了无效日期。");
  return date;
}

function optionalDateValue(value?: Date | string) {
  return value === undefined ? undefined : dateValue(value);
}

function requiredDate(value: string, field: string) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw new Error(`${field} 必须是有效的 ISO 8601 时间。`);
  }
  return date;
}

function requiredText(value: string | undefined, field: string) {
  if (!value?.trim() || value !== value.trim())
    throw new Error(`${field} 无效。`);
  return value;
}

function boundedText(
  value: string,
  maxLength: number,
  message: string,
  required = false,
) {
  if (
    value.length > maxLength ||
    /[\u0000\u007f]/u.test(value) ||
    (required && !value.trim())
  ) {
    throw new Error(message);
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`数值必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return resolved;
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("日历或提醒事项操作已取消。");
  error.name = "AbortError";
  throw error;
}

function assertSameSnapshot(
  actual: unknown,
  expected: unknown,
  message: string,
) {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new Error(message);
}

function publicSnapshot<
  Value extends Readonly<Record<string, unknown>>,
  Key extends keyof Value,
>(value: Value, omitted: readonly Key[]) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.includes(key as Key)),
  );
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

let calendarModule: Promise<typeof import("expo-calendar")> | undefined;
let runtimeIdSequence = 0;

function calendarApi() {
  calendarModule ??= import("expo-calendar");
  return calendarModule;
}

function runtimeId() {
  runtimeIdSequence += 1;
  return `${Date.now().toString(36)}-${runtimeIdSequence.toString(36)}`;
}
