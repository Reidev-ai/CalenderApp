import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toPng } from "html-to-image";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Download, GripVertical, Menu, PanelRightOpen, Plus, Search, Settings, SlidersHorizontal, Trash2 } from "lucide-react";
import { mockSchedules } from "./mock/mockSchedules";
import type { AuthSession, CalendarViewMode, JoinRequest, Schedule, SidebarMode, Tag, TaskCellPriorityItem, UserRole } from "./types";
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
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupMembersError, setGroupMembersError] = useState("");
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
  }, [authSession?.user.groupId]);

  async function refreshGroupMembers(groupId: string) {
    setGroupMembersError("");
    const fallbackMembers = authSession?.user.name ? [authSession.user.name] : [];
    setGroupMembers((current) => mergeMemberNames(fallbackMembers, current));

    try {
      const payload = await getApiJson<{ users: AuthSession["user"][] }>(`/api/groups/${encodeURIComponent(groupId)}/members`);
      setGroupMembers(mergeMemberNames(fallbackMembers, payload.users.map((user) => user.name)));
    } catch (error) {
      try {
        const payload = await getApiJson<{ joinRequests: JoinRequest[] }>(`/api/join-requests?groupId=${encodeURIComponent(groupId)}`);
        const approvedMembers = payload.joinRequests
          .filter((request) => request.status === "approved")
          .map((request) => request.user?.name)
          .filter((name): name is string => Boolean(name));
        setGroupMembers(mergeMemberNames(fallbackMembers, approvedMembers));
        setGroupMembersError("");
      } catch {
        setGroupMembers((current) => mergeMemberNames(fallbackMembers, current));
        setGroupMembersError(error instanceof Error ? error.message : "グループメンバーを取得できませんでした");
      }
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

  function openSchedule(schedule: Schedule) {
    setSelectedScheduleId(schedule.id);
    setSidebarMode(role === "Admin" ? "edit" : "detail");
    setSidebarOpen(true);
  }

  function openOverlapList(schedules: Schedule[]) {
    setOverlapList(schedules);
    setSidebarMode("overlapList");
    setSidebarOpen(true);
  }

  function saveSchedule(schedule: Schedule) {
    setSchedules((current) => {
      const exists = current.some((item) => item.id === schedule.id);
      return exists ? current.map((item) => (item.id === schedule.id ? schedule : item)) : [...current, schedule];
    });
    setSelectedScheduleId(schedule.id);
    setSidebarMode("edit");
  }

  function deleteSchedule(scheduleId: string) {
    const target = schedules.find((schedule) => schedule.id === scheduleId);
    if (!target || !confirm("このタスクをゴミ箱に移動しますか？")) return;
    setSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
    setTrashSchedules((current) => [target, ...current]);
    setSelectedScheduleId(null);
  }

  function restoreSchedule(schedule: Schedule) {
    setTrashSchedules((current) => current.filter((item) => item.id !== schedule.id));
    saveSchedule(schedule);
  }

  function duplicateSchedule(schedule: Schedule) {
    const duplicated = {
      ...schedule,
      id: createScheduleId(),
      siteName: `${schedule.siteName} コピー`,
      readBy: [],
    };
    saveSchedule(duplicated);
  }

  function createNewSchedule() {
    if (role !== "Admin") return;
    const dateKey = selectedDateKey ?? toDateKey(new Date());
    const { startTime, endTime } = getDefaultScheduleTimeRange(new Date());
    const schedule: Schedule = {
      id: createScheduleId(),
      siteName: "新規現場",
      content: "",
      date: dateKey,
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
    saveSchedule(schedule);
    setSidebarOpen(true);
  }

  function markSelectedAsRead() {
    if (!selectedSchedule) return;
    saveSchedule({
      ...selectedSchedule,
      readBy: selectedSchedule.readBy.includes(currentMember)
        ? selectedSchedule.readBy
        : [...selectedSchedule.readBy, currentMember],
    });
  }

  function openTrash() {
    setSettingOpen(false);
    setSidebarMode("trash");
    setSidebarOpen(true);
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

  function addTag() {
    setTags((current) => [
      ...current,
      { id: createScheduleId(), name: "新しいタグ", color: "#64748b" },
    ]);
  }

  function updateTag(tagId: string, patch: Partial<Tag>) {
    setTags((current) => current.map((tag) => (tag.id === tagId ? { ...tag, ...patch } : tag)));
  }

  function openTagContextMenu(tag: Tag, x: number, y: number) {
    setTagContextMenu({ tag, x, y });
  }

  function deleteTag(tag: Tag) {
    setTags((current) => current.filter((item) => item.id !== tag.id));
    setSchedules((current) => current.map((schedule) => removeTagFromSchedule(schedule, tag.color)));
    setTrashSchedules((current) => current.map((schedule) => removeTagFromSchedule(schedule, tag.color)));
    setTagFilters((current) => current.filter((color) => color !== tag.color));
    setTagContextMenu(null);
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

  return (
    <div className="app-shell">
      <TopBar
        sidebarOpen={sidebarOpen}
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
        groupMembersError={groupMembersError}
        onGroupMembersRefresh={() => refreshGroupMembers(authSession.user.groupId)}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
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
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
          />
        ) : (
          <CalendarWeekDesktop
            weekDates={weekDates}
            schedules={visibleSchedules}
            fallbackMaxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
            role={role}
            taskCellPriority={taskCellPriority}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
          />
        )}
        <SideBar
          open={sidebarOpen}
          role={role}
          mode={sidebarMode}
          selectedSchedule={selectedSchedule}
          overlapList={overlapList}
          trashSchedules={trashSchedules}
          tags={tags}
          groupMembers={groupMembers}
          groupMembersError={groupMembersError}
          onModeChange={setSidebarMode}
          onSelectSchedule={openSchedule}
          onSaveSchedule={saveSchedule}
          onDeleteSchedule={deleteSchedule}
          onDuplicateSchedule={duplicateSchedule}
          onMarkAsRead={markSelectedAsRead}
          onRestoreSchedule={restoreSchedule}
          onAddTag={addTag}
          onOpenTagContextMenu={openTagContextMenu}
          onStartResize={startSidebarResize}
        />
      </main>
      <SettingDrawer
        open={settingOpen}
        tags={tags}
        taskCellPriority={taskCellPriority}
        captureLoading={captureLoading}
        onDownloadCalendarImage={downloadCalendarImage}
        onTaskCellPriorityChange={setTaskCellPriority}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onOpenTrash={openTrash}
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
  sidebarOpen: boolean;
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
  groupMembersError: string;
  onGroupMembersRefresh: () => void;
  onToggleSidebar: () => void;
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
  sidebarOpen,
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
  groupMembersError,
  onGroupMembersRefresh,
  onToggleSidebar,
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
        <button className="icon-button" aria-label={sidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"} onClick={onToggleSidebar}>
          <PanelRightOpen size={18} />
        </button>
        <div className="segmented-control" aria-label="表示切替">
          <button className={viewMode === "month" ? "active" : ""} onClick={() => onViewModeChange("month")}>月</button>
          <button className={viewMode === "week" ? "active" : ""} onClick={() => onViewModeChange("week")}>週</button>
          <button className={viewMode === "day" ? "active" : ""} onClick={() => onViewModeChange("day")}>日</button>
        </div>
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
                {groupMembers.length === 0 ? (
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
              <button
                className="secondary-button full-width-button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLogout();
                }}
              >
                ログアウト
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

async function postApiJson<T>(path: string): Promise<T> {
  return requestApiJson<T>(path, { method: "POST" });
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
  captureLoading,
  onDownloadCalendarImage,
  onTaskCellPriorityChange,
  onAddTag,
  onUpdateTag,
  onOpenTrash,
  onOpenTagContextMenu,
  onClose,
}: {
  open: boolean;
  tags: Tag[];
  taskCellPriority: TaskCellPriorityItem[];
  captureLoading: boolean;
  onDownloadCalendarImage: () => void;
  onTaskCellPriorityChange: (priority: TaskCellPriorityItem[]) => void;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onOpenTrash: () => void;
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
        <button className="secondary-button full-width-button" onClick={onOpenTrash}>
          <Trash2 size={16} />
          ゴミ箱を開く
        </button>
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

function dateKeyToDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function createScheduleId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
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
