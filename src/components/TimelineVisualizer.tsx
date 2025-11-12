import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { formatJalaliDate, minutesToTimeLabel, toPersianDigits } from "@/lib/format";
import type { TimelineByDate, TimelineSegment } from "@/lib/availability";
import type { ParticipantColorMap } from "@/lib/colors";

const dayMinutes = 24 * 60;
const markerHours = Array.from({ length: 13 }, (_, index) => index * 2);

const getSegmentStyle = (segment: TimelineSegment) => {
  const width = Math.max(
    1.5,
    ((segment.endMinutes - segment.startMinutes) / dayMinutes) * 100
  );
  const left = (segment.startMinutes / dayMinutes) * 100;
  return {
    width: `${width}%`,
    left: `${left}%`,
  };
};

const toNameList = (participantIds: string[], nameMap: Record<string, string>) =>
  participantIds
    .map((id) => nameMap[id])
    .filter(Boolean)
    .join("، ");

type TimelineVisualizerProps = {
  timeline: TimelineByDate;
  nameMap: Record<string, string>;
  colorMap: ParticipantColorMap;
  maxParticipants?: number;
  emptyMessage?: string;
  onSelectSegment?: (segment: TimelineSegment, date: string) => void;
  onSegmentChange?: (
    segment: TimelineSegment,
    date: string,
    original: TimelineSegment,
    mode: EditMode
  ) => void;
  editableParticipantIds?: string[];
  editableBounds?: { minMinutes?: number; maxMinutes?: number };
  editableStep?: number;
  editableMinDuration?: number;
  showLegend?: boolean;
};

type EditMode = "move" | "resize-start" | "resize-end";

type DragState = {
  pointerId: number;
  date: string;
  segmentIndex: number;
  original: TimelineSegment;
  mode: EditMode;
  startX: number;
  containerWidth: number;
  previewStart?: number;
  previewEnd?: number;
  minMinutes: number;
  maxMinutes: number;
  minDuration: number;
  step: number;
  hasMoved: boolean;
};

export const TimelineVisualizer = ({
  timeline,
  nameMap,
  colorMap,
  maxParticipants,
  emptyMessage = "بازه زمانی انتخاب نشده است.",
  onSelectSegment,
  onSegmentChange,
  editableParticipantIds,
  editableBounds,
  editableStep = 15,
  editableMinDuration = 15,
  showLegend = true,
}: TimelineVisualizerProps) => {
  const entries = Object.entries(timeline).sort(([a], [b]) => a.localeCompare(b));
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [justDragged, setJustDragged] = useState(false);

  const resolvedMax =
    maxParticipants ??
    Math.max(
      1,
      ...entries.flatMap(([, segments]) =>
        segments.map((segment) => segment.participantIds.length)
      )
    );

  const legendItems = Array.from(
    new Set(entries.flatMap(([, segments]) => segments.flatMap((segment) => segment.participantIds)))
  );

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;
      event.preventDefault();

      const deltaPx = event.clientX - dragState.startX;
      const minutesPerPx = dayMinutes / dragState.containerWidth;
      const rawDeltaMinutes = deltaPx * minutesPerPx;
      const step = dragState.step || 15;
      const duration =
        dragState.original.endMinutes - dragState.original.startMinutes;

      const snap = (value: number) => Math.round(value / step) * step;

      let previewStart = dragState.original.startMinutes;
      let previewEnd = dragState.original.endMinutes;

      if (dragState.mode === "move") {
        let startCandidate = dragState.original.startMinutes + rawDeltaMinutes;
        const minStart = dragState.minMinutes;
        const maxStart = dragState.maxMinutes - duration;
        startCandidate = Math.max(minStart, Math.min(maxStart, startCandidate));
        startCandidate = snap(startCandidate);
        startCandidate = Math.max(minStart, Math.min(maxStart, startCandidate));
        previewStart = startCandidate;
        previewEnd = startCandidate + duration;
      } else if (dragState.mode === "resize-start") {
        let startCandidate = dragState.original.startMinutes + rawDeltaMinutes;
        const maxStart = dragState.original.endMinutes - dragState.minDuration;
        startCandidate = Math.max(
          dragState.minMinutes,
          Math.min(maxStart, startCandidate)
        );
        startCandidate = snap(startCandidate);
        startCandidate = Math.max(
          dragState.minMinutes,
          Math.min(maxStart, startCandidate)
        );
        previewStart = startCandidate;
        previewEnd = dragState.original.endMinutes;
      } else if (dragState.mode === "resize-end") {
        let endCandidate = dragState.original.endMinutes + rawDeltaMinutes;
        const minEnd = dragState.original.startMinutes + dragState.minDuration;
        endCandidate = Math.max(
          minEnd,
          Math.min(dragState.maxMinutes, endCandidate)
        );
        endCandidate = snap(endCandidate);
        endCandidate = Math.max(
          minEnd,
          Math.min(dragState.maxMinutes, endCandidate)
        );
        previewStart = dragState.original.startMinutes;
        previewEnd = endCandidate;
      }

      setDragState((prev) =>
        prev
          ? {
              ...prev,
              previewStart,
              previewEnd,
              hasMoved: true,
            }
          : prev
      );
    };

    const handleUp = (event: PointerEvent) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      const previewStart =
        dragState.previewStart ?? dragState.original.startMinutes;
      const previewEnd =
        dragState.previewEnd ?? dragState.original.endMinutes;

      if (dragState.hasMoved && onSegmentChange) {
        onSegmentChange(
          {
            ...dragState.original,
            startMinutes: previewStart,
            endMinutes: previewEnd,
          },
          dragState.date,
          dragState.original,
          dragState.mode
        );
        setJustDragged(true);
      }

      setDragState(null);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragState, onSegmentChange]);

  if (!entries.length) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white/60 p-6 text-sm text-slate-500 shadow-sm">
        {emptyMessage}
      </div>
    );
  }

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    date: string,
    segmentIndex: number,
    segment: TimelineSegment,
    mode: EditMode
  ) => {
    if (!onSegmentChange) return;
    const canEdit =
      !editableParticipantIds ||
      segment.participantIds.some((id) => editableParticipantIds.includes(id));

    if (!canEdit) {
      return;
    }

    const container = (
      event.currentTarget as HTMLElement
    ).closest("[data-timeline-container]") as HTMLElement | null;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const minMinutes = editableBounds?.minMinutes ?? 0;
    const maxMinutes = editableBounds?.maxMinutes ?? dayMinutes;

    setDragState({
      pointerId: event.pointerId,
      date,
      segmentIndex,
      original: { ...segment },
      mode,
      startX: event.clientX,
      containerWidth: rect.width || 1,
      previewStart: segment.startMinutes,
      previewEnd: segment.endMinutes,
      minMinutes,
      maxMinutes,
      minDuration: editableMinDuration,
      step: editableStep,
      hasMoved: false,
    });

    setJustDragged(false);
    event.preventDefault();
  };

  return (
    <div className="space-y-6">
      {entries.map(([date, segments]) => (
        <div key={date} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-700">
              {formatJalaliDate(date)}
            </h3>
            <div className="relative min-w-0 flex-1">
              <div className="relative h-5">
                {markerHours.map((hour) => (
                  <span
                    key={`label-${date}-${hour}`}
                    className="absolute top-0 -translate-x-1/2 text-[11px] text-slate-400"
                    style={{ left: `${(hour / 24) * 100}%` }}
                  >
                    {toPersianDigits(hour)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div
            data-timeline-container
            className="relative h-20 rounded-3xl border border-slate-200/70 bg-white/70 shadow-inner"
          >
            {markerHours.map((hour) => (
              <div
                key={`marker-${date}-${hour}`}
                className="absolute top-0 h-full border-slate-200/50"
                style={{
                  left: `${(hour / 24) * 100}%`,
                  borderLeftWidth: hour === 0 || hour === 24 ? 0 : 1,
                }}
              />
            ))}
            {segments.map((segment, index) => {
              const isDraggingThis =
                dragState &&
                dragState.date === date &&
                dragState.segmentIndex === index;
              const effectiveStart = isDraggingThis
                ? dragState.previewStart ?? segment.startMinutes
                : segment.startMinutes;
              const effectiveEnd = isDraggingThis
                ? dragState.previewEnd ?? segment.endMinutes
                : segment.endMinutes;
              const participantCount = segment.participantIds.length;
              const style = getSegmentStyle({
                ...segment,
                startMinutes: effectiveStart,
                endMinutes: effectiveEnd,
              });
              const names = toNameList(segment.participantIds, nameMap);
              const participants = segment.participantIds.map((id) => colorMap[id]);

              const background = participants.length
                ? participants.length === 1
                  ? participants[0]?.highlight ?? "#22c55e"
                  : `linear-gradient(135deg, ${participants
                      .map(({ primary }, colorIndex) => {
                        const start = Math.round((colorIndex / participants.length) * 100);
                        const end = Math.round(((colorIndex + 1) / participants.length) * 100);
                        return `${primary} ${start}% ${end}%`;
                      })
                      .join(", ")})`
                : "#cbd5f5";

              const borderColor =
                participants.length > 1
                  ? "rgba(249, 115, 22, 0.8)"
                  : participants[0]?.primary ?? "#22c55e";
              const ratio = Math.min(1, participantCount / (resolvedMax || 1));
              const opacity = 0.45 + ratio * 0.5;

              const canEdit =
                !!onSegmentChange &&
                (!editableParticipantIds ||
                  segment.participantIds.some((id) => editableParticipantIds.includes(id)));

              const handleClick = () => {
                if (justDragged) {
                  setJustDragged(false);
                  return;
                }
                if (onSelectSegment) {
                  onSelectSegment(segment, date);
                }
              };

              return (
                <button
                  type="button"
                  key={`${date}-${index}-${segment.startMinutes}`}
                  className={`group absolute top-2 flex h-16 items-center justify-center rounded-2xl px-2 text-[11px] font-semibold text-slate-700 shadow-md transition duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white ${
                    participantCount > 1
                      ? "ring-2 ring-amber-400/70 animate-[pulse_1600ms_ease-in-out_infinite]"
                      : "hover:ring-2 hover:ring-slate-300"
                  } ${
                    canEdit ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                  style={{
                    ...style,
                    background,
                    border: `1px solid ${borderColor}`,
                    color: participantCount > 1 ? "#1f2937" : "#0f172a",
                    opacity,
                    touchAction: canEdit ? "none" : undefined,
                  }}
                  title={
                    names
                      ? `${minutesToTimeLabel(effectiveStart)} تا ${minutesToTimeLabel(effectiveEnd)}\n${names}`
                      : `${minutesToTimeLabel(effectiveStart)} تا ${minutesToTimeLabel(effectiveEnd)}`
                  }
                  onClick={handleClick}
                  onPointerDown={(event) =>
                    canEdit &&
                    handlePointerDown(
                      event,
                      date,
                      index,
                      { ...segment },
                      "move"
                    )
                  }
                >
                  <span className="flex w-full flex-col items-center gap-1" dir="rtl">
                    <span>
                      {minutesToTimeLabel(effectiveStart)} تا {minutesToTimeLabel(effectiveEnd)}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-600">
                      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-white/70" />
                      {toPersianDigits(participantCount)} نفر
                    </span>
                  </span>
                  {canEdit ? (
                    <>
                      <span
                        className="absolute left-0 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          handlePointerDown(
                            event,
                            date,
                            index,
                            { ...segment },
                            "resize-start"
                          );
                        }}
                      >
                        <span className="h-6 w-1 rounded-full bg-white/80 shadow" />
                      </span>
                      <span
                        className="absolute right-0 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          handlePointerDown(
                            event,
                            date,
                            index,
                            { ...segment },
                            "resize-end"
                          );
                        }}
                      >
                        <span className="h-6 w-1 rounded-full bg-white/80 shadow" />
                      </span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {showLegend && legendItems.length ? (
        <div className="flex flex-wrap gap-3 rounded-3xl bg-white/70 p-4 text-[11px] text-slate-600 shadow-inner">
          {legendItems.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorMap[id]?.primary ?? "#10b981" }}
              />
              <span>{nameMap[id] ?? "-"}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
