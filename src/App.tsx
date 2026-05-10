import { useMemo, useState } from "react";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Copy, PanelRightOpen, Plus, Search, Settings, SlidersHorizontal } from "lucide-react";
import { mockSchedules } from "./mock/mockSchedules";
import type { CalendarViewMode, LaidOutSchedule, Schedule, SidebarMode } from "./types";
import { formatDateLabel, formatMonthTitle, getMonthGridDays, getWeekDays, minutesToTime, toDateKey } from "./utils/time";
import { layoutSchedulesForDay } from "./utils/layoutSchedules";

const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
const timeMarks = [0, 360, 720, 1080, 1440];
const maxVisibleColumns = 3;

export default function App() {
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(mockSchedules[0]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingOpen, setSettingOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("edit");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [overlapList, setOverlapList] = useState<Schedule[]>([]);
  const anchorDate = useMemo(() => new Date("2026-05-11T09:00:00"), []);
  const weekDates = useMemo(() => getWeekDays(anchorDate), [anchorDate]);
  const monthDates = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);

  function openSchedule(schedule: Schedule) {
    setSelectedSchedule(schedule);
    setSidebarMode("edit");
    setSidebarOpen(true);
  }

  function openOverlapList(schedules: Schedule[]) {
    setOverlapList(schedules);
    setSidebarMode("overlapList");
    setSidebarOpen(true);
  }

  return (
    <div className="app-shell">
      <TopBar
        sidebarOpen={sidebarOpen}
        viewMode={viewMode}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onOpenSetting={() => setSettingOpen(true)}
        onViewModeChange={setViewMode}
      />
      <main className="workspace">
        {viewMode === "month" ? (
          <CalendarMonthDesktop
            anchorDate={anchorDate}
            monthDates={monthDates}
            schedules={mockSchedules}
            onSelectSchedule={openSchedule}
            onOpenHiddenList={openOverlapList}
          />
        ) : viewMode === "day" ? (
          <CalendarDayDesktop
            date={anchorDate}
            schedules={mockSchedules}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
          />
        ) : (
          <CalendarWeekDesktop
            weekDates={weekDates}
            schedules={mockSchedules}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
          />
        )}
        <SideBar
          open={sidebarOpen}
          mode={sidebarMode}
          selectedSchedule={selectedSchedule}
          overlapList={overlapList}
          onModeChange={setSidebarMode}
          onSelectSchedule={openSchedule}
        />
      </main>
      <SettingDrawer open={settingOpen} onClose={() => setSettingOpen(false)} />
    </div>
  );
}

type TopBarProps = {
  sidebarOpen: boolean;
  viewMode: CalendarViewMode;
  onToggleSidebar: () => void;
  onOpenSetting: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
};

function TopBar({ sidebarOpen, viewMode, onToggleSidebar, onOpenSetting, onViewModeChange }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-group">
        <label className="search-box">
          <Search size={16} />
          <input placeholder="検索" />
        </label>
        <button className="icon-button" aria-label="フィルター">
          <SlidersHorizontal size={18} />
        </button>
        <button className="icon-button" aria-label="設定" onClick={onOpenSetting}>
          <Settings size={18} />
        </button>
        <button className="icon-button notification-button" aria-label="通知">
          <Bell size={18} />
          <span className="notification-dot" />
        </button>
        <button className="primary-button">
          <Plus size={16} />
          新規作成
        </button>
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
        <button className="secondary-button">
          <CalendarDays size={16} />
          今日
        </button>
        <button className="icon-button" aria-label="前の週">
          <ChevronLeft size={18} />
        </button>
        <button className="icon-button" aria-label="次の週">
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
        <span>月表示</span>
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
                    style={{ borderLeftColor: schedule.tagColor }}
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
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenOverlapList: (schedules: Schedule[]) => void;
};

function CalendarWeekDesktop({ weekDates, schedules, onSelectSchedule, onOpenOverlapList }: CalendarWeekDesktopProps) {
  const currentMinute = 9 * 60 + 45;
  const currentTop = (currentMinute / 1440) * 100;

  return (
    <section className="calendar-panel" aria-label="週表示カレンダー">
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
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenOverlapList: (schedules: Schedule[]) => void;
};

function CalendarDayDesktop({ date, schedules, onSelectSchedule, onOpenOverlapList }: CalendarDayDesktopProps) {
  const currentMinute = 9 * 60 + 45;
  const currentTop = (currentMinute / 1440) * 100;
  const dateKey = toDateKey(date);
  const daySchedules = schedules.filter((schedule) => schedule.date === dateKey);
  const laidOut = layoutSchedulesForDay(daySchedules, maxVisibleColumns);
  const hiddenByGroup = groupHiddenSchedules(laidOut);

  return (
    <section className="calendar-panel" aria-label="日表示カレンダー">
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
        borderLeftColor: item.schedule.tagColor,
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
  mode: SidebarMode;
  selectedSchedule: Schedule | null;
  overlapList: Schedule[];
  onModeChange: (mode: SidebarMode) => void;
  onSelectSchedule: (schedule: Schedule) => void;
};

function SideBar({ open, mode, selectedSchedule, overlapList, onModeChange, onSelectSchedule }: SideBarProps) {
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-header">
        <div>
          <p>Admin</p>
          <h2>編集サイドバー</h2>
        </div>
        <div className="mode-tabs">
          <button className={mode === "edit" ? "active" : ""} onClick={() => onModeChange("edit")}>編集</button>
          <button className={mode === "detail" ? "active" : ""} onClick={() => onModeChange("detail")}>詳細</button>
          <button className={mode === "overlapList" ? "active" : ""} onClick={() => onModeChange("overlapList")}>一覧</button>
        </div>
      </div>
      {mode === "overlapList" ? (
        <OverlapTaskList schedules={overlapList} onSelectSchedule={onSelectSchedule} />
      ) : selectedSchedule ? (
        mode === "edit" ? <ScheduleEditor schedule={selectedSchedule} /> : <ScheduleDetail schedule={selectedSchedule} />
      ) : (
        <div className="empty-state">タスクを選択してください</div>
      )}
    </aside>
  );
}

function ScheduleEditor({ schedule }: { schedule: Schedule }) {
  return (
    <form className="editor-body">
      <Field label="現場名" value={schedule.siteName} />
      <Field label="内容" value={schedule.content} />
      <Field label="日付" value={schedule.date} />
      <div className="field-row">
        <Field label="開始予定時間" value={schedule.startTime} />
        <Field label="終了予定時間" value={schedule.endTime} />
      </div>
      <Field label="メンバー" value={schedule.members.join("、")} />
      <Field label="元請け業者" value={schedule.contractor} />
      <Field label="住所" value={schedule.address} />
      <label className="field">
        <span>メモ</span>
        <textarea defaultValue={schedule.memo} rows={5} />
      </label>
      <div className="sidebar-actions">
        <button type="button" className="secondary-button">キャンセル</button>
        <button type="button" className="secondary-button">
          <Copy size={16} />
          複製
        </button>
        <button type="button" className="danger-button">削除</button>
        <button type="button" className="primary-button">保存</button>
      </div>
    </form>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input defaultValue={value} />
    </label>
  );
}

function ScheduleDetail({ schedule }: { schedule: Schedule }) {
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

function SettingDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          <input defaultValue="3" />
        </label>
        <label className="field">
          <span>TaskCell表示優先順位</span>
          <textarea defaultValue={"開始予定時間\n現場名\nメンバー\n元請け業者\n住所\nメモ"} rows={7} />
        </label>
      </aside>
    </>
  );
}
