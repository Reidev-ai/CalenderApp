import type { Schedule } from "../../types";
import { ScheduleDetail } from "../component/ScheduleDetail";

export function GuestSidebarContent({
  selectedSchedule,
  onMarkAsRead,
}: {
  selectedSchedule: Schedule | null;
  onMarkAsRead: () => void;
}) {
  if (!selectedSchedule) return <div className="empty-state">タスクを選択してください</div>;

  return <ScheduleDetail schedule={selectedSchedule} role="Guest" onMarkAsRead={onMarkAsRead} />;
}
