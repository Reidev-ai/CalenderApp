import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toPng } from "html-to-image";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Download, GripVertical, Menu, PanelRightOpen, Plus, Search, Settings, SlidersHorizontal, Trash2 } from "lucide-react";
import { mockSchedules } from "./mock/mockSchedules";
import type { AuthSession, AuthUser, CalendarViewMode, JoinRequest, Schedule, SidebarMode, Tag, TaskCellPriorityItem, UserRole } from "./types";
import { LoginView } from "./ui/Share/login/LoginView";
import { CalendarDayDesktop, CalendarMonthDesktop, CalendarWeekDesktop } from "./ui/component/CalendarViews";
import { SideBar } from "./ui/component/SideBar";
import { getMonthGridDays, getWeekDays, minutesToTime, toDateKey } from "./utils/time";

const fallbackMaxVisibleColumns = 3;
const currentMember = "佐藤";
const storageKey = "calender-schedules-v1";
const trashStorageKey = "calender-trash-v1";
const tagStorageKey = "calender-tags-v1";
const authStorageKey = "calender-auth-v1";
const defaultTaskCellPriority: TaskCellPriorityItem[] = [
  { id: "time", label: "開始予定時間" },
  { id: "siteName", label: "現場名" },
  { id: "members", label: "メンバー" },
  { id: "contractor", label: "元請け業者" },
  { id: "address", label: "住所" },
  { id: "memo", label: "メモ" },
];
const defaultTags: Tag[] = [
  { id: "blue", name: "通常", color: "#3b82f6" },
  { id: "green", name: "確認", color: "#22c55e" },
  { id: "orange", name: "注意", color: "#f97316" },
  { id: "red", name: "重要", color: "#ef4444" },
  { id: "purple", name: "夜間", color: "#a855f7" },
  { id: "teal", name: "調査", color: "#14b8a6" },
];

export default function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    const saved = localStorage.getItem(authStorageKey);
    return saved ? (JSON.parse(saved) as AuthSession) : null;
  });
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? (JSON.parse(saved) as Schedule[]) : mockSchedules;
  });
  const [trashSchedules, setTrashSchedules] = useState<Schedule[]>(() => {
    const saved = localStorage.getItem(trashStorageKey);
    return saved ? (JSON.parse(saved) as Schedule[]) : [];
  });
  const [tags, setTags] = useState<Tag[]>(() => {
    const saved = localStorage.getItem(tagStorageKey);
    return saved ? (JSON.parse(saved) as Tag[]) : defaultTags;
  });
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(mockSchedules[0]?.id ?? null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [settingOpen, setSettingOpen] = useState(false);
  const [captureRendering, setCaptureRendering] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("edit");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [overlapList, setOverlapList] = useState<Schedule[]>([]);
  const [anchorDate, setAnchorDate] = useState(() => new Date("2026-05-11T09:00:00"));
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const role = authSession?.user.role ?? "Guest";
  const [searchQuery, setSearchQuery] = useState("");
  const [memberFilters, setMemberFilters] = useState<string[]>([]);
  const [groupUsers, setGroupUsers] = useState<AuthUser[]>([]);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupMembersError, setGroupMembersError] = useState("");
  const [apiMessage, setApiMessage] = useState("");
  const [dirtyEditor, setDirtyEditor] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [maxVisibleColumns, setMaxVisibleColumns] = useState(fallbackMaxVisibleColumns);
  const [taskCellPriority, setTaskCellPriority] = useState<TaskCellPriorityItem[]>(defaultTaskCellPriority);
  const [tagContextMenu, setTagContextMenu] = useState<{ tag: Tag; x: number; y: number } | null>(null);
  const now = useCurrentTime();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const captureStageRef = useRef<HTMLDivElement | null>(null);
  const weekDates = useMemo(() => getWeekDays(anchorDate), [anchorDate]);
  const monthDates = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);
  const selectedSchedule = schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null;
  const allMembers = useMemo(() => [...new Set(schedules.flatMap((schedule) => schedule.members))].sort(), [schedules]);
  const allTags = useMemo(() => tags, [tags]);
  const visibleSchedules = useMemo(
    () => filterSchedulesByUi(schedules, role, searchQuery, memberFilters, tagFilters),
    [schedules, role, searchQuery, memberFilters, tagFilters],
  );
  const unreadSchedules = useMemo(
    () => visibleSchedules.filter((schedule) => !schedule.readBy.includes(currentMember)),
    [visibleSchedules],
  );
  const searchActive = searchQuery.trim() !== "" || memberFilters.length > 0 || tagFilters.length > 0;

  useEffect(() => {
    if (authSession) {
      localStorage.setItem(authStorageKey, JSON.stringify(authSession));
    } else {
      localStorage.removeItem(authStorageKey);
    }
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;

    void refreshGroupMembers(authSession.user.groupId);
    void refreshServerData();
  }, [authSession?.user.groupId]);

  async function refreshServerData() {
    setApiMessage("");

    try {
      const [schedulePayload, trashPayload, tagPayload] = await Promise.all([
        getApiJson<{ schedules: Schedule[] }>("/api/schedules"),
        getApiJson<{ schedules: Schedule[] }>("/api/trash"),
        getApiJson<{ tags: Tag[] }>("/api/tags"),
      ]);
      setSchedules(schedulePayload.schedules);
      setTrashSchedules(trashPayload.schedules);
      setTags(tagPayload.tags);
      setSelectedScheduleId((current) => current ?? schedulePayload.schedules[0]?.id ?? null);
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "APIからデータを取得できませんでした");
    }
  }

  async function refreshGroupMembers(groupId: string) {
    setGroupMembersError("");
    const fallbackMembers = authSession?.user.name ? [authSession.user.name] : [];
    setGroupMembers((current) => mergeMemberNames(fallbackMembers, current));

    try {
      const payload = await getApiJson<{ users: AuthSession["user"][] }>(`/api/groups/${encodeURIComponent(groupId)}/members`);
      setGroupUsers(payload.users);
      setGroupMembers(mergeMemberNames(fallbackMembers, payload.users.map((user) => user.name)));
    } catch (error) {
      try {
        const payload = await getApiJson<{ joinRequests: JoinRequest[] }>(`/api/join-requests?groupId=${encodeURIComponent(groupId)}`);
        const approvedMembers = payload.joinRequests
          .filter((request) => request.status === "approved")
          .map((request) => request.user?.name)
          .filter((name): name is string => Boolean(name));
        setGroupMembers(mergeMemberNames(fallbackMembers, approvedMembers));
        setGroupUsers([]);
        setGroupMembersError("");
      } catch {
        setGroupMembers((current) => mergeMemberNames(fallbackMembers, current));
        setGroupMembersError(error instanceof Error ? error.message : "グループメンバーを取得できませんでした");
      }
    }
  }

  async function updateGroupMember(userId: string, patch: Partial<Pick<AuthUser, "name" | "role">>) {
    if (!authSession) return;

    try {
      await patchApiJson<{ user: AuthUser }>(`/api/groups/${encodeURIComponent(authSession.user.groupId)}/members/${encodeURIComponent(userId)}`, patch);
      await refreshGroupMembers(authSession.user.groupId);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "メンバーを更新できませんでした");
    }
  }

  async function removeGroupMember(userId: string) {
    if (!authSession || !confirm("このメンバーをグループから削除しますか？")) return;

    try {
      await deleteApiJson<{ user: AuthUser }>(`/api/groups/${encodeURIComponent(authSession.user.groupId)}/members/${encodeURIComponent(userId)}`);
      await refreshGroupMembers(authSession.user.groupId);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "メンバーを削除できませんでした");
    }
  }

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem(trashStorageKey, JSON.stringify(trashSchedules));
  }, [trashSchedules]);

  useEffect(() => {
    localStorage.setItem(tagStorageKey, JSON.stringify(tags));
  }, [tags]);

  useEffect(() => {
    if (role !== "Admin" && sidebarMode === "edit") {
      setSidebarMode("detail");
    }
  }, [role, sidebarMode]);

  function confirmDiscardIfDirty() {
    return !dirtyEditor || confirm("保存していない変更があります。破棄しますか？");
  }

  function openSchedule(schedule: Schedule) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedScheduleId(schedule.id);
    setSidebarMode(role === "Admin" ? "edit" : "detail");
    setSidebarOpen(true);
  }

  function openOverlapList(schedules: Schedule[]) {
    if (!confirmDiscardIfDirty()) return;
    setOverlapList(schedules);
    setSidebarMode("overlapList");
    setSidebarOpen(true);
  }

  function changeSidebarMode(mode: SidebarMode) {
    if (mode === "overlapList") {
      if (!confirmDiscardIfDirty()) return;
      setOverlapList(getCurrentViewSchedules());
    }
    setSidebarMode(mode);
  }

  function getCurrentViewSchedules() {
    if (viewMode === "month") {
      return visibleSchedules.filter((schedule) => {
        const endDate = schedule.endDate ?? schedule.date;
        const monthStart = toDateKey(monthDates[0]);
        const monthEnd = toDateKey(monthDates[monthDates.length - 1]);
        return schedule.date <= monthEnd && endDate >= monthStart;
      });
    }

    if (viewMode === "week") {
      const weekStart = toDateKey(weekDates[0]);
      const weekEnd = toDateKey(weekDates[weekDates.length - 1]);
      return visibleSchedules.filter((schedule) => {
        const endDate = schedule.endDate ?? schedule.date;
        return schedule.date <= weekEnd && endDate >= weekStart;
      });
    }

    const dayKey = toDateKey(anchorDate);
    return visibleSchedules.filter((schedule) => {
      const endDate = schedule.endDate ?? schedule.date;
      return schedule.date <= dayKey && endDate >= dayKey;
    });
  }

  function moveScheduleByDrag(schedule: Schedule, nextDate: string, nextStartMinutes: number) {
    if (role !== "Admin") return;
    if (!confirmDiscardIfDirty()) return;

    const original = schedules.find((item) => item.id === schedule.id);
    if (!original) return;

    const durationMinutes = getScheduleDurationMinutes(original);
    const nextStart = Math.max(0, Math.min(1439, nextStartMinutes));
    const nextEndTotal = nextStart + durationMinutes;
    const endDayOffset = Math.floor(nextEndTotal / 1440);
    const endMinutes = nextEndTotal % 1440;
    const nextSchedule = {
      ...original,
      date: nextDate,
      endDate: addDaysToDateKey(nextDate, endDayOffset),
      startTime: minutesToTime(nextStart),
      endTime: minutesToTime(endMinutes),
    };

    void saveSchedule(nextSchedule);
  }

  async function saveSchedule(schedule: Schedule) {
    const normalizedSchedule = normalizeScheduleDateRange(schedule);
    const exists = schedules.some((item) => item.id === normalizedSchedule.id);

    try {
      const payload = exists
        ? await putApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(normalizedSchedule.id)}`, normalizedSchedule)
        : await postApiJson<{ schedule: Schedule }>("/api/schedules", normalizedSchedule);
      setSchedules((current) => {
        const hasSchedule = current.some((item) => item.id === payload.schedule.id);
        return hasSchedule ? current.map((item) => (item.id === payload.schedule.id ? payload.schedule : item)) : [...current, payload.schedule];
      });
      setSelectedScheduleId(payload.schedule.id);
      setSidebarMode("edit");
      setDirtyEditor(false);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "スケジュールを保存できませんでした");
    }
  }

  async function deleteSchedule(scheduleId: string) {
    const target = schedules.find((schedule) => schedule.id === scheduleId);
    if (!target || !confirm("このタスクをゴミ箱に移動しますか？")) return;

    try {
      const payload = await deleteApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(scheduleId)}`);
      setSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
      setTrashSchedules((current) => [payload.schedule, ...current]);
      setSelectedScheduleId(null);
      setDirtyEditor(false);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "スケジュールを削除できませんでした");
    }
  }

  async function restoreSchedule(schedule: Schedule) {
    try {
      const payload = await postApiJson<{ schedule: Schedule }>(`/api/trash/${encodeURIComponent(schedule.id)}/restore`);
      setTrashSchedules((current) => current.filter((item) => item.id !== payload.schedule.id));
      setSchedules((current) => [...current, payload.schedule]);
      setSelectedScheduleId(payload.schedule.id);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "スケジュールを復元できませんでした");
    }
  }

  function duplicateSchedule(schedule: Schedule) {
    if (!confirmDiscardIfDirty()) return;
    const duplicated = {
      ...schedule,
      id: createScheduleId(),
      siteName: `${schedule.siteName} コピー`,
      readBy: [],
    };
    void saveSchedule(duplicated);
  }

  function createNewSchedule() {
    if (role !== "Admin") return;
    if (!confirmDiscardIfDirty()) return;
    const dateKey = selectedDateKey ?? toDateKey(new Date());
    const { startTime, endTime } = getDefaultScheduleTimeRange(new Date());
    const schedule: Schedule = {
      id: createScheduleId(),
      siteName: "新規現場",
      content: "",
      date: dateKey,
      endDate: dateKey,
      startTime,
      endTime,
      members: [],
      contractor: "",
      address: "",
      memo: "",
      tagColor: "#3b82f6",
      tagColors: ["#3b82f6"],
      readBy: [],
      isPersonal: false,
    };
    void saveSchedule(schedule);
    setSidebarOpen(true);
  }

  async function markSelectedAsRead() {
    if (!selectedSchedule) return;
    try {
      const payload = await postApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(selectedSchedule.id)}/read`, { member: currentMember });
      setSchedules((current) => current.map((schedule) => (schedule.id === payload.schedule.id ? payload.schedule : schedule)));
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "既読にできませんでした");
    }
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      setSidebarWidth(Math.min(620, Math.max(300, nextWidth)));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  async function addTag() {
    try {
      const payload = await postApiJson<{ tag: Tag }>("/api/tags", { id: createScheduleId(), name: "新しいタグ", color: "#64748b" });
      setTags((current) => [...current, payload.tag]);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "タグを追加できませんでした");
    }
  }

  async function updateTag(tagId: string, patch: Partial<Tag>) {
    try {
      const payload = await patchApiJson<{ tag: Tag }>(`/api/tags/${encodeURIComponent(tagId)}`, patch);
      setTags((current) => current.map((tag) => (tag.id === tagId ? payload.tag : tag)));
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "タグを更新できませんでした");
    }
  }

  function openTagContextMenu(tag: Tag, x: number, y: number) {
    setTagContextMenu({ tag, x, y });
  }

  async function deleteTag(tag: Tag) {
    try {
      await deleteApiJson<{ tag: Tag }>(`/api/tags/${encodeURIComponent(tag.id)}`);
      setTags((current) => current.filter((item) => item.id !== tag.id));
      setSchedules((current) => current.map((schedule) => removeTagFromSchedule(schedule, tag.color)));
      setTrashSchedules((current) => current.map((schedule) => removeTagFromSchedule(schedule, tag.color)));
      setTagFilters((current) => current.filter((color) => color !== tag.color));
      setTagContextMenu(null);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "タグを削除できませんでした");
    }
  }

  function moveAnchor(step: number) {
    setAnchorDate((current) => {
      const next = new Date(current);
      if (viewMode === "month") next.setMonth(next.getMonth() + step);
      if (viewMode === "week") next.setDate(next.getDate() + step * 7);
      if (viewMode === "day") next.setDate(next.getDate() + step);
      return next;
    });
  }

  function selectDate(dateKey: string) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedDateKey(dateKey);
    setAnchorDate(dateKeyToDate(dateKey));
  }

  function changeViewMode(mode: CalendarViewMode) {
    if (selectedDateKey) setAnchorDate(dateKeyToDate(selectedDateKey));
    setViewMode(mode);
  }

  function goToday() {
    const today = new Date();
    setAnchorDate(today);
    setSelectedDateKey(toDateKey(today));
  }

  async function downloadCalendarImage() {
    setCaptureLoading(true);
    setCaptureRendering(true);

    try {
      await nextAnimationFrame();
      await nextAnimationFrame();

      if (!captureStageRef.current) return;

      const dataUrl = await toPng(captureStageRef.current, {
        width: 1920,
        height: 1080,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      downloadDataUrl(dataUrl, `calendar-${viewMode}-${toDateKey(anchorDate)}.png`);
    } finally {
      setCaptureRendering(false);
      setCaptureLoading(false);
    }
  }

  function logout() {
    setAuthSession(null);
    setSelectedScheduleId(null);
    setSidebarMode("detail");
  }

  if (!authSession) {
    return <LoginView onAuthenticated={setAuthSession} />;
  }

  const sidebarTitleButton = (
    <button className="icon-button calendar-title-sidebar-button" aria-label={sidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"} onClick={() => setSidebarOpen((value) => !value)}>
      <PanelRightOpen size={18} />
    </button>
  );

  return (
    <div className="app-shell">
      <TopBar
        viewMode={viewMode}
        role={role}
        searchQuery={searchQuery}
        memberFilters={memberFilters}
        tagFilters={tagFilters}
        members={allMembers}
        tags={allTags}
        unreadCount={unreadSchedules.length}
        userName={authSession.user.name}
        groupId={authSession.user.groupId}
        groupMembers={groupMembers}
        groupUsers={groupUsers}
        groupMembersError={groupMembersError}
        onUpdateGroupMember={updateGroupMember}
        onRemoveGroupMember={removeGroupMember}
        onGroupMembersRefresh={() => refreshGroupMembers(authSession.user.groupId)}
        onOpenSetting={() => setSettingOpen(true)}
        onOpenNotifications={() => setNotificationOpen((value) => !value)}
        onViewModeChange={changeViewMode}
        onLogout={logout}
        onSearchQueryChange={setSearchQuery}
        onMemberFiltersChange={setMemberFilters}
        onTagFiltersChange={setTagFilters}
        onCreateNew={createNewSchedule}
        onToday={goToday}
        onPrevious={() => moveAnchor(-1)}
        onNext={() => moveAnchor(1)}
      />
      <main
        className={`workspace ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}
        style={{ gridTemplateColumns: sidebarOpen ? `minmax(0, 1fr) ${sidebarWidth}px` : "minmax(0, 1fr) 0px" }}
      >
        {apiMessage && <div className="api-message-banner">{apiMessage}</div>}
        {searchActive && (
          <SearchResultPanel
            schedules={visibleSchedules}
            onSelectSchedule={openSchedule}
            onClear={() => {
              setSearchQuery("");
              setMemberFilters([]);
              setTagFilters([]);
            }}
          />
        )}
        {notificationOpen && (
          <NotificationPanel
            unreadSchedules={unreadSchedules}
            onSelectSchedule={(schedule) => {
              openSchedule(schedule);
              setNotificationOpen(false);
            }}
          />
        )}
        {viewMode === "month" ? (
          <CalendarMonthDesktop
            anchorDate={anchorDate}
            monthDates={monthDates}
            schedules={visibleSchedules}
            role={role}
            taskCellPriority={taskCellPriority}
            selectedDateKey={selectedDateKey}
            titleAction={sidebarTitleButton}
            onSelectDate={selectDate}
            onSelectSchedule={openSchedule}
            onOpenHiddenList={openOverlapList}
          />
        ) : viewMode === "day" ? (
          <CalendarDayDesktop
            date={anchorDate}
            schedules={visibleSchedules}
            fallbackMaxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
            role={role}
            taskCellPriority={taskCellPriority}
            titleAction={sidebarTitleButton}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
            onMoveSchedule={moveScheduleByDrag}
          />
        ) : (
          <CalendarWeekDesktop
            weekDates={weekDates}
            schedules={visibleSchedules}
            fallbackMaxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
            role={role}
            taskCellPriority={taskCellPriority}
            titleAction={sidebarTitleButton}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
            onMoveSchedule={moveScheduleByDrag}
          />
        )}
        <SideBar
          open={sidebarOpen}
          role={role}
          mode={sidebarMode}
          selectedSchedule={selectedSchedule}
          overlapList={overlapList}
          tags={tags}
          groupMembers={groupMembers}
          groupMembersError={groupMembersError}
          onModeChange={changeSidebarMode}
          onSelectSchedule={openSchedule}
          onSaveSchedule={saveSchedule}
          onDeleteSchedule={deleteSchedule}
          onDuplicateSchedule={duplicateSchedule}
          onMarkAsRead={markSelectedAsRead}
          onAddTag={addTag}
          onOpenTagContextMenu={openTagContextMenu}
          onStartResize={startSidebarResize}
          onDirtyChange={setDirtyEditor}
        />
      </main>
      <SettingDrawer
        open={settingOpen}
        tags={tags}
        taskCellPriority={taskCellPriority}
        trashSchedules={trashSchedules}
        captureLoading={captureLoading}
        onDownloadCalendarImage={downloadCalendarImage}
        onTaskCellPriorityChange={setTaskCellPriority}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onRestoreSchedule={restoreSchedule}
        onOpenTagContextMenu={openTagContextMenu}
        onClose={() => setSettingOpen(false)}
      />
      {captureRendering && (
        <div className="calendar-capture-layer" aria-hidden="true">
          <div className="calendar-capture-stage" ref={captureStageRef}>
            {viewMode === "month" ? (
              <CalendarMonthDesktop
                anchorDate={anchorDate}
                monthDates={monthDates}
                schedules={visibleSchedules}
                role={role}
                taskCellPriority={taskCellPriority}
                selectedDateKey={selectedDateKey}
                onSelectDate={() => undefined}
                onSelectSchedule={() => undefined}
                onOpenHiddenList={() => undefined}
              />
            ) : viewMode === "day" ? (
              <CalendarDayDesktop
                date={anchorDate}
                schedules={visibleSchedules}
                fallbackMaxVisibleColumns={maxVisibleColumns}
                currentMinute={currentMinute}
                role={role}
                taskCellPriority={taskCellPriority}
                onSelectSchedule={() => undefined}
                onOpenOverlapList={() => undefined}
                onMoveSchedule={() => undefined}
              />
            ) : (
              <CalendarWeekDesktop
                weekDates={weekDates}
                schedules={visibleSchedules}
                fallbackMaxVisibleColumns={maxVisibleColumns}
                currentMinute={currentMinute}
                role={role}
                taskCellPriority={taskCellPriority}
                onSelectSchedule={() => undefined}
                onOpenOverlapList={() => undefined}
                onMoveSchedule={() => undefined}
              />
            )}
          </div>
        </div>
      )}
      {tagContextMenu && (
        <TagContextMenu
          tag={tagContextMenu.tag}
          x={tagContextMenu.x}
          y={tagContextMenu.y}
          onDelete={deleteTag}
          onClose={() => setTagContextMenu(null)}
        />
      )}
    </div>
  );
}

type TopBarProps = {
  viewMode: CalendarViewMode;
  role: UserRole;
  searchQuery: string;
  memberFilters: string[];
  tagFilters: string[];
  members: string[];
  tags: Tag[];
  unreadCount: number;
  userName: string;
  groupId: string;
  groupMembers: string[];
  groupUsers: AuthUser[];
  groupMembersError: string;
  onUpdateGroupMember: (userId: string, patch: Partial<Pick<AuthUser, "name" | "role">>) => void;
  onRemoveGroupMember: (userId: string) => void;
  onGroupMembersRefresh: () => void;
  onOpenSetting: () => void;
  onOpenNotifications: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onLogout: () => void;
  onSearchQueryChange: (query: string) => void;
  onMemberFiltersChange: (members: string[]) => void;
  onTagFiltersChange: (tags: string[]) => void;
  onCreateNew: () => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

function TopBar({
  viewMode,
  role,
  searchQuery,
  memberFilters,
  tagFilters,
  members,
  tags,
  unreadCount,
  userName,
  groupId,
  groupMembers,
  groupUsers,
  groupMembersError,
  onUpdateGroupMember,
  onRemoveGroupMember,
  onGroupMembersRefresh,
  onOpenSetting,
  onOpenNotifications,
  onViewModeChange,
  onLogout,
  onSearchQueryChange,
  onMemberFiltersChange,
  onTagFiltersChange,
  onCreateNew,
  onToday,
  onPrevious,
  onNext,
}: TopBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [joinRequestLoading, setJoinRequestLoading] = useState(false);
  const [joinRequestMessage, setJoinRequestMessage] = useState("");
  const [editingMemberNameById, setEditingMemberNameById] = useState<Record<string, string>>({});
  const hasFilter = memberFilters.length > 0 || tagFilters.length > 0;
  const userInitial = getUserInitial(userName);
  const pendingJoinRequests = joinRequests.filter((request) => request.status === "pending");

  useEffect(() => {
    if (role !== "Admin") return;
    void refreshJoinRequests();
  }, [role, groupId]);

  async function refreshJoinRequests() {
    setJoinRequestLoading(true);
    setJoinRequestMessage("");

    try {
      const payload = await getApiJson<{ joinRequests: JoinRequest[] }>(`/api/join-requests?groupId=${encodeURIComponent(groupId)}`);
      setJoinRequests(payload.joinRequests);
    } catch (error) {
      setJoinRequestMessage(error instanceof Error ? error.message : "承認待ちを取得できませんでした");
    } finally {
      setJoinRequestLoading(false);
    }
  }

  async function approvePendingRequest(requestId: string) {
    setJoinRequestLoading(true);
    setJoinRequestMessage("");

    try {
      await postApiJson(`/api/join-requests/${requestId}/approve`);
      await refreshJoinRequests();
      onGroupMembersRefresh();
    } catch (error) {
      setJoinRequestMessage(error instanceof Error ? error.message : "承認に失敗しました");
    } finally {
      setJoinRequestLoading(false);
    }
  }

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu-button" aria-label="メニュー" onClick={() => setMobileMenuOpen(true)}>
        <Menu size={18} />
      </button>
      <div className="topbar-group topbar-primary-actions">
        <div className="search-root">
          <div className="search-box">
            <Search size={16} />
            <input value={searchQuery} placeholder="検索" onChange={(event) => onSearchQueryChange(event.target.value)} />
          </div>
        </div>
        <div className="filter-menu-root">
          <button className={`secondary-button filter-button ${hasFilter ? "active-filter" : ""}`} onClick={() => setFilterOpen((value) => !value)}>
            <SlidersHorizontal size={16} />
            <span className="button-label">フィルター</span>
          </button>
          {filterOpen && (
            <div className="filter-popover">
              <div className="filter-field">
                <span>メンバー</span>
                <div className="filter-check-list">
                  {members.map((member) => (
                    <label className="filter-check-item" key={member}>
                      <input
                        type="checkbox"
                        checked={memberFilters.includes(member)}
                        onChange={() => onMemberFiltersChange(toggleListValue(memberFilters, member))}
                      />
                      <span>{member}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="filter-field">
                <span>タグ</span>
                <div className="filter-check-list">
                  {tags.map((tag) => (
                    <label className="filter-check-item" key={tag.id}>
                      <input
                        type="checkbox"
                        checked={tagFilters.includes(tag.color)}
                        onChange={() => onTagFiltersChange(toggleListValue(tagFilters, tag.color))}
                      />
                      <span className="tag-preview-dot" style={{ background: tag.color }} />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <button className="icon-button" aria-label="設定" onClick={onOpenSetting}>
          <Settings size={18} />
        </button>
        <button className="icon-button notification-button" aria-label="通知" onClick={onOpenNotifications}>
          <Bell size={18} />
          {unreadCount > 0 && <span className="notification-dot" />}
        </button>
        {role === "Admin" && (
          <button className="primary-button" onClick={onCreateNew}>
            <Plus size={16} />
            <span className="button-label">新規作成</span>
          </button>
        )}
      </div>
      <div className="topbar-group">
        <div className="segmented-control" aria-label="表示切替">
          <button className={viewMode === "month" ? "active" : ""} onClick={() => onViewModeChange("month")}>月</button>
          <button className={viewMode === "week" ? "active" : ""} onClick={() => onViewModeChange("week")}>週</button>
          <button className={viewMode === "day" ? "active" : ""} onClick={() => onViewModeChange("day")}>日</button>
        </div>
        <label className="view-mode-select" aria-label="表示切替">
          <select value={viewMode} onChange={(event) => onViewModeChange(event.target.value as CalendarViewMode)}>
            <option value="month">月</option>
            <option value="week">週</option>
            <option value="day">日</option>
          </select>
        </label>
        <button className="secondary-button" onClick={onToday}>
          <CalendarDays size={16} />
          <span className="today-button-label">今日</span>
        </button>
        <button className="icon-button" aria-label="前へ" onClick={onPrevious}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-button" aria-label="次へ" onClick={onNext}>
          <ChevronRight size={18} />
        </button>
        <button className="account-avatar-button" aria-label="アカウント" onClick={() => setAccountPanelOpen(true)}>
          {userInitial}
          {pendingJoinRequests.length > 0 && <span className="account-pending-badge">{pendingJoinRequests.length}</span>}
        </button>
      </div>
      {accountPanelOpen && (
        <>
          <button className="account-panel-overlay" aria-label="アカウントパネルを閉じる" onClick={() => setAccountPanelOpen(false)} />
          <aside className="account-panel">
            <div className="account-panel-header">
              <div className="account-avatar-large">{userInitial}</div>
              <div className="account-panel-user">
                <h2>{userName}</h2>
                <p>{role}</p>
              </div>
              <button className="icon-button" aria-label="アカウントパネルを閉じる" onClick={() => setAccountPanelOpen(false)}>×</button>
            </div>
            <div className="account-panel-section">
              <h3>グループ</h3>
              <div className="account-info-row">
                <span>グループID</span>
                <strong>{groupId}</strong>
              </div>
              <div className="account-member-list">
                {groupUsers.length > 0 ? (
                  groupUsers.map((member) => {
                    const draftName = editingMemberNameById[member.id] ?? member.name;

                    return (
                      <div className="account-member-item editable" key={member.id}>
                        <span className="account-member-avatar">{getUserInitial(member.name)}</span>
                        <input
                          value={draftName}
                          aria-label={`${member.name}の表示名`}
                          onChange={(event) => setEditingMemberNameById((current) => ({ ...current, [member.id]: event.target.value }))}
                          onBlur={() => {
                            if (draftName.trim() && draftName.trim() !== member.name) onUpdateGroupMember(member.id, { name: draftName.trim() });
                          }}
                        />
                        <select value={member.role} onChange={(event) => onUpdateGroupMember(member.id, { role: event.target.value as UserRole })}>
                          <option value="Admin">Admin</option>
                          <option value="User">User</option>
                        </select>
                        <button className="icon-button" aria-label={`${member.name}を削除`} onClick={() => onRemoveGroupMember(member.id)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })
                ) : groupMembers.length === 0 ? (
                  <div className="empty-state compact">{groupMembersError ? "メンバーを取得できません" : "メンバーはいません"}</div>
                ) : (
                  groupMembers.map((member) => (
                    <div className="account-member-item" key={member}>
                      <span className="account-member-avatar">{getUserInitial(member)}</span>
                      <span>{member}</span>
                    </div>
                  ))
                )}
              </div>
              {groupMembersError && <p className="account-panel-message">{groupMembersError}</p>}
            </div>
            {role === "Admin" && (
              <div className="account-panel-section">
                <div className="account-section-title-row">
                  <h3>承認待ち</h3>
                  <button className="text-button" disabled={joinRequestLoading} onClick={refreshJoinRequests}>更新</button>
                </div>
                {joinRequestMessage && <p className="account-panel-message">{joinRequestMessage}</p>}
                {joinRequestLoading && pendingJoinRequests.length === 0 ? (
                  <div className="empty-state compact">読み込み中</div>
                ) : pendingJoinRequests.length === 0 ? (
                  <div className="empty-state compact">承認待ちはありません</div>
                ) : (
                  <div className="pending-request-list">
                    {pendingJoinRequests.map((request) => (
                      <div className="pending-request-item" key={request.id}>
                        <div className="pending-request-user">
                          <strong>{request.user?.name ?? "名前なし"}</strong>
                          <span>{request.user?.email ?? request.userId}</span>
                        </div>
                        <button className="secondary-button pending-approve-button" disabled={joinRequestLoading} onClick={() => approvePendingRequest(request.id)}>
                          <Check size={15} />
                          承認
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className="danger-button full-width-button logout-button"
              onClick={() => {
                setAccountPanelOpen(false);
                onLogout();
              }}
            >
              ログアウト
            </button>
          </aside>
        </>
      )}
      {mobileMenuOpen && (
        <>
          <button className="mobile-menu-overlay" aria-label="メニューを閉じる" onClick={() => setMobileMenuOpen(false)} />
          <aside className="mobile-action-drawer">
            <div className="mobile-action-header">
              <h2>操作</h2>
              <button className="icon-button" aria-label="メニューを閉じる" onClick={() => setMobileMenuOpen(false)}>×</button>
            </div>
            <label className="mobile-action-search">
              <Search size={16} />
              <input value={searchQuery} placeholder="検索" onChange={(event) => onSearchQueryChange(event.target.value)} />
            </label>
            <div className="mobile-action-section">
              <div className="mobile-action-section-title">
                <SlidersHorizontal size={16} />
                <span>フィルター</span>
              </div>
              <div className="filter-field">
                <span>メンバー</span>
                <div className="filter-check-list">
                  {members.map((member) => (
                    <label className="filter-check-item" key={member}>
                      <input
                        type="checkbox"
                        checked={memberFilters.includes(member)}
                        onChange={() => onMemberFiltersChange(toggleListValue(memberFilters, member))}
                      />
                      <span>{member}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="filter-field">
                <span>タグ</span>
                <div className="filter-check-list">
                  {tags.map((tag) => (
                    <label className="filter-check-item" key={tag.id}>
                      <input
                        type="checkbox"
                        checked={tagFilters.includes(tag.color)}
                        onChange={() => onTagFiltersChange(toggleListValue(tagFilters, tag.color))}
                      />
                      <span className="tag-preview-dot" style={{ background: tag.color }} />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mobile-action-buttons">
              <button
                className="secondary-button full-width-button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenSetting();
                }}
              >
                <Settings size={16} />
                設定
              </button>
              {role === "Admin" && (
                <button
                  className="primary-button full-width-button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onCreateNew();
                  }}
                >
                  <Plus size={16} />
                  新規作成
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </header>
  );
}

function getUserInitial(name: string) {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName[0].toUpperCase() : "?";
}

function mergeMemberNames(...memberGroups: string[][]) {
  return [...new Set(memberGroups.flat().map((member) => member.trim()).filter(Boolean))];
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function getApiJson<T>(path: string): Promise<T> {
  return requestApiJson<T>(path, { method: "GET" });
}

async function postApiJson<T>(path: string, body?: unknown): Promise<T> {
  return requestApiJson<T>(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function putApiJson<T>(path: string, body: unknown): Promise<T> {
  return requestApiJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchApiJson<T>(path: string, body: unknown): Promise<T> {
  return requestApiJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteApiJson<T>(path: string): Promise<T> {
  return requestApiJson<T>(path, { method: "DELETE" });
}

async function requestApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const apiBaseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new Error(`APIに接続できません: ${apiBaseUrl}`);
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "API error");
  }

  return payload as T;
}

function getApiBaseUrl() {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (viteEnv?.VITE_API_BASE_URL) return viteEnv.VITE_API_BASE_URL;

  return `http://${window.location.hostname}:8787`;
}

function NotificationPanel({ unreadSchedules, onSelectSchedule }: { unreadSchedules: Schedule[]; onSelectSchedule: (schedule: Schedule) => void }) {
  return (
    <aside className="notification-panel">
      <h2>通知</h2>
      <p>{unreadSchedules.length}件の未確認タスクがあります</p>
      {unreadSchedules.length === 0 ? (
        <div className="empty-state">通知はありません</div>
      ) : (
        unreadSchedules.map((schedule) => (
          <button className="overlap-item" key={schedule.id} onClick={() => onSelectSchedule(schedule)}>
            <span>{schedule.date} {schedule.startTime}</span>
            <strong>{schedule.siteName}</strong>
            <small>{schedule.members.join("、")}</small>
          </button>
        ))
      )}
    </aside>
  );
}

function SearchResultPanel({
  schedules,
  onSelectSchedule,
  onClear,
}: {
  schedules: Schedule[];
  onSelectSchedule: (schedule: Schedule) => void;
  onClear: () => void;
}) {
  const sortedSchedules = [...schedules].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

  return (
    <aside className="search-result-panel">
      <div className="search-result-head">
        <div>
          <strong>検索結果</strong>
          <span>{sortedSchedules.length}件</span>
        </div>
        <button className="text-button" onClick={onClear}>クリア</button>
      </div>
      {sortedSchedules.length === 0 ? (
        <div className="empty-state compact">該当するタスクはありません</div>
      ) : (
        <div className="search-result-list">
          {sortedSchedules.slice(0, 20).map((schedule) => (
            <button className="search-result-item" key={schedule.id} onClick={() => onSelectSchedule(schedule)}>
              <span>{formatScheduleDateRange(schedule)} {schedule.startTime} ~ {schedule.endTime}</span>
              <strong>{schedule.siteName}</strong>
              <small>{schedule.members.join("、") || "メンバー未指定"}</small>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function TagContextMenu({
  tag,
  x,
  y,
  onDelete,
  onClose,
}: {
  tag: Tag;
  x: number;
  y: number;
  onDelete: (tag: Tag) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button className="context-menu-backdrop" aria-label="タグメニューを閉じる" onClick={onClose} />
      <div className="tag-context-menu" style={{ left: x, top: y }}>
        <div className="tag-context-title">
          <span className="tag-preview-dot" style={{ background: tag.color }} />
          <strong>{tag.name}</strong>
        </div>
        <button className="danger-button" onClick={() => onDelete(tag)}>
          <Trash2 size={15} />
          削除
        </button>
      </div>
    </>
  );
}

function SettingDrawer({
  open,
  tags,
  taskCellPriority,
  trashSchedules,
  captureLoading,
  onDownloadCalendarImage,
  onTaskCellPriorityChange,
  onAddTag,
  onUpdateTag,
  onRestoreSchedule,
  onOpenTagContextMenu,
  onClose,
}: {
  open: boolean;
  tags: Tag[];
  taskCellPriority: TaskCellPriorityItem[];
  trashSchedules: Schedule[];
  captureLoading: boolean;
  onDownloadCalendarImage: () => void;
  onTaskCellPriorityChange: (priority: TaskCellPriorityItem[]) => void;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onRestoreSchedule: (schedule: Schedule) => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onClose: () => void;
}) {
  const [draggedPriorityIndex, setDraggedPriorityIndex] = useState<number | null>(null);

  function movePriorityItem(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const next = [...taskCellPriority];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    onTaskCellPriorityChange(next);
  }

  return (
    <>
      {open && <button className="drawer-overlay" aria-label="設定を閉じる" onClick={onClose} />}
      <aside className={`setting-drawer ${open ? "open" : ""}`}>
        <div className="drawer-header">
          <h2>設定</h2>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        <button className="secondary-button full-width-button" disabled={captureLoading} onClick={onDownloadCalendarImage}>
          <Download size={16} />
          {captureLoading ? "画像を作成中" : "カレンダー画像を保存"}
        </button>
        <div className="field">
          <span>TaskCell表示優先順位</span>
          <div className="priority-sort-list">
            {taskCellPriority.map((item, index) => (
              <button
                type="button"
                className={`priority-sort-item ${draggedPriorityIndex === index ? "dragging" : ""}`}
                draggable
                key={item.id}
                onDragStart={(event) => {
                  setDraggedPriorityIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedPriorityIndex !== null) movePriorityItem(draggedPriorityIndex, index);
                  setDraggedPriorityIndex(null);
                }}
                onDragEnd={() => setDraggedPriorityIndex(null)}
              >
                <GripVertical size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-section">
          <div className="settings-section-head">
            <h3>タグ</h3>
            <button className="secondary-button" onClick={onAddTag}>
              <Plus size={16} />
              タグを追加
            </button>
          </div>
          {tags.map((tag) => (
            <div
              className="tag-editor-row"
              key={tag.id}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenTagContextMenu(tag, event.clientX, event.clientY);
              }}
            >
              <input
                className="tag-color-input"
                type="color"
                value={tag.color}
                aria-label={`${tag.name}の色`}
                onChange={(event) => onUpdateTag(tag.id, { color: event.target.value })}
              />
              <input
                value={tag.name}
                aria-label="タグ名"
                onChange={(event) => onUpdateTag(tag.id, { name: event.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="settings-section">
          <div className="settings-section-head">
            <h3>ゴミ箱</h3>
            <span className="settings-count-label">{trashSchedules.length}件</span>
          </div>
          {trashSchedules.length === 0 ? (
            <div className="empty-state compact">ゴミ箱は空です</div>
          ) : (
            <div className="settings-trash-list">
              {trashSchedules.map((schedule) => (
                <div className="settings-trash-item" key={schedule.id}>
                  <div>
                    <span>{formatScheduleDateRange(schedule)} {schedule.startTime} ~ {schedule.endTime}</span>
                    <strong>{schedule.siteName}</strong>
                    <small>{schedule.members.join("、") || "メンバー未指定"}</small>
                  </div>
                  <button className="secondary-button" onClick={() => onRestoreSchedule(schedule)}>復元</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function filterSchedulesByUi(
  schedules: Schedule[],
  role: UserRole,
  searchQuery: string,
  memberFilters: string[],
  tagFilters: string[],
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return schedules.filter((schedule) => {
    if (role === "User" && !schedule.members.includes(currentMember) && !schedule.isPersonal) return false;
    if (role === "Guest" && !schedule.members.includes(currentMember)) return false;
    if (memberFilters.length > 0 && !memberFilters.some((member) => schedule.members.includes(member))) return false;
    if (tagFilters.length > 0 && !tagFilters.some((tagColor) => getScheduleTagColors(schedule).includes(tagColor))) return false;
    if (!normalizedQuery) return true;

    return [
      schedule.siteName,
      schedule.content,
      schedule.date,
      schedule.endDate,
      schedule.startTime,
      schedule.endTime,
      schedule.members.join(" "),
      schedule.contractor,
      schedule.address,
      schedule.memo,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

function toggleListValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function getDefaultScheduleTimeRange(date: Date) {
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const nextHourMinutes = Math.floor(currentMinutes / 60 + 1) * 60;
  const startMinutes = nextHourMinutes >= 1440 ? 0 : nextHourMinutes;
  const endMinutes = startMinutes + 60;

  return {
    startTime: minutesToTime(startMinutes),
    endTime: minutesToTime(endMinutes),
  };
}

function getScheduleDurationMinutes(schedule: Schedule) {
  const startDate = dateKeyToDate(schedule.date);
  const endDate = dateKeyToDate(schedule.endDate ?? schedule.date);
  const dayDiff = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  const startMinutes = timeStringToMinutes(schedule.startTime);
  const endMinutes = timeStringToMinutes(schedule.endTime);
  return Math.max(30, dayDiff * 1440 + endMinutes - startMinutes);
}

function timeStringToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = dateKeyToDate(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function dateKeyToDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function createScheduleId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}

function normalizeScheduleDateRange(schedule: Schedule): Schedule {
  const endDate = schedule.endDate ?? schedule.date;
  return {
    ...schedule,
    endDate: endDate < schedule.date ? schedule.date : endDate,
  };
}

function formatScheduleDateRange(schedule: Schedule) {
  const endDate = schedule.endDate ?? schedule.date;
  return schedule.date === endDate ? schedule.date : `${schedule.date} ~ ${endDate}`;
}

function removeTagFromSchedule(schedule: Schedule, color: string): Schedule {
  const nextColors = getScheduleTagColors(schedule).filter((tagColor) => tagColor !== color);
  return {
    ...schedule,
    tagColors: nextColors,
    tagColor: nextColors[0] ?? "#3b82f6",
  };
}

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    const intervalId = window.setInterval(updateNow, 60 * 1000);
    updateNow();

    return () => window.clearInterval(intervalId);
  }, []);

  return now;
}
