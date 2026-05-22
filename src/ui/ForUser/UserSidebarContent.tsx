import type { Schedule } from "../../types";
import { ScheduleDetail } from "../component/ScheduleDetail";

export function UserSidebarContent({
  selectedSchedule,
  currentUserId,
  currentUserName,
  onMarkAsRead,
}: {
  selectedSchedule: Schedule | null;
  currentUserId: string;
  currentUserName: string;
  onMarkAsRead: () => void;
}) {
  if (!selectedSchedule) return <div className="empty-state">タスクを選択してください</div>;

  return <ScheduleDetail schedule={selectedSchedule} role="User" currentUserId={currentUserId} currentUserName={currentUserName} onMarkAsRead={onMarkAsRead} />;
}
