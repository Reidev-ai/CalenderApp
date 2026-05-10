export const MINUTES_IN_DAY = 24 * 60;

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function timeToPercent(time: string): number {
  return (timeToMinutes(time) / MINUTES_IN_DAY) * 100;
}

export function durationToPercent(startTime: string, endTime: string): number {
  return ((timeToMinutes(endTime) - timeToMinutes(startTime)) / MINUTES_IN_DAY) * 100;
}

export function formatDateLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getWeekDays(anchorDate: Date): Date[] {
  const start = new Date(anchorDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function getMonthGridDays(anchorDate: Date): Date[] {
  const firstDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  firstDay.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    return date;
  });
}

export function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}
