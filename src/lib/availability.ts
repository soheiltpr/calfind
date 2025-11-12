import type { AvailabilitySlot, ParticipantAvailability } from "@/types";

export type AggregatedSlot = AvailabilitySlot & {
  participantIds: string[];
};

export type TimelineSegment = {
  startMinutes: number;
  endMinutes: number;
  participantIds: string[];
};

export type TimelineByDate = Record<string, TimelineSegment[]>;

const minutesInDay = 24 * 60;

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export const aggregateSlots = (
  responses: ParticipantAvailability[]
): AggregatedSlot[] => {
  const slotMap = new Map<string, AggregatedSlot>();

  responses.forEach((response) => {
    response.slots.forEach((slot) => {
      const key = `${slot.date}_${slot.startTime}_${slot.endTime}`;
      const existing = slotMap.get(key);

      if (existing) {
        slotMap.set(key, {
          ...existing,
          participantIds: [...existing.participantIds, response.id],
        });
      } else {
        slotMap.set(key, {
          ...slot,
          participantIds: [response.id],
        });
      }
    });
  });

  return Array.from(slotMap.values()).sort((a, b) => {
    if (a.date === b.date) {
      return a.startTime.localeCompare(b.startTime);
    }

    return a.date.localeCompare(b.date);
  });
};

export const buildTimeline = (
  responses: ParticipantAvailability[]
): TimelineByDate => {
  const eventsByDate = new Map<
    string,
    Array<{ minutes: number; type: "start" | "end"; participantId: string }>
  >();

  responses.forEach((response) => {
    response.slots.forEach((slot) => {
      const start = toMinutes(slot.startTime);
      const end = toMinutes(slot.endTime);

      if (end <= start || start >= minutesInDay) {
        return;
      }

      const safeEnd = Math.min(end, minutesInDay);
      const events = eventsByDate.get(slot.date) ?? [];

      events.push({
        minutes: Math.max(0, start),
        type: "start",
        participantId: response.id,
      });
      events.push({ minutes: safeEnd, type: "end", participantId: response.id });

      eventsByDate.set(slot.date, events);
    });
  });

  const timeline: TimelineByDate = {};

  eventsByDate.forEach((events, date) => {
    const sorted = events.sort((a, b) => {
      if (a.minutes === b.minutes) {
        if (a.type === b.type) return 0;
        return a.type === "end" ? -1 : 1;
      }
      return a.minutes - b.minutes;
    });

    const active = new Set<string>();
    const segments: TimelineSegment[] = [];

    let prevMinute = sorted[0]?.minutes ?? 0;

    sorted.forEach((event) => {
      if (active.size > 0 && event.minutes > prevMinute) {
        segments.push({
          startMinutes: prevMinute,
          endMinutes: event.minutes,
          participantIds: Array.from(active),
        });
      }

      if (event.type === "start") {
        active.add(event.participantId);
      } else {
        active.delete(event.participantId);
      }

      prevMinute = event.minutes;
    });

    timeline[date] = segments;
  });

  return timeline;
};
