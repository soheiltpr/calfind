import * as Slider from "@radix-ui/react-slider";
import { minutesToTimeLabel, toPersianDigits } from "@/lib/format";
import { useMemo, useState } from "react";

type Props = {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  step?: number;
  minMinutes?: number;
  maxMinutes?: number;
};

const clampRange = (
  value: [number, number],
  bounds: { min: number; max: number }
) => {
  const [start, end] = value;
  const safeStart = Math.max(bounds.min, Math.min(start, bounds.max));
  const safeEnd = Math.max(bounds.min, Math.min(end, bounds.max));
  return [
    Math.min(safeStart, safeEnd - 15),
    Math.max(Math.max(bounds.min, safeStart + 15), safeEnd),
  ] as [number, number];
};

export const TimeRangeSelector = ({
  value,
  onChange,
  step = 15,
  minMinutes = 0,
  maxMinutes = 24 * 60,
}: Props) => {
  const bounds = useMemo(
    () => ({ min: minMinutes, max: maxMinutes }),
    [minMinutes, maxMinutes]
  );
  const clamped = clampRange(value, bounds);
  const displayStart = minutesToTimeLabel(clamped[0]);
  const displayEnd = minutesToTimeLabel(clamped[1]);
  const [hover, setHover] = useState<{ left: number; minutes: number } | null>(null);

  const tooltipLabel = useMemo(
    () => (hover ? minutesToTimeLabel(hover.minutes) : null),
    [hover]
  );

  const toMinutes = (ratio: number) => {
    const raw = bounds.min + ratio * (bounds.max - bounds.min);
    return Math.round(raw / step) * step;
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-inner">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
        <span>ساعت پایان: {displayEnd}</span>
        <span>ساعت شروع: {displayStart}</span>
      </div>
      <Slider.Root
        min={bounds.min}
        max={bounds.max}
        step={step}
        value={clamped}
        onValueChange={(next) => {
          const safe = clampRange(next as [number, number], bounds);
          onChange([safe[0], safe[1]]);
        }}
        className="relative flex h-6 w-full touch-none select-none items-center"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(
            Math.max((event.clientX - rect.left) / rect.width, 0),
            1
          );
          const minutes = toMinutes(ratio);
          setHover({ left: ratio * 100, minutes });
        }}
        onPointerLeave={() => setHover(null)}
      >
        {hover && tooltipLabel ? (
          <div
            className="pointer-events-none absolute -top-8 flex -translate-x-1/2 items-center justify-center"
            style={{ left: `${hover.left}%` }}
          >
            <span className="rounded-full bg-slate-800 px-3 py-1 text-[10px] font-semibold text-white shadow-lg">
              {tooltipLabel}
            </span>
          </div>
        ) : null}
        <Slider.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-slate-200">
          <Slider.Range className="absolute h-full bg-gradient-to-l from-emerald-400 via-emerald-500 to-sky-500" />
        </Slider.Track>
        {clamped.map((_, index) => (
          <Slider.Thumb
            key={index}
            className="block h-5 w-5 rounded-full border-2 border-white bg-sky-500 shadow-lg transition hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-500"
            aria-label={index === 0 ? "زمان شروع" : "زمان پایان"}
          />
        ))}
      </Slider.Root>
      <div className="relative h-5 w-full">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span
            key={hour}
            className="absolute -translate-x-1/2 text-[11px] text-slate-400"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {toPersianDigits(hour)}
          </span>
        ))}
      </div>
    </div>
  );
};


