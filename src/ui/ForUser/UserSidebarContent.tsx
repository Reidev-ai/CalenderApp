import type { Schedule } from "../../types";
import { ScheduleDetail } from "../component/ScheduleDetail";

export function UserSidebarContent({
  selectedSchedule,
  currentUserName,
  onMarkAsRead,
}: {
  selectedSchedule: Schedule | null;
  currentUserName: string;
  onMarkAsRead: () => void;
}) {
  if (!selectedSchedule) return <div className="empty-state">タスクを選択してください</div>;

  return <ScheduleDetail schedule={selectedSchedule} role="User" currentUserName={currentUserName} onMarkAsRead={onMarkAsRead} />;
}
