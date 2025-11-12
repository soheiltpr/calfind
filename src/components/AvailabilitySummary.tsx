import { buildTimeline, type TimelineSegment } from "@/lib/availability";
import type { AvailabilitySlot, ParticipantAvailability } from "@/types";
import { TimelineVisualizer } from "@/components/TimelineVisualizer";
import { buildParticipantColorMap } from "@/lib/colors";
import { toPersianDigits } from "@/lib/format";

type Props = {
  responses: ParticipantAvailability[];
  currentParticipantId?: string;
  onSegmentSelect?: (
    slot: AvailabilitySlot,
    info: { owned: boolean; participantIds: string[] }
  ) => void;
};

export const AvailabilitySummary = ({
  responses,
  currentParticipantId,
  onSegmentSelect,
}: Props) => {
  if (!responses.length) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white/60 p-6 text-sm text-slate-500 shadow-sm">
        هنوز شخصی زمان آزاد خود را ثبت نکرده است. منتظر پاسخ دوستان باشید.
      </div>
    );
  }

  const participantNameMap = responses.reduce<Record<string, string>>(
    (acc, item) => {
      acc[item.id] = item.name;
      return acc;
    },
    {}
  );
  const colorMap = buildParticipantColorMap(responses);
  const timeline = buildTimeline(responses);

  const handleTimelineSelect = (segment: TimelineSegment, date: string) => {
    if (!onSegmentSelect) return;

    const toTime = (minutes: number) => {
      const clamped = Math.max(0, Math.min(minutes, 24 * 60));
      const hours = Math.floor(clamped / 60)
        .toString()
        .padStart(2, "0");
      const mins = (clamped % 60).toString().padStart(2, "0");
      return `${hours}:${mins}`;
    };

    const slot: AvailabilitySlot = {
      date,
      startTime: toTime(segment.startMinutes),
      endTime: toTime(segment.endMinutes),
    };

    const owned = Boolean(
      currentParticipantId && segment.participantIds.includes(currentParticipantId)
    );

    onSegmentSelect(slot, { owned, participantIds: segment.participantIds });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-500 shadow-sm">
        <span>تعداد شرکت‌کنندگان: {toPersianDigits(responses.length)}</span>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
          {responses.map((response) => (
            <span
              key={response.id}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3 py-1 font-semibold"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorMap[response.id]?.primary ?? "#22c55e" }}
              />
              <span>{response.name}</span>
            </span>
          ))}
        </div>
      </div>
      <TimelineVisualizer
        timeline={timeline}
        nameMap={participantNameMap}
        colorMap={colorMap}
        maxParticipants={responses.length}
        emptyMessage="هنوز بازه‌ای برای نمایش وجود ندارد."
        onSelectSegment={handleTimelineSelect}
      />
    </div>
  );
};


