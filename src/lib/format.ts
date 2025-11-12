import dayjs from "dayjs";
import jalaliday from "jalaliday";

dayjs.extend(jalaliday);

export const toPersianDigits = (value: string | number) => {
  const str = String(value);
  const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

  return str.replace(/\d/g, (digit) => persianDigits[Number(digit)]);
};

export const formatJalaliDate = (isoDate: string) => {
  const formatted = dayjs(isoDate)
    .calendar("jalali")
    .locale("fa")
    .format("YYYY/MM/DD");
  return toPersianDigits(formatted);
};

export const formatTime = (time: string) => toPersianDigits(time);

export const formatSlotLabel = (date: string, startTime: string, endTime: string) => {
  return `${formatJalaliDate(date)} - ${formatTime(startTime)} تا ${formatTime(endTime)}`;
};

export const minutesToTimeLabel = (minutes: number) => {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60));
  const hours = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const mins = (clamped % 60).toString().padStart(2, "0");
  return toPersianDigits(`${hours}:${mins}`);
};


