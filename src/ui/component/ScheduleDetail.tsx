import type { Schedule, UserRole } from "../../types";

export function ScheduleDetail({
  schedule,
  role,
  onMarkAsRead,
}: {
  schedule: Schedule;
  role: UserRole;
  onMarkAsRead: () => void;
}) {
  return (
    <div className="detail-body">
      <h3>{schedule.siteName}</h3>
      <p>{schedule.startTime} ~ {schedule.endTime}</p>
      <dl>
        <dt>内容</dt>
        <dd>{schedule.content}</dd>
        <dt>メンバー</dt>
        <dd>{schedule.members.join("、")}</dd>
        <dt>元請け業者</dt>
        <dd>{schedule.contractor}</dd>
        <dt>住所</dt>
        <dd>{schedule.address}</dd>
        <dt>メモ</dt>
        <dd>{schedule.memo}</dd>
      </dl>
      <ReadStatus schedule={schedule} />
      {role === "User" && (
        <button className="primary-button full-width-button" onClick={onMarkAsRead}>確認済みにする</button>
      )}
    </div>
  );
}

export function ReadStatus({ schedule }: { schedule: Schedule }) {
  return (
    <div className="read-status">
      <strong>既読状況</strong>
      <span>{schedule.readBy.length > 0 ? schedule.readBy.join("、") : "未読"}</span>
    </div>
  );
}
