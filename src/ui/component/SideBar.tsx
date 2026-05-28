import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { AuthUser, MemoImage, Schedule, SidebarMode, Tag, UserRole } from "../../types";
import { AdminSidebarContent } from "../ForAdmin/AdminSidebarContent";
import { GuestSidebarContent } from "../ForGuest/GuestSidebarContent";
import { UserSidebarContent } from "../ForUser/UserSidebarContent";

type SideBarProps = {
  open: boolean;
  role: UserRole;
  mode: SidebarMode;
  mobileHeightDvh: number;
  selectedSchedule: Schedule | null;
  currentUserId: string;
  currentUserName: string;
  overlapList: Schedule[];
  tags: Tag[];
  addressCandidates: string[];
  groupMembers: string[];
  groupUsers: AuthUser[];
  memberDisplayNames: Record<string, string>;
  groupMembersError: string;
  onModeChange: (mode: SidebarMode) => void;
  onSelectSchedule: (schedule: Schedule) => void;
  onSaveSchedule: (schedule: Schedule) => Promise<void>;
  onUploadMemoImage: (file: File, onProgress: (progress: number) => void) => Promise<MemoImage>;
  onDeleteSchedule: (scheduleId: string) => void;
  onDuplicateSchedule: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDirtyChange: (isDirty: boolean) => void;
};

export function SideBar({
  open,
  role,
  mode,
  mobileHeightDvh,
  selectedSchedule,
  currentUserId,
  currentUserName,
  overlapList,
  tags,
  addressCandidates,
  groupMembers,
  groupUsers,
  memberDisplayNames,
  groupMembersError,
  onModeChange,
  onSelectSchedule,
  onSaveSchedule,
  onUploadMemoImage,
  onDeleteSchedule,
  onDuplicateSchedule,
  onMarkAsRead,
  onAddTag,
  onUpdateTag,
  onOpenTagContextMenu,
  onStartResize,
  onDirtyChange,
}: SideBarProps) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`} style={{ "--mobile-sidebar-height": `${mobileHeightDvh}dvh` } as CSSProperties}>
      <button className="sidebar-resize-handle" aria-label="サイドバー幅変更" onPointerDown={onStartResize} />
      <div className="sidebar-header">
        <div className="mode-tabs">
          {(role === "Admin" || (role === "User" && selectedSchedule?.isPersonal)) && <button className={mode === "edit" ? "active" : ""} onClick={() => onModeChange("edit")}>編集</button>}
          <button className={mode === "detail" ? "active" : ""} onClick={() => onModeChange("detail")}>詳細</button>
          <button className={mode === "overlapList" ? "active" : ""} onClick={() => onModeChange("overlapList")}>一覧</button>
        </div>
      </div>
      {mode === "overlapList" ? (
        <OverlapTaskList schedules={overlapList} role={role} currentUserId={currentUserId} currentUserName={currentUserName} onSelectSchedule={onSelectSchedule} />
      ) : role === "Admin" || (role === "User" && selectedSchedule?.isPersonal && mode === "edit") ? (
        <AdminSidebarContent
          mode={mode}
          role={role}
          selectedSchedule={selectedSchedule}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          tags={tags}
          addressCandidates={addressCandidates}
          groupMembers={groupMembers}
          groupUsers={groupUsers}
          memberDisplayNames={memberDisplayNames}
          groupMembersError={groupMembersError}
          onSaveSchedule={onSaveSchedule}
          onUploadMemoImage={onUploadMemoImage}
          onDeleteSchedule={onDeleteSchedule}
          onDuplicateSchedule={onDuplicateSchedule}
          onMarkAsRead={onMarkAsRead}
          onAddTag={onAddTag}
          onUpdateTag={onUpdateTag}
          onOpenTagContextMenu={onOpenTagContextMenu}
          onDirtyChange={onDirtyChange}
        />
      ) : role === "User" ? (
        <UserSidebarContent selectedSchedule={selectedSchedule} currentUserId={currentUserId} currentUserName={currentUserName} onMarkAsRead={onMarkAsRead} />
      ) : (
        <GuestSidebarContent selectedSchedule={selectedSchedule} currentUserId={currentUserId} currentUserName={currentUserName} onMarkAsRead={onMarkAsRead} />
      )}
    </aside>
  );
}

function OverlapTaskList({
  schedules,
  role,
  currentUserId,
  currentUserName,
  onSelectSchedule,
}: {
  schedules: Schedule[];
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  onSelectSchedule: (schedule: Schedule) => void;
}) {
  return (
    <div className="overlap-list">
      <p className="list-note">表示しきれなかったタスク</p>
      {schedules.map((schedule) => {
        const isUnread = isUnreadForCurrentUser(schedule, role, currentUserId, currentUserName);

        return (
          <button className={`overlap-item ${isUnread ? "unread-task" : ""}`} key={schedule.id} onClick={() => onSelectSchedule(schedule)}>
            {isUnread && <span className="unread-badge">未</span>}
            <span>{schedule.startTime} ~ {schedule.endTime}</span>
            <strong>{schedule.siteName}</strong>
            <small>{schedule.members.join("、")}</small>
          </button>
        );
      })}
    </div>
  );
}

function isUnreadForCurrentUser(schedule: Schedule, role: UserRole, currentUserId: string, currentUserName: string) {
  if (role !== "User") return false;
  if (currentUserId && (schedule.readByUserIds ?? []).includes(currentUserId)) return false;
  if (currentUserName && schedule.readBy.includes(currentUserName)) return false;
  return true;
}
