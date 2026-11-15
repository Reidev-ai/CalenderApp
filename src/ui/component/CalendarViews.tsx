import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { LaidOutSchedule, Schedule, TaskCellPriorityItem, UserRole } from "../../types";
import { formatDateLabel, formatMonthTitle, minutesToTime, toDateKey } from "../../utils/time";
import { layoutSchedulesForDay } from "../../utils/layoutSchedules";
import type { CalendarComparison, ComparisonMark } from "../../comparisonTypes";
import { ComparisonBadge, ComparisonLegend } from "./ComparisonBadge";

const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
const monthGridColumnCount = weekDays.length;
const timeMarks = [0, 360, 720, 1080, 1440];
const minTaskCellWidth = 44;
const monthGridRowCount = 6;
const compactLayoutBreakpoint = 720;
const compactCalendarZoom = 0.8;
const monthLayoutMetrics = {
  default: {
    dayVerticalPadding: 16,
    dayHeadHeight: 26,
    dayGap: 6,
    taskChipHeight: 26,
    taskGap: 5,
    hiddenCountHeight: 24,
  },
  compact: {
    dayVerticalPadding: 6,
    dayHeadHeight: 18 * compactCalendarZoom,
    dayGap: 3,
    taskChipHeight: 18 * compactCalendarZoom,
    taskGap: 3,
    hiddenCountHeight: 18 * compactCalendarZoom,
  },
};

type CalendarMonthDesktopProps = {
  comparison?: CalendarComparison;
  anchorDate: Date;
  monthDates: Date[];
  schedules: Schedule[];
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  taskCellPriority: TaskCellPriorityItem[];
  selectedDateKey: string | null;
  titleAction?: ReactNode;
  onSelectDate: (dateKey: string, hiddenSchedules: Schedule[]) => void;
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenHiddenList: (schedules: Schedule[]) => void;
  onMoveScheduleDate?: (schedule: Schedule, dateKey: string) => void;
};

export function CalendarMonthDesktop({
  comparison,
  anchorDate,
  monthDates,
  schedules,
  role,
  currentUserId,
  currentUserName,
  taskCellPriority,
  selectedDateKey,
  titleAction,
  onSelectDate,
  onSelectSchedule,
  onOpenHiddenList,
  onMoveScheduleDate,
}: CalendarMonthDesktopProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridHeight = useElementHeight(gridRef);
  const windowWidth = useWindowWidth();
  const monthMetrics = windowWidth <= compactLayoutBreakpoint ? monthLayoutMetrics.compact : monthLayoutMetrics.default;
  const dayCellHeight = gridHeight > 0 ? gridHeight / monthGridRowCount : 0;
  const todayKey = toDateKey(new Date());
  const anchorMonth = anchorDate.getMonth();

  function resolveMonthDropDateKey(clientX: number, clientY: number) {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;

    const columnIndex = Math.min(
      monthGridColumnCount - 1,
      Math.max(0, Math.floor((clientX - rect.left) / (rect.width / monthGridColumnCount))),
    );
    const rowIndex = Math.min(
      monthGridRowCount - 1,
      Math.max(0, Math.floor((clientY - rect.top) / (rect.height / monthGridRowCount))),
    );
    const dropDate = monthDates[rowIndex * monthGridColumnCount + columnIndex];
    return dropDate ? toDateKey(dropDate) : null;
  }

  return (
    <section className="calendar-panel" aria-label="月表示カレンダー">
      <div className="month-title-row">
        <h1>{formatMonthTitle(anchorDate)}</h1>
        <ComparisonLegend comparison={comparison} />
        {titleAction}
      </div>
      <div className="month-weekday-header">
        {weekDays.map((day) => (
          <div className="month-weekday-cell" key={day}>{day}</div>
        ))}
      </div>
      <div className="month-grid" ref={gridRef}>
        {monthDates.map((date) => {
          const dateKey = toDateKey(date);
          const daySchedules = schedules
            .flatMap((schedule) => getScheduleSegmentForDate(schedule, dateKey))
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          const visibleCount = getVisibleMonthTaskCount(daySchedules.length, dayCellHeight, monthMetrics);
          const visibleSchedules = daySchedules.slice(0, visibleCount);
          const hiddenSchedules = daySchedules.slice(visibleCount);
          const isToday = dateKey === todayKey;
          const isOutsideMonth = date.getMonth() !== anchorMonth;
          const isSelected = dateKey === selectedDateKey;

          return (
            <div
              className={`month-day-cell ${isToday ? "today" : ""} ${isOutsideMonth ? "outside-month" : ""} ${isSelected ? "selected" : ""}`}
              data-date-key={dateKey}
              key={dateKey}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDate(dateKey, hiddenSchedules)}
              onDragOver={(event) => {
                if (onMoveScheduleDate) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!onMoveScheduleDate) return;
                event.preventDefault();
                const scheduleId = event.dataTransfer.getData("text/plain");
                const schedule = schedules.find((item) => item.id === scheduleId);
                if (schedule) onMoveScheduleDate(schedule, dateKey);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDate(dateKey, hiddenSchedules);
                }
              }}
            >
              <div className="month-day-head">
                <span className="month-date-pill">{date.getDate()}</span>
                {hiddenSchedules.length > 0 && (
                  <button
                    className="month-hidden-count"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenHiddenList(hiddenSchedules);
                    }}
                  >
                    +{hiddenSchedules.length}件
                  </button>
                )}
              </div>
              <div className="month-task-list">
                {visibleSchedules.map((schedule) => (
                  <MonthTaskChip
                    key={schedule.id}
                    schedule={schedule}
                    comparisonMark={comparison?.marks[schedule.id]}
                    role={role}
                    currentUserId={currentUserId}
                    currentUserName={currentUserName}
                    priority={taskCellPriority}
                    onSelectSchedule={onSelectSchedule}
                    onMoveScheduleDate={comparison?.marks[schedule.id]?.readonly ? undefined : onMoveScheduleDate}
                    getDropDateKey={resolveMonthDropDateKey}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MonthTaskChip({
  schedule,
  comparisonMark,
  role,
  currentUserId,
  currentUserName,
  priority,
  onSelectSchedule,
  onMoveScheduleDate,
  getDropDateKey,
}: {
  schedule: Schedule;
  comparisonMark?: ComparisonMark;
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  priority: TaskCellPriorityItem[];
  onSelectSchedule: (schedule: Schedule) => void;
  onMoveScheduleDate?: (schedule: Schedule, dateKey: string) => void;
  getDropDateKey: (clientX: number, clientY: number) => string | null;
}) {
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean; pointerId: number; rect: DOMRect } | null>(null);
  const removeDocumentDragListenersRef = useRef<(() => void) | null>(null);
  const skipClickRef = useRef(false);
  const isUnread = isUnreadForCurrentUser(schedule, role, currentUserId, currentUserName);
  const className = `month-task-chip ${dragPreview ? "dragging" : ""} ${isUnread ? "unread-task" : ""} ${schedule.isPersonal ? "personal-task" : ""}`;
  const content = (
    <>
      <ComparisonBadge mark={comparisonMark} />
      {isUnread && <UnreadBadge />}
      {schedule.isPersonal && <PersonalBadge />}
      {priority.slice(0, 2).map((priorityItem) => renderTaskCellPriorityItem(priorityItem, schedule, " ~ "))}
    </>
  );

  function updateDragPreview(clientX: number, clientY: number) {
    if (!dragStartRef.current) return;
    const offsetX = clientX - dragStartRef.current.x;
    const offsetY = clientY - dragStartRef.current.y;
    setDragPreview({
      x: dragStartRef.current.rect.left + offsetX,
      y: dragStartRef.current.rect.top + offsetY,
      width: dragStartRef.current.rect.width,
      height: dragStartRef.current.rect.height,
    });
  }

  function removeDocumentDragListeners() {
    removeDocumentDragListenersRef.current?.();
    removeDocumentDragListenersRef.current = null;
  }

  function handleDocumentPointerMove(event: PointerEvent) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y);
    if (distance <= 6) return;
    event.preventDefault();
    dragStartRef.current.moved = true;
    updateDragPreview(event.clientX, event.clientY);
  }

  function finishDrag(clientX: number, clientY: number) {
    if (!dragStartRef.current) return;
    const wasMoved = dragStartRef.current.moved;
    setDragPreview(null);
    removeDocumentDragListeners();
    if (wasMoved && onMoveScheduleDate) {
      skipClickRef.current = true;
      const dropDateKey = getDropDateKey(clientX, clientY);
      if (dropDateKey) onMoveScheduleDate(schedule, dropDateKey);
    }
    dragStartRef.current = null;
  }

  function handleDocumentPointerUp(event: PointerEvent) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    if (dragStartRef.current.moved) event.preventDefault();
    finishDrag(event.clientX, event.clientY);
  }

  function handleDocumentPointerCancel(event: PointerEvent) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    skipClickRef.current = false;
    setDragPreview(null);
    removeDocumentDragListeners();
  }

  function addDocumentDragListeners() {
    removeDocumentDragListeners();
    window.addEventListener("pointermove", handleDocumentPointerMove, { passive: false });
    window.addEventListener("pointerup", handleDocumentPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleDocumentPointerCancel);
    removeDocumentDragListenersRef.current = () => {
      window.removeEventListener("pointermove", handleDocumentPointerMove);
      window.removeEventListener("pointerup", handleDocumentPointerUp);
      window.removeEventListener("pointercancel", handleDocumentPointerCancel);
    };
  }

  useEffect(() => removeDocumentDragListeners, []);

  return (
    <>
      <button
        ref={chipRef}
        className={className}
        data-comparison={comparisonMark?.kind}
        data-schedule-id={schedule.id}
        title={comparisonMark ? `${comparisonMark.label}: ${schedule.siteName}` : undefined}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        style={{
          borderLeftColor: getPrimaryTagColor(schedule),
          visibility: dragPreview ? "hidden" : undefined,
        }}
        onContextMenu={(event) => {
          if (onMoveScheduleDate) event.preventDefault();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (skipClickRef.current) {
            event.preventDefault();
            skipClickRef.current = false;
            return;
          }
          onSelectSchedule(schedule);
        }}
        onPointerDown={(event) => {
          if (!onMoveScheduleDate || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          skipClickRef.current = false;
          dragStartRef.current = { x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId, rect };
          setDragPreview(null);
          addDocumentDragListeners();
        }}
        onPointerMove={(event) => {
          if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
          const distance = Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y);
          if (distance <= 6) return;
          dragStartRef.current.moved = true;
          updateDragPreview(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
          if (dragStartRef.current.moved) {
            event.preventDefault();
            event.stopPropagation();
          }
          finishDrag(event.clientX, event.clientY);
        }}
        onPointerCancel={(event) => {
          if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
          skipClickRef.current = false;
          setDragPreview(null);
          removeDocumentDragListeners();
          dragStartRef.current = null;
        }}
      >
        {content}
      </button>
      {dragPreview && (
        <button
          className={`${className} drag-preview`}
          style={{
            borderLeftColor: getPrimaryTagColor(schedule),
            left: `${dragPreview.x}px`,
            top: `${dragPreview.y}px`,
            width: `${dragPreview.width}px`,
            height: `${dragPreview.height}px`,
          }}
          tabIndex={-1}
          type="button"
          aria-hidden="true"
        >
          {content}
        </button>
      )}
    </>
  );
}

type CalendarWeekDesktopProps = {
  comparison?: CalendarComparison;
  weekDates: Date[];
  schedules: Schedule[];
  fallbackMaxVisibleColumns: number;
  currentMinute: number;
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  taskCellPriority: TaskCellPriorityItem[];
  titleAction?: ReactNode;
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenOverlapList: (schedules: Schedule[]) => void;
  onMoveSchedule: (schedule: Schedule, dateKey: string, startMinutes: number) => void;
};

export function CalendarWeekDesktop({ comparison, weekDates, schedules, fallbackMaxVisibleColumns, currentMinute, role, currentUserId, currentUserName, taskCellPriority, titleAction, onSelectSchedule, onOpenOverlapList, onMoveSchedule }: CalendarWeekDesktopProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridWidth = useElementWidth(gridRef);
  const dayColumnWidth = gridWidth > 0 ? gridWidth / weekDates.length : 0;
  const visibleColumnCount = getVisibleStackCount(dayColumnWidth, fallbackMaxVisibleColumns);
  const currentTop = (currentMinute / 1440) * 100;
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];

  function resolveWeekDrop(clientX: number, clientY: number) {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width - 1);
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    const dayIndex = Math.min(weekDates.length - 1, Math.max(0, Math.floor(x / (rect.width / weekDates.length))));
    return {
      dateKey: toDateKey(weekDates[dayIndex]),
      startMinutes: snapMinutes((y / rect.height) * 1440),
    };
  }

  return (
    <section className="calendar-panel" aria-label="週表示カレンダー">
      <CalendarTitle
        title={`${weekStart.getFullYear()}年 ${formatDateLabel(weekStart)} - ${formatDateLabel(weekEnd)}`}
        action={titleAction}
        comparison={comparison}
      />
      <WeekHeader weekDates={weekDates} />
      <div className="week-scroll-area">
        <TimeAxis currentMinute={currentMinute} />
        <div className="week-grid" ref={gridRef}>
          {timeMarks.map((minute) => (
            <div className="time-guide" style={{ top: `${(minute / 1440) * 100}%` }} key={minute} />
          ))}
          <div className="current-time-line" style={{ top: `${currentTop}%` }} />
          {weekDates.map((date) => {
            const dateKey = toDateKey(date);
            const daySchedules = schedules.flatMap((schedule) => getScheduleSegmentForDate(schedule, dateKey));
            const laidOut = layoutSchedulesForDay(daySchedules, visibleColumnCount);
            const hiddenByGroup = groupHiddenSchedules(laidOut);

            return (
              <div className="day-column" data-date-key={dateKey} key={dateKey}>
                {laidOut
                  .filter((item) => !item.hidden)
                  .map((item) => (
                    <TaskCell
                      key={item.schedule.id}
                      item={item}
                      comparisonMark={comparison?.marks[item.schedule.id]}
                      role={role}
                      currentUserId={currentUserId}
                      currentUserName={currentUserName}
                      priority={taskCellPriority}
                      onClick={() => onSelectSchedule(item.schedule)}
                      onDropMove={comparison?.marks[item.schedule.id]?.readonly ? undefined : (clientX, clientY) => {
                        const drop = resolveWeekDrop(clientX, clientY);
                        if (drop) onMoveSchedule(item.schedule, drop.dateKey, drop.startMinutes);
                      }}
                    />
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
  comparison?: CalendarComparison;
  date: Date;
  schedules: Schedule[];
  fallbackMaxVisibleColumns: number;
  currentMinute: number;
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  taskCellPriority: TaskCellPriorityItem[];
  titleAction?: ReactNode;
  onSelectSchedule: (schedule: Schedule) => void;
  onOpenOverlapList: (schedules: Schedule[]) => void;
  onMoveSchedule: (schedule: Schedule, dateKey: string, startMinutes: number) => void;
};

export function CalendarDayDesktop({ comparison, date, schedules, fallbackMaxVisibleColumns, currentMinute, role, currentUserId, currentUserName, taskCellPriority, titleAction, onSelectSchedule, onOpenOverlapList, onMoveSchedule }: CalendarDayDesktopProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridWidth = useElementWidth(gridRef);
  const visibleColumnCount = getVisibleStackCount(gridWidth, fallbackMaxVisibleColumns);
  const currentTop = (currentMinute / 1440) * 100;
  const dateKey = toDateKey(date);
  const daySchedules = schedules.flatMap((schedule) => getScheduleSegmentForDate(schedule, dateKey));
  const laidOut = layoutSchedulesForDay(daySchedules, visibleColumnCount);
  const hiddenByGroup = groupHiddenSchedules(laidOut);

  function resolveDayDrop(clientY: number) {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    return snapMinutes((y / rect.height) * 1440);
  }

  return (
    <section className="calendar-panel" aria-label="日表示カレンダー">
      <CalendarTitle title={`${date.getFullYear()}年 ${formatDateLabel(date)}`} action={titleAction} comparison={comparison} />
      <WeekHeader weekDates={[date]} className="day-header" />
      <div className="week-scroll-area day-view-area">
        <TimeAxis currentMinute={currentMinute} />
        <div className="week-grid day-grid" ref={gridRef}>
          {timeMarks.map((minute) => (
            <div className="time-guide" style={{ top: `${(minute / 1440) * 100}%` }} key={minute} />
          ))}
          <div className="current-time-line" style={{ top: `${currentTop}%` }} />
          <div className="day-column day-view-column" data-date-key={dateKey}>
            {laidOut
              .filter((item) => !item.hidden)
              .map((item) => (
                <TaskCell
                  key={item.schedule.id}
                  item={item}
                  comparisonMark={comparison?.marks[item.schedule.id]}
                  role={role}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  priority={taskCellPriority}
                  onClick={() => onSelectSchedule(item.schedule)}
                  onDropMove={comparison?.marks[item.schedule.id]?.readonly ? undefined : (_clientX, clientY) => {
                    const startMinutes = resolveDayDrop(clientY);
                    if (startMinutes !== null) onMoveSchedule(item.schedule, dateKey, startMinutes);
                  }}
                />
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

function CalendarTitle({ title, action, comparison }: { title: string; action?: ReactNode; comparison?: CalendarComparison }) {
  return (
    <div className="calendar-title-row">
      <h1>{title}</h1>
      <ComparisonLegend comparison={comparison} />
      {action}
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

function TaskCell({
  item,
  comparisonMark,
  role,
  currentUserId,
  currentUserName,
  priority,
  onClick,
  onDropMove,
}: {
  item: LaidOutSchedule;
  comparisonMark?: ComparisonMark;
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  priority: TaskCellPriorityItem[];
  onClick: () => void;
  onDropMove?: (clientX: number, clientY: number) => void;
}) {
  const cellRef = useRef<HTMLButtonElement | null>(null);
  const [cellWidth, setCellWidth] = useState(0);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);
  const removeDocumentDragListenersRef = useRef<(() => void) | null>(null);
  const skipClickRef = useRef(false);
  const width = `calc(${100 / item.columnCount}% - 6px)`;
  const left = `calc(${(100 / item.columnCount) * item.columnIndex}% + 3px)`;
  const isNarrow = cellWidth > 0 && cellWidth < 74;
  const widthCapacity = getTaskCellWidthCapacity(cellWidth);
  const heightCapacity = getTaskCellHeightCapacity(item.heightPercent);
  const visibleDetailCount = Math.max(0, Math.min(widthCapacity, heightCapacity - (comparisonMark ? 1 : 0)));
  const visibleItems = priority.slice(0, visibleDetailCount);
  const timeSeparator = " ~ ";

  useEffect(() => {
    const node = cellRef.current;
    if (!node) return;

    const updateWidth = () => setCellWidth(node.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  function removeDocumentDragListeners() {
    removeDocumentDragListenersRef.current?.();
    removeDocumentDragListenersRef.current = null;
  }

  function handleDocumentPointerMove(event: PointerEvent) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y);
    if (distance <= 6) return;
    event.preventDefault();
    dragStartRef.current.moved = true;
    setDragOffset({
      x: event.clientX - dragStartRef.current.x,
      y: event.clientY - dragStartRef.current.y,
    });
  }

  function finishDrag(clientX: number, clientY: number) {
    if (!dragStartRef.current) return;
    const wasMoved = dragStartRef.current.moved;
    setDragOffset(null);
    removeDocumentDragListeners();
    if (wasMoved && onDropMove) {
      skipClickRef.current = true;
      onDropMove(clientX, clientY);
    }
    dragStartRef.current = null;
  }

  function handleDocumentPointerUp(event: PointerEvent) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    if (dragStartRef.current.moved) event.preventDefault();
    finishDrag(event.clientX, event.clientY);
  }

  function handleDocumentPointerCancel(event: PointerEvent) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    skipClickRef.current = false;
    setDragOffset(null);
    removeDocumentDragListeners();
  }

  function addDocumentDragListeners() {
    removeDocumentDragListeners();
    window.addEventListener("pointermove", handleDocumentPointerMove, { passive: false });
    window.addEventListener("pointerup", handleDocumentPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleDocumentPointerCancel);
    removeDocumentDragListenersRef.current = () => {
      window.removeEventListener("pointermove", handleDocumentPointerMove);
      window.removeEventListener("pointerup", handleDocumentPointerUp);
      window.removeEventListener("pointercancel", handleDocumentPointerCancel);
    };
  }

  useEffect(() => removeDocumentDragListeners, []);

  return (
    <button
      ref={cellRef}
      data-comparison={comparisonMark?.kind}
      data-schedule-id={item.schedule.id}
      title={comparisonMark ? `${comparisonMark.label}: ${item.schedule.siteName}` : undefined}
      className={`task-cell ${dragOffset ? "dragging" : ""} ${isNarrow ? "narrow" : ""} ${isUnreadForCurrentUser(item.schedule, role, currentUserId, currentUserName) ? "unread-task" : ""} ${item.schedule.isPersonal ? "personal-task" : ""}`}
      style={{
        top: `${item.topPercent}%`,
        height: `${item.heightPercent}%`,
        width,
        left,
        borderLeftColor: getPrimaryTagColor(item.schedule),
        transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
      }}
      onContextMenu={(event) => {
        if (onDropMove) event.preventDefault();
      }}
      onClick={(event) => {
        if (skipClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          skipClickRef.current = false;
          return;
        }
        onClick();
      }}
      onPointerDown={(event) => {
        if (!onDropMove || event.button !== 0) return;
        event.preventDefault();
        skipClickRef.current = false;
        dragStartRef.current = { x: event.clientX, y: event.clientY, moved: false, pointerId: event.pointerId };
        setDragOffset(null);
        addDocumentDragListeners();
      }}
      onPointerMove={(event) => {
        if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
        const distance = Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y);
        if (distance > 6) {
          dragStartRef.current.moved = true;
          setDragOffset({
            x: event.clientX - dragStartRef.current.x,
            y: event.clientY - dragStartRef.current.y,
          });
        }
      }}
      onPointerUp={(event) => {
        if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
        if (dragStartRef.current.moved) event.preventDefault();
        finishDrag(event.clientX, event.clientY);
      }}
      onPointerCancel={(event) => {
        if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
        skipClickRef.current = false;
        setDragOffset(null);
        removeDocumentDragListeners();
        dragStartRef.current = null;
      }}
    >
      <ComparisonBadge mark={comparisonMark} />
      {isUnreadForCurrentUser(item.schedule, role, currentUserId, currentUserName) && <UnreadBadge />}
      {item.schedule.isPersonal && <PersonalBadge />}
      {visibleItems.map((priorityItem) => renderTaskCellPriorityItem(priorityItem, item.schedule, timeSeparator))}
    </button>
  );
}

function UnreadBadge() {
  return <span className="unread-badge">未</span>;
}

function PersonalBadge() {
  return <span className="personal-badge">個人</span>;
}

function renderTaskCellPriorityItem(item: TaskCellPriorityItem, schedule: Schedule, timeSeparator: string) {
  if (item.id === "time") {
    return (
      <strong key={item.id}>
        {schedule.startTime}{timeSeparator}{schedule.endTime}
      </strong>
    );
  }

  const valueById: Record<Exclude<TaskCellPriorityItem["id"], "time">, string> = {
    siteName: schedule.siteName,
    members: schedule.members.join("、"),
    contractor: schedule.contractor,
    address: schedule.address,
    memo: schedule.memo,
  };

  return <span key={item.id}>{valueById[item.id]}</span>;
}

export function getScheduleSegmentForDate(schedule: Schedule, dateKey: string) {
  const endDate = getScheduleEndDate(schedule);
  if (dateKey < schedule.date || dateKey > endDate) return [];

  const segment: Schedule = {
    ...schedule,
    date: dateKey,
    startTime: dateKey === schedule.date ? schedule.startTime : "00:00",
    endTime: dateKey === endDate ? schedule.endTime : "24:00",
  };

  return [segment];
}

function getScheduleEndDate(schedule: Schedule) {
  const endDate = schedule.endDate ?? schedule.date;
  return endDate < schedule.date ? schedule.date : endDate;
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

type MonthLayoutMetrics = typeof monthLayoutMetrics.default;

function getVisibleMonthTaskCount(scheduleCount: number, dayCellHeight: number, metrics: MonthLayoutMetrics) {
  if (scheduleCount <= 0) return 0;
  if (dayCellHeight <= 0) return Math.min(scheduleCount, 3);

  const availableHeight = dayCellHeight - metrics.dayVerticalPadding - metrics.dayHeadHeight - metrics.dayGap;
  return Math.max(0, Math.floor((availableHeight + metrics.taskGap) / (metrics.taskChipHeight + metrics.taskGap)));
}

function isUnreadForCurrentUser(schedule: Schedule, role: UserRole, currentUserId: string, currentUserName: string) {
  if (role !== "User") return false;
  if (currentUserId && (schedule.readByUserIds ?? []).includes(currentUserId)) return false;
  if (currentUserName && schedule.readBy.includes(currentUserName)) return false;
  return true;
}

function getVisibleStackCount(dayColumnWidth: number, fallback: number) {
  if (dayColumnWidth <= 0) return fallback;
  return Math.max(1, Math.floor(dayColumnWidth / minTaskCellWidth));
}

function snapMinutes(minutes: number) {
  return Math.max(0, Math.min(1410, Math.round(minutes / 30) * 30));
}

function getTaskCellWidthCapacity(width: number) {
  if (width <= 0) return 1;
  if (width < 34) return 1;
  if (width < 52) return 2;
  if (width < 74) return 3;
  if (width < 118) return 4;
  return 5;
}

function getTaskCellHeightCapacity(heightPercent: number) {
  if (heightPercent < 3.8) return 1;
  if (heightPercent < 8) return 2;
  if (heightPercent < 14) return 3;
  if (heightPercent < 18) return 4;
  return 5;
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}

function getPrimaryTagColor(schedule: Schedule) {
  return getScheduleTagColors(schedule)[0] ?? "#3b82f6";
}

function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const updateWidth = () => setWidth(node.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function useElementHeight(ref: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const updateHeight = () => setHeight(node.getBoundingClientRect().height);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return height;
}

function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const updateWidth = () => setWidth(window.innerWidth);
    updateWidth();

    window.addEventListener("resize", updateWidth);

    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  return width;
}
