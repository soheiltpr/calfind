"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { DateObject as PickerDateObject } from "react-multi-date-picker";
import DateObject from "react-date-object";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import dayjs from "dayjs";
import { TimelineVisualizer } from "@/components/TimelineVisualizer";
import { TimeRangeSelector } from "@/components/TimeRangeSelector";
import { buildTimeline } from "@/lib/availability";
import { buildColorMapFromIds } from "@/lib/colors";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { logClientActivity } from "@/lib/logging";
import { formatJalaliDate, formatSlotLabel, toPersianDigits } from "@/lib/format";
import type { AvailabilitySlot, ParticipantAvailability } from "@/types";

const DatePicker = dynamic(() => import("react-multi-date-picker"), {
  ssr: false,
});

type Props = {
  projectId: string;
  participant: { id: string; inviteeId: string; name: string };
  allowedDates: { start?: string | null; end?: string | null };
  allowedTimes: { startMinutes: number; endMinutes: number };
  onSaved?: () => void;
  initialSlots?: AvailabilitySlot[];
};

export type AvailabilityFormHandle = {
  prefillSlot: (slot: AvailabilitySlot, options?: { message?: string }) => void;
  addSlot: (slot: AvailabilitySlot, options?: { message?: string }) => void;
};

export const AvailabilityForm = forwardRef<AvailabilityFormHandle, Props>(
  ({ projectId, participant, allowedDates, allowedTimes, onSaved, initialSlots }, ref) => {
    const supabase = useMemo(() => getSupabaseClient(), []);

    const [selectedDates, setSelectedDates] = useState<PickerDateObject[]>([]);
    const initialEnd = Math.min(
      allowedTimes.endMinutes,
      allowedTimes.startMinutes + 60
    );
    const [startTime, setStartTime] = useState(
      minutesToTime(allowedTimes.startMinutes)
    );
    const [endTime, setEndTime] = useState(
      minutesToTime(Math.max(allowedTimes.startMinutes + 15, initialEnd))
    );
    const [slots, setSlots] = useState<AvailabilitySlot[]>(() =>
      (initialSlots ?? []).map((slot) => ({ ...slot }))
    );
    const [dateTimeDrafts, setDateTimeDrafts] = useState<
      Record<string, { startTime: string; endTime: string }>
    >({});
    const [activeDateIso, setActiveDateIso] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const isoFromPicker = (dateObject: PickerDateObject) =>
      dayjs(dateObject.toDate()).format("YYYY-MM-DD");

    const pickerFromIso = (iso: string) =>
      new DateObject({ date: iso, format: "YYYY-MM-DD" }).convert(
        persian,
        persian_fa
      );

    const ensureDraftForDate = (
      iso: string,
      draftMap: Record<string, { startTime: string; endTime: string }>
    ) => {
      if (draftMap[iso]) {
        return draftMap;
      }
      const existingSlot = slots.find((slot) => slot.date === iso);
      const fallback = existingSlot
        ? {
            startTime: existingSlot.startTime,
            endTime: existingSlot.endTime,
          }
        : {
            startTime,
            endTime,
          };
      return { ...draftMap, [iso]: fallback };
    };

    const minDate = allowedDates.start
      ? new DateObject({ date: allowedDates.start, format: "YYYY-MM-DD" }).convert(
          persian,
          persian_fa
        )
      : undefined;
    const maxDate = allowedDates.end
      ? new DateObject({ date: allowedDates.end, format: "YYYY-MM-DD" }).convert(
          persian,
          persian_fa
        )
      : undefined;

    const allowedStartIso = allowedDates.start ?? null;
    const allowedEndIso = allowedDates.end ?? null;

    useEffect(() => {
      if (!activeDateIso) return;
      const draft = dateTimeDrafts[activeDateIso];
      if (draft) {
        setStartTime(draft.startTime);
        setEndTime(draft.endTime);
      }
    }, [activeDateIso, dateTimeDrafts]);

    useEffect(() => {
      if (status === "saved") {
        const timeout = setTimeout(() => setStatus("idle"), 3000);
        return () => clearTimeout(timeout);
      }
    }, [status]);

    useEffect(() => {
      if (info) {
        const timeout = setTimeout(() => setInfo(null), 3000);
        return () => clearTimeout(timeout);
      }
    }, [info]);

    useImperativeHandle(ref, () => ({
      prefillSlot: (slot, options) => {
        setError(null);
        const iso = slot.date;
        setDateTimeDrafts((prev) => ({
          ...prev,
          [iso]: { startTime: slot.startTime, endTime: slot.endTime },
        }));
        setSelectedDates((prev) => {
          const exists = prev.some((dateObject) => isoFromPicker(dateObject) === iso);
          if (exists) return prev;
          const next = [...prev, pickerFromIso(iso)];
          return next.sort((a, b) =>
            isoFromPicker(a).localeCompare(isoFromPicker(b))
          );
        });
        setActiveDateIso(iso);
        setStartTime(slot.startTime);
        setEndTime(slot.endTime);
        setInfo(
          options?.message ??
            "بازه برای استفاده انتخاب شد. تاریخ موردنظر را انتخاب و دکمه افزودن را بزنید."
        );
      },
      addSlot: (slot, options) => {
        appendSlots([slot], options?.message);
      },
    }));

    const normalizedInitialSlots = useMemo(
      () => (initialSlots ?? []).map((slot) => ({ ...slot })),
      [initialSlots]
    );

    useEffect(() => {
      if (initialSlots === undefined) return;
      setSlots((prev) => {
        if (prev.length === normalizedInitialSlots.length &&
          prev.every((slot, index) => {
            const next = normalizedInitialSlots[index];
            return (
              slot.date === next.date &&
              slot.startTime === next.startTime &&
              slot.endTime === next.endTime
            );
          })
        ) {
          return prev;
        }
        return normalizedInitialSlots;
      });
    }, [initialSlots, normalizedInitialSlots]);

    const appendSlots = (candidates: AvailabilitySlot[], message?: string) => {
      let added = false;
      setSlots((prev) => {
        const merged = [...prev];
        candidates.forEach((slot) => {
          if (!isSlotWithinRange(slot, allowedDates, allowedTimes)) {
            return;
          }
          const exists = merged.some(
            (existing) =>
              existing.date === slot.date &&
              existing.startTime === slot.startTime &&
              existing.endTime === slot.endTime
          );
          if (!exists) {
            merged.push(slot);
            added = true;
          }
        });
        return added ? merged.sort(sortSlots) : prev;
      });

      if (added) {
        setDateTimeDrafts((prev) => {
          const next = { ...prev };
          candidates.forEach((slot) => {
            next[slot.date] = {
              startTime: slot.startTime,
              endTime: slot.endTime,
            };
          });
          return next;
        });
        setError(null);
        setInfo(
          message ??
            (candidates.length > 1
              ? "بازه‌های جدید ثبت شدند."
              : "بازه جدید ثبت شد.")
        );
      } else {
        setError("این بازه از پیش ثبت شده یا خارج از محدوده مجاز است.");
      }
    };

    const handleDateChange = (value: PickerDateObject | PickerDateObject[] | null) => {
      if (!value || (Array.isArray(value) && value.length === 0)) {
        setSelectedDates([]);
        setDateTimeDrafts({});
        setActiveDateIso(null);
        return;
      }

      const pickerArray = Array.isArray(value) ? [...value] : [value];
      const sortedPickers = pickerArray.sort((a, b) =>
        isoFromPicker(a).localeCompare(isoFromPicker(b))
      );
      const isoDates = sortedPickers.map((item) => isoFromPicker(item));

      const nextDrafts: Record<string, { startTime: string; endTime: string }> = {};
      isoDates.forEach((iso) => {
        const existingDraft = dateTimeDrafts[iso];
        if (existingDraft) {
          nextDrafts[iso] = existingDraft;
        } else {
          const existingSlot = slots.find((slot) => slot.date === iso);
          nextDrafts[iso] = existingSlot
            ? { startTime: existingSlot.startTime, endTime: existingSlot.endTime }
            : { startTime, endTime };
        }
      });

      setSelectedDates(sortedPickers);
      setDateTimeDrafts(nextDrafts);

      const nextActive =
        activeDateIso && isoDates.includes(activeDateIso)
          ? activeDateIso
          : isoDates[isoDates.length - 1];
      setActiveDateIso(nextActive ?? null);
      if (nextActive) {
        const draft = nextDrafts[nextActive];
        setStartTime(draft.startTime);
        setEndTime(draft.endTime);
      }
    };

    const handleAddSlot = () => {
      setError(null);
      setInfo(null);
      if (!selectedDates.length) {
        setError("ابتدا حداقل یک تاریخ را انتخاب کنید.");
        return;
      }

      const isoDates = selectedDates.map((item) => isoFromPicker(item));
      const newSlots: AvailabilitySlot[] = [];

      for (const iso of isoDates) {
        const draft = dateTimeDrafts[iso];
        if (!draft) {
          continue;
        }
        if (draft.startTime >= draft.endTime) {
          setError(`ساعت پایان باید بعد از ساعت شروع باشد (${formatJalaliDate(iso)})`);
          return;
        }
        const startMinutes = timeToMinutes(draft.startTime);
        const endMinutes = timeToMinutes(draft.endTime);
        if (startMinutes < allowedTimes.startMinutes || endMinutes > allowedTimes.endMinutes) {
          setError(`لطفاً ساعاتی در بازه مجاز انتخاب کنید (${formatJalaliDate(iso)})`);
          return;
        }
        newSlots.push({
          date: iso,
          startTime: draft.startTime,
          endTime: draft.endTime,
        });
      }

      if (!newSlots.length) {
        setError("ابتدا بازه زمانی معتبری انتخاب کنید.");
        return;
      }

      appendSlots(
        newSlots,
        newSlots.length > 1
          ? "بازه‌های جدید ثبت شدند."
          : "بازه جدید ثبت شد."
      );
    };

    const handleRemoveSlot = (index: number) => {
      setSlots((prev) => prev.filter((_, idx) => idx !== index));
    };

    const handleClearSelection = () => {
      setSelectedDates([]);
      setDateTimeDrafts({});
      setActiveDateIso(null);
      setStartTime(minutesToTime(allowedTimes.startMinutes));
      setEndTime(minutesToTime(Math.max(allowedTimes.startMinutes + 15, initialEnd)));
    };

    const handleSlotQuickFill = (slot: AvailabilitySlot) => {
      setError(null);
      const iso = slot.date;
      setSelectedDates((prev) => {
        const exists = prev.some((dateObject) => isoFromPicker(dateObject) === iso);
        if (exists) {
          return prev;
        }
        const next = [...prev, pickerFromIso(iso)];
        return next.sort((a, b) =>
          isoFromPicker(a).localeCompare(isoFromPicker(b))
        );
      });
      setDateTimeDrafts((prev) => ({
        ...prev,
        [iso]: { startTime: slot.startTime, endTime: slot.endTime },
      }));
      setActiveDateIso(iso);
      setStartTime(slot.startTime);
      setEndTime(slot.endTime);
      setInfo("این بازه برای ویرایش مجدد انتخاب شد.");
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setInfo(null);

      if (!slots.length) {
        setError("حداقل یک بازه زمانی اضافه کنید.");
        return;
      }

      setStatus("saving");

      try {
        const { error: upsertError } = await supabase
          .from("availability_responses")
          .upsert(
            {
              project_id: projectId,
              invitee_id: participant.inviteeId,
              name: participant.name,
              slots,
            },
            { onConflict: "invitee_id" }
          );

        if (upsertError) {
          throw upsertError;
        }

        await logClientActivity(supabase, {
          projectId,
          inviteeId: participant.inviteeId,
          actorName: participant.name,
          action: "availability_saved",
          details: {
            summary: "بازه‌های زمانی به‌روزرسانی شد",
            data: { slotCount: slots.length },
          },
        });

        setStatus("saved");
        onSaved?.();
      } catch (submitError) {
        console.error(submitError);
        setError("خطا در ذخیره‌سازی. لطفاً دوباره تلاش کنید.");
        setStatus("idle");
        return;
      }
    };

    const previewResponses: ParticipantAvailability[] = useMemo(() => {
      if (!slots.length) return [];
      return [
        {
          id: participant.id,
          projectId,
          inviteeId: participant.inviteeId,
          name: participant.name,
          slots,
          createdAt: new Date().toISOString(),
        },
      ];
    }, [slots, participant, projectId]);

    const previewTimeline = useMemo(() => buildTimeline(previewResponses), [
      previewResponses,
    ]);

    const previewNameMap = useMemo(
      () => ({ [participant.id]: participant.name }),
      [participant]
    );
    const previewColorMap = useMemo(
      () => buildColorMapFromIds([participant.id]),
      [participant.id]
    );

    const startMinutes = useMemo(() => timeToMinutes(startTime), [startTime]);
    const endMinutes = useMemo(() => timeToMinutes(endTime), [endTime]);

    const handleTimeRangeChange = ([start, end]: [number, number]) => {
      const startLabel = minutesToTime(start);
      const endLabel = minutesToTime(end);
      setStartTime(startLabel);
      setEndTime(endLabel);
      if (activeDateIso) {
        setDateTimeDrafts((prev) => ({
          ...prev,
          [activeDateIso]: { startTime: startLabel, endTime: endLabel },
        }));
      }
    };

    return (
      <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur sm:p-8">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">
                  انتخاب تاریخ‌ها
                </label>
                <DatePicker
                  multiple
                  value={selectedDates}
                  onChange={handleDateChange}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-right"
                  className="w-full rounded-2xl border border-slate-200 bg-white text-sm shadow-inner"
                  inputClass="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none"
                  minDate={minDate}
                  maxDate={maxDate}
                  mapDays={({ date }) => {
                    const iso = dayjs(date.toDate()).format("YYYY-MM-DD");
                    const disabled =
                      (allowedStartIso && iso < allowedStartIso) ||
                      (allowedEndIso && iso > allowedEndIso);
                    return disabled
                      ? {
                          disabled: true,
                          className: "pointer-events-none opacity-30",
                        }
                      : {};
                  }}
                  placeholder="تاریخ‌های مجاز را انتخاب کنید"
                />
                {selectedDates.length ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                    {selectedDates.map((dateObject) => {
                      const isoDate = isoFromPicker(dateObject);
                      const isActive = isoDate === activeDateIso;
                      return (
                        <button
                          key={isoDate}
                          type="button"
                          onClick={() => {
                            setDateTimeDrafts((prev) => {
                              const next = ensureDraftForDate(isoDate, prev);
                              const draft = next[isoDate];
                              setStartTime(draft.startTime);
                              setEndTime(draft.endTime);
                              return next;
                            });
                            setActiveDateIso(isoDate);
                          }}
                          className={`rounded-full px-3 py-1 font-semibold shadow-sm transition ${
                            isActive
                              ? "bg-sky-600 text-white hover:bg-sky-700"
                              : "bg-sky-50 text-sky-600 hover:bg-sky-100"
                          }`}
                        >
                          {formatJalaliDate(isoDate)}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="rounded-full bg-transparent px-2 py-1 font-semibold text-rose-500 transition hover:bg-rose-50"
                    >
                      پاک‌سازی
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    تنها تاریخ‌های تعریف‌شده توسط برگزارکننده مجاز هستند.
                  </p>
                )}

              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">
                  بازه زمانی (گرافیکی)
                </label>
                {activeDateIso ? (
                  <p className="text-xs text-slate-500">
                    تنظیم بازه برای تاریخ {formatJalaliDate(activeDateIso)}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    برای تنظیم بازه، ابتدا تاریخ را انتخاب کنید.
                  </p>
                )}
                <TimeRangeSelector
                  value={[startMinutes, endMinutes]}
                  onChange={handleTimeRangeChange}
                  minMinutes={allowedTimes.startMinutes}
                  maxMinutes={allowedTimes.endMinutes}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddSlot}
              className="w-full rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-100"
            >
              افزودن بازه زمانی برای تاریخ‌های انتخابی
            </button>
          </div>

          {slots.length ? (
            <div className="space-y-4 rounded-2xl bg-slate-50/80 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-600">بازه‌های انتخابی شما</p>
                <span className="text-xs text-slate-500">
                  {toPersianDigits(slots.length)} بازه ثبت شده
                </span>
              </div>
              <TimelineVisualizer
                timeline={previewTimeline}
                nameMap={previewNameMap}
                colorMap={previewColorMap}
                maxParticipants={1}
                emptyMessage=""
                showLegend={false}
                editableParticipantIds={[participant.id]}
                editableBounds={{
                  minMinutes: allowedTimes.startMinutes,
                  maxMinutes: allowedTimes.endMinutes,
                }}
                editableStep={15}
                editableMinDuration={15}
                onSelectSegment={(segment, date) =>
                  handleSlotQuickFill({
                    date,
                    startTime: minutesToTime(segment.startMinutes),
                    endTime: minutesToTime(segment.endMinutes),
                  })
                }
                onSegmentChange={(segment, date, original, mode) => {
                  const newStart = minutesToTime(segment.startMinutes);
                  const newEnd = minutesToTime(segment.endMinutes);
                  const originalStart = minutesToTime(original.startMinutes);
                  const originalEnd = minutesToTime(original.endMinutes);
                  setSlots((prev) =>
                    prev
                      .map((slot) => {
                        if (
                          slot.date === date &&
                          slot.startTime === originalStart &&
                          slot.endTime === originalEnd
                        ) {
                          return {
                            ...slot,
                            startTime: newStart,
                            endTime: newEnd,
                          };
                        }
                        return slot;
                      })
                      .sort(sortSlots)
                  );
                  setStartTime(newStart);
                  setEndTime(newEnd);
                  setDateTimeDrafts((prev) => ({
                    ...prev,
                    [date]: { startTime: newStart, endTime: newEnd },
                  }));
                  setActiveDateIso(date);
                  const message =
                    mode === "move"
                      ? "بازه جابه‌جا شد."
                      : mode === "resize-start"
                      ? "ساعت شروع بازه تنظیم شد."
                      : "ساعت پایان بازه تنظیم شد.";
                  setInfo(message);
                }}
              />
              <ul className="space-y-2 text-sm">
                {slots.map((slot, index) => (
                  <li
                    key={`${slot.date}-${slot.startTime}-${slot.endTime}`}
                    className="flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm transition hover:bg-sky-50"
                    onClick={() => handleSlotQuickFill(slot)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSlotQuickFill(slot);
                      }
                    }}
                  >
                    <span className="text-slate-600">
                      {toPersianDigits(index + 1)}. {formatSlotLabel(slot.date, slot.startTime, slot.endTime)}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveSlot(index);
                      }}
                      className="text-xs font-semibold text-rose-500 transition hover:text-rose-600"
                    >
                      حذف
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          ) : null}

          {info ? (
            <div className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-600">
              {info}
            </div>
          ) : null}

          {status === "saved" ? (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              زمان‌های شما ثبت شد و برای سایر اعضا نمایش داده می‌شود.
            </div>
          ) : null}

          <button
            type="submit"
            disabled={status === "saving"}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {status === "saving" ? "در حال ثبت..." : "ثبت زمان‌های من"}
          </button>
        </form>
      </div>
    );
  }
);

AvailabilityForm.displayName = "AvailabilityForm";

const sortSlots = (a: AvailabilitySlot, b: AvailabilitySlot) => {
  if (a.date === b.date) {
    if (a.startTime === b.startTime) {
      return a.endTime.localeCompare(b.endTime);
    }
    return a.startTime.localeCompare(b.startTime);
  }

  return a.date.localeCompare(b.date);
};

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes: number) => {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60));
  const hours = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const mins = (clamped % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
};

const isSlotWithinRange = (
  slot: AvailabilitySlot,
  dates: { start?: string | null; end?: string | null },
  times: { startMinutes: number; endMinutes: number }
) => {
  if (dates.start && slot.date < dates.start) return false;
  if (dates.end && slot.date > dates.end) return false;
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);
  if (start < times.startMinutes) return false;
  if (end > times.endMinutes) return false;
  return true;
};

