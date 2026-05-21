import type { PointerEvent as ReactPointerEvent } from "react";
import type { Schedule, SidebarMode, Tag, UserRole } from "../../types";
import { AdminSidebarContent } from "../ForAdmin/AdminSidebarContent";
import { GuestSidebarContent } from "../ForGuest/GuestSidebarContent";
import { UserSidebarContent } from "../ForUser/UserSidebarContent";

type SideBarProps = {
  open: boolean;
  role: UserRole;
  mode: SidebarMode;
  selectedSchedule: Schedule | null;
  overlapList: Schedule[];
  tags: Tag[];
  groupMembers: string[];
  groupMembersError: string;
  onModeChange: (mode: SidebarMode) => void;
  onSelectSchedule: (schedule: Schedule) => void;
  onSaveSchedule: (schedule: Schedule) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onDuplicateSchedule: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
  onAddTag: () => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDirtyChange: (isDirty: boolean) => void;
};

export function SideBar({
  open,
  role,
  mode,
  selectedSchedule,
  overlapList,
  tags,
  groupMembers,
  groupMembersError,
  onModeChange,
  onSelectSchedule,
  onSaveSchedule,
  onDeleteSchedule,
  onDuplicateSchedule,
  onMarkAsRead,
  onAddTag,
  onOpenTagContextMenu,
  onStartResize,
  onDirtyChange,
}: SideBarProps) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <button className="sidebar-resize-handle" aria-label="サイドバー幅変更" onPointerDown={onStartResize} />
      <div className="sidebar-header">
        <div className="mode-tabs">
          {(role === "Admin" || (role === "User" && selectedSchedule?.isPersonal)) && <button className={mode === "edit" ? "active" : ""} onClick={() => onModeChange("edit")}>編集</button>}
          <button className={mode === "detail" ? "active" : ""} onClick={() => onModeChange("detail")}>詳細</button>
          <button className={mode === "overlapList" ? "active" : ""} onClick={() => onModeChange("overlapList")}>一覧</button>
        </div>
      </div>
      {mode === "overlapList" ? (
        <OverlapTaskList schedules={overlapList} onSelectSchedule={onSelectSchedule} />
      ) : role === "Admin" || (role === "User" && selectedSchedule?.isPersonal && mode === "edit") ? (
        <AdminSidebarContent
          mode={mode}
          role={role}
          selectedSchedule={selectedSchedule}
          tags={tags}
          groupMembers={groupMembers}
          groupMembersError={groupMembersError}
          onSaveSchedule={onSaveSchedule}
          onDeleteSchedule={onDeleteSchedule}
          onDuplicateSchedule={onDuplicateSchedule}
          onMarkAsRead={onMarkAsRead}
          onAddTag={onAddTag}
          onOpenTagContextMenu={onOpenTagContextMenu}
          onDirtyChange={onDirtyChange}
        />
      ) : role === "User" ? (
        <UserSidebarContent selectedSchedule={selectedSchedule} onMarkAsRead={onMarkAsRead} />
      ) : (
        <GuestSidebarContent selectedSchedule={selectedSchedule} onMarkAsRead={onMarkAsRead} />
      )}
    </aside>
  );
}

function OverlapTaskList({ schedules, onSelectSchedule }: { schedules: Schedule[]; onSelectSchedule: (schedule: Schedule) => void }) {
  return (
    <div className="overlap-list">
      <p className="list-note">表示しきれなかったタスク</p>
      {schedules.map((schedule) => (
        <button className="overlap-item" key={schedule.id} onClick={() => onSelectSchedule(schedule)}>
          <span>{schedule.startTime} ~ {schedule.endTime}</span>
          <strong>{schedule.siteName}</strong>
          <small>{schedule.members.join("、")}</small>
        </button>
      ))}
    </div>
  );
}
