import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Copy, PanelRightOpen, Plus, Search, Settings, SlidersHorizontal, Trash2 } from "lucide-react";
import { mockSchedules } from "./mock/mockSchedules";
import type { CalendarViewMode, LaidOutSchedule, Schedule, SidebarMode, Tag, UserRole } from "./types";
import { formatDateLabel, formatMonthTitle, getMonthGridDays, getWeekDays, minutesToTime, toDateKey } from "./utils/time";
import { layoutSchedulesForDay } from "./utils/layoutSchedules";

const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
const timeMarks = [0, 360, 720, 1080, 1440];
const fallbackMaxVisibleColumns = 3;
const currentMember = "佐藤";
const storageKey = "calender-schedules-v1";
const trashStorageKey = "calender-trash-v1";
const tagStorageKey = "calender-tags-v1";
const defaultTags: Tag[] = [
  { id: "blue", name: "通常", color: "#3b82f6" },
  { id: "green", name: "確認", color: "#22c55e" },
  { id: "orange", name: "注意", color: "#f97316" },
  { id: "red", name: "重要", color: "#ef4444" },
  { id: "purple", name: "夜間", color: "#a855f7" },
  { id: "teal", name: "調査", color: "#14b8a6" },
];

export default function App() {
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
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("edit");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [overlapList, setOverlapList] = useState<Schedule[]>([]);
  const [anchorDate, setAnchorDate] = useState(() => new Date("2026-05-11T09:00:00"));
  const [role, setRole] = useState<UserRole>("Admin");
  const [searchQuery, setSearchQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [maxVisibleColumns, setMaxVisibleColumns] = useState(fallbackMaxVisibleColumns);
  const now = useCurrentTime();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const weekDates = useMemo(() => getWeekDays(anchorDate), [anchorDate]);
  const monthDates = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);
  const selectedSchedule = schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null;
  const allMembers = useMemo(() => [...new Set(schedules.flatMap((schedule) => schedule.members))].sort(), [schedules]);
  const allTags = useMemo(() => tags, [tags]);
  const visibleSchedules = useMemo(
    () => filterSchedulesByUi(schedules, role, searchQuery, memberFilter, tagFilter),
    [schedules, role, searchQuery, memberFilter, tagFilter],
  );
  const unreadSchedules = useMemo(
    () => visibleSchedules.filter((schedule) => !schedule.readBy.includes(currentMember)),
    [visibleSchedules],
  );

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
    const dateKey = toDateKey(anchorDate);
    const schedule: Schedule = {
      id: createScheduleId(),
      siteName: "新規現場",
      content: "",
      date: dateKey,
      startTime: "09:00",
      endTime: "10:00",
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

  function moveAnchor(step: number) {
    setAnchorDate((current) => {
      const next = new Date(current);
      if (viewMode === "month") next.setMonth(next.getMonth() + step);
      if (viewMode === "week") next.setDate(next.getDate() + step * 7);
      if (viewMode === "day") next.setDate(next.getDate() + step);
      return next;
    });
  }

  function goToday() {
    setAnchorDate(new Date());
  }

  return (
    <div className="app-shell">
      <TopBar
        sidebarOpen={sidebarOpen}
        viewMode={viewMode}
        role={role}
        searchQuery={searchQuery}
        memberFilter={memberFilter}
        tagFilter={tagFilter}
        members={allMembers}
        tags={allTags}
        unreadCount={unreadSchedules.length}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onOpenSetting={() => setSettingOpen(true)}
        onOpenNotifications={() => setNotificationOpen((value) => !value)}
        onViewModeChange={setViewMode}
        onRoleChange={setRole}
        onSearchQueryChange={setSearchQuery}
        onMemberFilterChange={setMemberFilter}
        onTagFilterChange={setTagFilter}
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
            onSelectSchedule={openSchedule}
            onOpenHiddenList={openOverlapList}
          />
        ) : viewMode === "day" ? (
          <CalendarDayDesktop
            date={anchorDate}
            schedules={visibleSchedules}
            maxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
          />
        ) : (
          <CalendarWeekDesktop
            weekDates={weekDates}
            schedules={visibleSchedules}
            maxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
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
          onModeChange={setSidebarMode}
          onSelectSchedule={openSchedule}
          onSaveSchedule={saveSchedule}
          onDeleteSchedule={deleteSchedule}
          onDuplicateSchedule={duplicateSchedule}
          onMarkAsRead={markSelectedAsRead}
          onRestoreSchedule={restoreSchedule}
          onAddTag={addTag}
          onStartResize={startSidebarResize}
        />
      </main>
      <SettingDrawer
        open={settingOpen}
        maxVisibleColumns={maxVisibleColumns}
        tags={tags}
        onMaxVisibleColumnsChange={setMaxVisibleColumns}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onOpenTrash={openTrash}
        onClose={() => setSettingOpen(false)}
      />
    </div>
  );
}

type TopBarProps = {
  sidebarOpen: boolean;
  viewMode: CalendarViewMode;
  role: UserRole;
  searchQuery: string;
  memberFilter: string;
  tagFilter: string;
  members: string[];
  tags: Tag[];
  unreadCount: number;
  onToggleSidebar: () => void;
  onOpenSetting: () => void;
  onOpenNotifications: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onRoleChange: (role: UserRole) => void;
  onSearchQueryChange: (query: string) => void;
  onMemberFilterChange: (member: string) => void;
  onTagFilterChange: (tag: string) => void;
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
  memberFilter,
  tagFilter,
  members,
  tags,
  unreadCount,
  onToggleSidebar,
  onOpenSetting,
  onOpenNotifications,
  onViewModeChange,
  onRoleChange,
  onSearchQueryChange,
  onMemberFilterChange,
  onTagFilterChange,
  onCreateNew,
  onToday,
  onPrevious,
  onNext,
}: TopBarProps) {
  const selectedTag = tags.find((tag) => tag.color === tagFilter);

  return (
    <header className="topbar">
      <div className="topbar-group">
        <label className="search-box">
          <Search size={16} />
          <input value={searchQuery} placeholder="検索" onChange={(event) => onSearchQueryChange(event.target.value)} />
        </label>
        <label className="compact-select filter-select">
          <SlidersHorizontal size={15} />
          <select value={memberFilter} onChange={(event) => onMemberFilterChange(event.target.value)}>
            <option value="all">全メンバー</option>
            {members.map((member) => (
              <option value={member} key={member}>{member}</option>
            ))}
          </select>
        </label>
        <label className="compact-select tag-select">
          <span className="tag-preview-dot" style={{ background: selectedTag?.color ?? "#94a3b8" }} />
          <select value={tagFilter} onChange={(event) => onTagFilterChange(event.target.value)}>
            <option value="all">全タグ</option>
            {tags.map((tag) => (
              <option value={tag.color} key={tag.id}>{tag.name}</option>
            ))}
          </select>
        </label>
        <button className="icon-button" aria-label="設定" onClick={onOpenSetting}>
          <Settings size={18} />
        </button>
        <button className="icon-button notification-button" aria-label="通知" onClick={onOpenNotifications}>
          <Bell size={18} />
          {unreadCount > 0 && <span className="notification-dot" />}
        </button>
        <button className="primary-button" disabled={role !== "Admin"} onClick={onCreateNew}>
          <Plus size={16} />
          新規作成
        </button>
      </div>
      <div className="topbar-group">
        <label className="compact-select role-select">
          <select value={role} onChange={(event) => onRoleChange(event.target.value as UserRole)}>
            <option value="Admin">Admin</option>
            <option value="User">User</option>
            <option value="Guest">Guest</option>
          </select>
        </label>
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
          今日
        </button>
        <button className="icon-button" aria-label="前へ" onClick={onPrevious}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-button" aria-label="次へ" onClick={onNext}>
          <ChevronRight size={18} />
        </button>
      </div>
    </header>
  );
}

type CalendarMonthDesktopProps = {
  anchorDate: Date;
  monthDates: Date[];
  schedules: Schedule[];
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenHiddenList: (schedules: Schedule[]) => void;
};

function CalendarMonthDesktop({ anchorDate, monthDates, schedules, onSelectSchedule, onOpenHiddenList }: CalendarMonthDesktopProps) {
  const todayKey = toDateKey(new Date());
  const anchorMonth = anchorDate.getMonth();

  return (
    <section className="calendar-panel" aria-label="月表示カレンダー">
      <div className="month-title-row">
        <h1>{formatMonthTitle(anchorDate)}</h1>
      </div>
      <div className="month-weekday-header">
        {weekDays.map((day) => (
          <div className="month-weekday-cell" key={day}>{day}</div>
        ))}
      </div>
      <div className="month-grid">
        {monthDates.map((date) => {
          const dateKey = toDateKey(date);
          const daySchedules = schedules
            .filter((schedule) => schedule.date === dateKey)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          const visibleSchedules = daySchedules.slice(0, 3);
          const hiddenSchedules = daySchedules.slice(3);
          const isToday = dateKey === todayKey;
          const isOutsideMonth = date.getMonth() !== anchorMonth;

          return (
            <div className={`month-day-cell ${isToday ? "today" : ""} ${isOutsideMonth ? "outside-month" : ""}`} key={dateKey}>
              <div className="month-day-head">
                <span className="month-date-pill">{date.getDate()}</span>
              </div>
              <div className="month-task-list">
                {visibleSchedules.map((schedule) => (
                  <button
                    className="month-task-chip"
                    style={{ borderLeftColor: getPrimaryTagColor(schedule) }}
                    key={schedule.id}
                    onClick={() => onSelectSchedule(schedule)}
                  >
                    <strong>{schedule.startTime}</strong>
                    <span>{schedule.siteName}</span>
                  </button>
                ))}
                {hiddenSchedules.length > 0 && (
                  <button className="month-hidden-count" onClick={() => onOpenHiddenList(hiddenSchedules)}>
                    +{hiddenSchedules.length}件
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type CalendarWeekDesktopProps = {
  weekDates: Date[];
  schedules: Schedule[];
  maxVisibleColumns: number;
  currentMinute: number;
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenOverlapList: (schedules: Schedule[]) => void;
};

function CalendarWeekDesktop({ weekDates, schedules, maxVisibleColumns, currentMinute, onSelectSchedule, onOpenOverlapList }: CalendarWeekDesktopProps) {
  const currentTop = (currentMinute / 1440) * 100;
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];

  return (
    <section className="calendar-panel" aria-label="週表示カレンダー">
      <CalendarTitle
        title={`${weekStart.getFullYear()}年 ${formatDateLabel(weekStart)} - ${formatDateLabel(weekEnd)}`}
      />
      <WeekHeader weekDates={weekDates} />
      <div className="week-scroll-area">
        <TimeAxis currentMinute={currentMinute} />
        <div className="week-grid">
          {timeMarks.map((minute) => (
            <div className="time-guide" style={{ top: `${(minute / 1440) * 100}%` }} key={minute} />
          ))}
          <div className="current-time-line" style={{ top: `${currentTop}%` }} />
          {weekDates.map((date) => {
            const dateKey = toDateKey(date);
            const daySchedules = schedules.filter((schedule) => schedule.date === dateKey);
            const laidOut = layoutSchedulesForDay(daySchedules, maxVisibleColumns);
            const hiddenByGroup = groupHiddenSchedules(laidOut);

            return (
              <div className="day-column" key={dateKey}>
                {laidOut
                  .filter((item) => !item.hidden)
                  .map((item) => (
                    <TaskCell key={item.schedule.id} item={item} onClick={() => onSelectSchedule(item.schedule)} />
                  ))}
                {hiddenByGroup.map((group) => (
                  <button
                    className="hidden-count"
                    style={{ top: `${group.topPercent}%` }}
                    key={group.groupId}
                    onClick={() => onOpenOverlapList(group.schedules)}
                  >
                    +{group.schedules.length}件
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

type CalendarDayDesktopProps = {
  date: Date;
  schedules: Schedule[];
  maxVisibleColumns: number;
  currentMinute: number;
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenOverlapList: (schedules: Schedule[]) => void;
};

function CalendarDayDesktop({ date, schedules, maxVisibleColumns, currentMinute, onSelectSchedule, onOpenOverlapList }: CalendarDayDesktopProps) {
  const currentTop = (currentMinute / 1440) * 100;
  const dateKey = toDateKey(date);
  const daySchedules = schedules.filter((schedule) => schedule.date === dateKey);
  const laidOut = layoutSchedulesForDay(daySchedules, maxVisibleColumns);
  const hiddenByGroup = groupHiddenSchedules(laidOut);

  return (
    <section className="calendar-panel" aria-label="日表示カレンダー">
      <CalendarTitle title={`${date.getFullYear()}年 ${formatDateLabel(date)}`} />
      <WeekHeader weekDates={[date]} className="day-header" />
      <div className="week-scroll-area day-view-area">
        <TimeAxis currentMinute={currentMinute} />
        <div className="week-grid day-grid">
          {timeMarks.map((minute) => (
            <div className="time-guide" style={{ top: `${(minute / 1440) * 100}%` }} key={minute} />
          ))}
          <div className="current-time-line" style={{ top: `${currentTop}%` }} />
          <div className="day-column day-view-column">
            {laidOut
              .filter((item) => !item.hidden)
              .map((item) => (
                <TaskCell key={item.schedule.id} item={item} onClick={() => onSelectSchedule(item.schedule)} />
              ))}
            {hiddenByGroup.map((group) => (
              <button
                className="hidden-count"
                style={{ top: `${group.topPercent}%` }}
                key={group.groupId}
                onClick={() => onOpenOverlapList(group.schedules)}
              >
                +{group.schedules.length}件
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CalendarTitle({ title }: { title: string }) {
  return (
    <div className="calendar-title-row">
      <h1>{title}</h1>
    </div>
  );
}

function WeekHeader({ weekDates, className = "" }: { weekDates: Date[]; className?: string }) {
  const todayKey = toDateKey(new Date());

  return (
    <div className={`week-header ${className}`}>
      <div className="time-axis-spacer" />
      {weekDates.map((date) => {
        const dateKey = toDateKey(date);
        const isToday = dateKey === todayKey;

        return (
          <div className={`week-day-cell ${isToday ? "today" : ""}`} key={dateKey}>
            <span className="week-day-label">
              <span className="date-label">{formatDateLabel(date)}</span>
              <span className="weekday-label">{weekDays[date.getDay()]}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TimeAxis({ currentMinute }: { currentMinute: number }) {
  return (
    <div className="time-axis">
      {timeMarks.map((minute) => (
        <span className={`time-mark ${minute === 0 ? "start" : ""} ${minute === 1440 ? "end" : ""}`} style={{ top: `${(minute / 1440) * 100}%` }} key={minute}>
          {minutesToTime(minute)}
        </span>
      ))}
      <span className="current-time-chip" style={{ top: `${(currentMinute / 1440) * 100}%` }}>
        {minutesToTime(currentMinute)}
      </span>
    </div>
  );
}

function TaskCell({ item, onClick }: { item: LaidOutSchedule; onClick: () => void }) {
  const width = `calc(${100 / item.columnCount}% - 6px)`;
  const left = `calc(${(100 / item.columnCount) * item.columnIndex}% + 3px)`;
  const showMore = item.heightPercent > 8;
  const showFull = item.heightPercent > 14;

  return (
    <button
      className="task-cell"
      style={{
        top: `${item.topPercent}%`,
        height: `${item.heightPercent}%`,
        width,
        left,
        borderLeftColor: getPrimaryTagColor(item.schedule),
      }}
      onClick={onClick}
    >
      <strong>
        {item.schedule.startTime} ~ {item.schedule.endTime}
      </strong>
      <span>{item.schedule.siteName}</span>
      {showMore && <span>{item.schedule.members.join("、")}</span>}
      {showFull && <span>{item.schedule.contractor}</span>}
      {showFull && <span>{item.schedule.address}</span>}
    </button>
  );
}

function groupHiddenSchedules(items: LaidOutSchedule[]) {
  const groups = new Map<string, LaidOutSchedule[]>();
  for (const item of items) {
    if (!item.hidden) continue;
    groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
  }

  return [...groups.entries()].map(([groupId, groupItems]) => ({
    groupId,
    schedules: groupItems.map((item) => item.schedule),
    topPercent: Math.min(...groupItems.map((item) => item.topPercent)),
  }));
}

type SideBarProps = {
  open: boolean;
  role: UserRole;
  mode: SidebarMode;
  selectedSchedule: Schedule | null;
  overlapList: Schedule[];
  trashSchedules: Schedule[];
  tags: Tag[];
  onModeChange: (mode: SidebarMode) => void;
  onSelectSchedule: (schedule: Schedule) => void;
  onSaveSchedule: (schedule: Schedule) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onDuplicateSchedule: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
  onRestoreSchedule: (schedule: Schedule) => void;
  onAddTag: () => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

function SideBar({
  open,
  role,
  mode,
  selectedSchedule,
  overlapList,
  trashSchedules,
  tags,
  onModeChange,
  onSelectSchedule,
  onSaveSchedule,
  onDeleteSchedule,
  onDuplicateSchedule,
  onMarkAsRead,
  onRestoreSchedule,
  onAddTag,
  onStartResize,
}: SideBarProps) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <button className="sidebar-resize-handle" aria-label="サイドバー幅変更" onPointerDown={onStartResize} />
      <div className="sidebar-header">
        <div>
          <p>{role}</p>
          <h2>{role === "Admin" ? "編集サイドバー" : role === "User" ? "自分の予定" : "共有予定"}</h2>
        </div>
        <div className="mode-tabs">
          {role === "Admin" && <button className={mode === "edit" ? "active" : ""} onClick={() => onModeChange("edit")}>編集</button>}
          <button className={mode === "detail" ? "active" : ""} onClick={() => onModeChange("detail")}>詳細</button>
          <button className={mode === "overlapList" ? "active" : ""} onClick={() => onModeChange("overlapList")}>一覧</button>
          <button className={mode === "trash" ? "active" : ""} onClick={() => onModeChange("trash")}>ゴミ箱</button>
        </div>
      </div>
      {mode === "trash" ? (
        <TrashList schedules={trashSchedules} onRestoreSchedule={onRestoreSchedule} />
      ) : mode === "overlapList" ? (
        <OverlapTaskList schedules={overlapList} onSelectSchedule={onSelectSchedule} />
      ) : selectedSchedule ? (
        mode === "edit" && role === "Admin" ? (
          <ScheduleEditor
            schedule={selectedSchedule}
            role={role}
            tags={tags}
            onAddTag={onAddTag}
            onSave={onSaveSchedule}
            onDelete={onDeleteSchedule}
            onDuplicate={onDuplicateSchedule}
            onMarkAsRead={onMarkAsRead}
          />
        ) : (
          <ScheduleDetail schedule={selectedSchedule} role={role} onMarkAsRead={onMarkAsRead} />
        )
      ) : (
        <div className="empty-state">タスクを選択してください</div>
      )}
    </aside>
  );
}

function ScheduleEditor({
  schedule,
  role,
  tags,
  onAddTag,
  onSave,
  onDelete,
  onDuplicate,
  onMarkAsRead,
}: {
  schedule: Schedule;
  role: UserRole;
  tags: Tag[];
  onAddTag: () => void;
  onSave: (schedule: Schedule) => void;
  onDelete: (scheduleId: string) => void;
  onDuplicate: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
}) {
  const [draft, setDraft] = useState(schedule);
  const canEdit = role === "Admin";
  const isDirty = JSON.stringify(draft) !== JSON.stringify(schedule);

  useEffect(() => {
    setDraft(schedule);
  }, [schedule]);

  function updateDraft(field: keyof Schedule, value: string | string[] | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleTag(color: string) {
    setDraft((current) => {
      const currentColors = getScheduleTagColors(current);
      const nextColors = currentColors.includes(color)
        ? currentColors.filter((tagColor) => tagColor !== color)
        : [...currentColors, color];
      const fallbackColor = nextColors[0] ?? tags[0]?.color ?? "#3b82f6";

      return {
        ...current,
        tagColor: fallbackColor,
        tagColors: nextColors,
      };
    });
  }

  return (
    <form className="editor-body" onSubmit={(event) => event.preventDefault()}>
      <Field label="現場名" value={draft.siteName} disabled={!canEdit} onChange={(value) => updateDraft("siteName", value)} />
      <Field label="内容" value={draft.content} disabled={!canEdit} onChange={(value) => updateDraft("content", value)} />
      <Field label="日付" value={draft.date} disabled={!canEdit} onChange={(value) => updateDraft("date", value)} />
      <div className="field-row">
        <Field label="開始予定時間" value={draft.startTime} disabled={!canEdit} onChange={(value) => updateDraft("startTime", value)} />
        <Field label="終了予定時間" value={draft.endTime} disabled={!canEdit} onChange={(value) => updateDraft("endTime", value)} />
      </div>
      <Field label="メンバー" value={draft.members.join("、")} disabled={!canEdit} onChange={(value) => updateDraft("members", splitMembers(value))} />
      <Field label="元請け業者" value={draft.contractor} disabled={!canEdit} onChange={(value) => updateDraft("contractor", value)} />
      <Field label="住所" value={draft.address} disabled={!canEdit} onChange={(value) => updateDraft("address", value)} />
      <div className="field">
        <span className="field-label-row">
          タグ
          <button type="button" className="inline-add-button" disabled={!canEdit} onClick={onAddTag}>
            <Plus size={14} />
            追加
          </button>
        </span>
        <div className="tag-multi-select" aria-label="タグ選択">
          {tags.map((tag) => {
            const selected = getScheduleTagColors(draft).includes(tag.color);

            return (
              <label className={`tag-choice ${selected ? "selected" : ""}`} key={tag.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!canEdit}
                  onChange={() => toggleTag(tag.color)}
                />
                <span className="tag-preview-dot" style={{ background: tag.color }} />
                <span>{tag.name}</span>
              </label>
            );
          })}
        </div>
      </div>
      <label className="field">
        <span>メモ</span>
        <textarea value={draft.memo} disabled={!canEdit} rows={5} onChange={(event) => updateDraft("memo", event.target.value)} />
      </label>
      <ReadStatus schedule={draft} />
      <div className="sidebar-actions">
        {isDirty ? (
          <button type="button" className="secondary-button" onClick={() => setDraft(schedule)}>キャンセル</button>
        ) : (
          <button type="button" className="danger-button" disabled={!canEdit} onClick={() => onDelete(draft.id)}>
            <Trash2 size={16} />
            削除
          </button>
        )}
        <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => onDuplicate(draft)}>
          <Copy size={16} />
          複製
        </button>
        <button type="button" className="secondary-button" onClick={onMarkAsRead}>既読</button>
        <button type="button" className="primary-button" disabled={!canEdit} onClick={() => onSave(draft)}>保存</button>
      </div>
    </form>
  );
}

function Field({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ScheduleDetail({ schedule, role, onMarkAsRead }: { schedule: Schedule; role: UserRole; onMarkAsRead: () => void }) {
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

function ReadStatus({ schedule }: { schedule: Schedule }) {
  return (
    <div className="read-status">
      <strong>既読状況</strong>
      <span>{schedule.readBy.length > 0 ? schedule.readBy.join("、") : "未読"}</span>
    </div>
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

function TrashList({ schedules, onRestoreSchedule }: { schedules: Schedule[]; onRestoreSchedule: (schedule: Schedule) => void }) {
  return (
    <div className="overlap-list">
      <p className="list-note">削除したタスク</p>
      {schedules.length === 0 ? (
        <div className="empty-state">ゴミ箱は空です</div>
      ) : (
        schedules.map((schedule) => (
          <div className="trash-item" key={schedule.id}>
            <div>
              <span>{schedule.date} {schedule.startTime} ~ {schedule.endTime}</span>
              <strong>{schedule.siteName}</strong>
              <small>{schedule.members.join("、") || "メンバー未指定"}</small>
            </div>
            <button className="secondary-button" onClick={() => onRestoreSchedule(schedule)}>復元</button>
          </div>
        ))
      )}
    </div>
  );
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

function SettingDrawer({
  open,
  maxVisibleColumns,
  tags,
  onMaxVisibleColumnsChange,
  onAddTag,
  onUpdateTag,
  onOpenTrash,
  onClose,
}: {
  open: boolean;
  maxVisibleColumns: number;
  tags: Tag[];
  onMaxVisibleColumnsChange: (columns: number) => void;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onOpenTrash: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {open && <button className="drawer-overlay" aria-label="設定を閉じる" onClick={onClose} />}
      <aside className={`setting-drawer ${open ? "open" : ""}`}>
        <div className="drawer-header">
          <h2>設定</h2>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        <label className="field">
          <span>TaskCell最大表示列数</span>
          <input
            type="number"
            min="1"
            max="8"
            value={maxVisibleColumns}
            onChange={(event) => onMaxVisibleColumnsChange(Math.max(1, Number(event.target.value)))}
          />
        </label>
        <label className="field">
          <span>TaskCell表示優先順位</span>
          <textarea defaultValue={"開始予定時間\n現場名\nメンバー\n元請け業者\n住所\nメモ"} rows={7} />
        </label>
        <div className="settings-section">
          <div className="settings-section-head">
            <h3>タグ</h3>
            <button className="secondary-button" onClick={onAddTag}>
              <Plus size={16} />
              タグを追加
            </button>
          </div>
          {tags.map((tag) => (
            <div className="tag-editor-row" key={tag.id}>
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
  memberFilter: string,
  tagFilter: string,
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return schedules.filter((schedule) => {
    if (role === "User" && !schedule.members.includes(currentMember) && !schedule.isPersonal) return false;
    if (role === "Guest" && !schedule.members.includes(currentMember)) return false;
    if (memberFilter !== "all" && !schedule.members.includes(memberFilter)) return false;
    if (tagFilter !== "all" && !getScheduleTagColors(schedule).includes(tagFilter)) return false;
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

function splitMembers(value: string) {
  return value
    .split(/[、,\s]+/)
    .map((member) => member.trim())
    .filter(Boolean);
}

function createScheduleId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}

function getPrimaryTagColor(schedule: Schedule) {
  return getScheduleTagColors(schedule)[0] ?? "#3b82f6";
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
