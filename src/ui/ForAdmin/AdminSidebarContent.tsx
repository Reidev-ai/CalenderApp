import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Copy, Minus, Plus, Trash2 } from "lucide-react";
import type { Schedule, SidebarMode, Tag, UserRole } from "../../types";
import { ReadStatus, ScheduleDetail } from "../component/ScheduleDetail";

export function AdminSidebarContent({
  mode,
  selectedSchedule,
  tags,
  groupMembers,
  groupMembersError,
  onSaveSchedule,
  onDeleteSchedule,
  onDuplicateSchedule,
  onMarkAsRead,
  onAddTag,
  onOpenTagContextMenu,
  onDirtyChange,
}: {
  mode: SidebarMode;
  selectedSchedule: Schedule | null;
  tags: Tag[];
  groupMembers: string[];
  groupMembersError: string;
  onSaveSchedule: (schedule: Schedule) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onDuplicateSchedule: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
  onAddTag: () => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  if (mode === "edit") {
    if (!selectedSchedule) return <EmptyEditorState onDirtyChange={onDirtyChange} />;

    return (
      <ScheduleEditor
        schedule={selectedSchedule}
        role="Admin"
        tags={tags}
        groupMembers={groupMembers}
        groupMembersError={groupMembersError}
        onAddTag={onAddTag}
        onOpenTagContextMenu={onOpenTagContextMenu}
        onDirtyChange={onDirtyChange}
        onSave={onSaveSchedule}
        onDelete={onDeleteSchedule}
        onDuplicate={onDuplicateSchedule}
        onMarkAsRead={onMarkAsRead}
      />
    );
  }

  if (!selectedSchedule) return <div className="empty-state">タスクを選択してください</div>;

  return <ScheduleDetail schedule={selectedSchedule} role="Admin" onMarkAsRead={onMarkAsRead} />;
}

function EmptyEditorState({ onDirtyChange }: { onDirtyChange: (isDirty: boolean) => void }) {
  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange]);

  return <div className="empty-state">タスクを選択してください</div>;
}

function ScheduleEditor({
  schedule,
  role,
  tags,
  groupMembers,
  groupMembersError,
  onAddTag,
  onOpenTagContextMenu,
  onDirtyChange,
  onSave,
  onDelete,
  onDuplicate,
  onMarkAsRead,
}: {
  schedule: Schedule;
  role: UserRole;
  tags: Tag[];
  groupMembers: string[];
  groupMembersError: string;
  onAddTag: () => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSave: (schedule: Schedule) => void;
  onDelete: (scheduleId: string) => void;
  onDuplicate: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
}) {
  const [draft, setDraft] = useState(schedule);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [memberInput, setMemberInput] = useState("");
  const canEdit = role === "Admin";
  const isDirty = JSON.stringify(draft) !== JSON.stringify(schedule);

  useEffect(() => {
    setDraft(schedule);
  }, [schedule]);

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  function updateDraft(field: keyof Schedule, value: string | string[] | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateDateTimeDraft(field: "date" | "endDate" | "startTime" | "endTime", value: string) {
    setDraft((current) => normalizeDraftDateTime({ ...current, [field]: value }));
  }

  function addMember(member: string) {
    const normalizedMember = member.trim();
    if (!normalizedMember) return;
    setDraft((current) => ({
      ...current,
      members: current.members.includes(normalizedMember) ? current.members : [...current.members, normalizedMember],
    }));
    setMemberInput("");
  }

  function removeMember(member: string) {
    setDraft((current) => ({
      ...current,
      members: current.members.filter((item) => item !== member),
    }));
  }

  function submitMemberInput() {
    splitMembers(memberInput).forEach(addMember);
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
      <div className="field-row">
        <DateField label="開始日" value={draft.date} disabled={!canEdit} onChange={(value) => updateDateTimeDraft("date", value)} />
        <DateField label="終了日" value={draft.endDate ?? draft.date} disabled={!canEdit} onChange={(value) => updateDateTimeDraft("endDate", value)} />
      </div>
      <div className="field-row">
        <TimeField label="開始予定時間" value={draft.startTime} disabled={!canEdit} onChange={(value) => updateDateTimeDraft("startTime", value)} />
        <TimeField label="終了予定時間" value={draft.endTime} disabled={!canEdit} onChange={(value) => updateDateTimeDraft("endTime", value)} />
      </div>
      <div className="field member-field">
        <span className="field-label-row">
          メンバー
          <button type="button" className="inline-add-button icon-only" disabled={!canEdit} aria-label="メンバーを追加" onClick={() => setMemberPanelOpen((value) => !value)}>
            {memberPanelOpen ? <Minus size={14} /> : <Plus size={14} />}
          </button>
        </span>
        <div className="selected-member-list">
          {draft.members.length === 0 ? (
            <span className="member-empty-text">未指定</span>
          ) : (
            draft.members.map((member) => (
              <button type="button" className="selected-member-chip" disabled={!canEdit} key={member} onClick={() => removeMember(member)}>
                {member}
                <span aria-hidden="true">×</span>
              </button>
            ))
          )}
        </div>
        {memberPanelOpen && (
          <div className="member-picker-panel">
            <span className="member-picker-title">グループメンバー</span>
            <div className="member-choice-list">
              {groupMembers.length === 0 ? (
                <div className="member-empty-text">{groupMembersError ? "グループメンバーを取得できません" : "グループメンバーはいません"}</div>
              ) : (
                groupMembers.map((member) => {
                  const selected = draft.members.includes(member);

                  return (
                    <button type="button" className={`member-choice-button ${selected ? "selected" : ""}`} disabled={!canEdit} key={member} onClick={() => addMember(member)}>
                      {member}
                    </button>
                  );
                })
              )}
            </div>
            {groupMembersError && <p className="member-picker-message">{groupMembersError}</p>}
            <span className="member-picker-title">その他メンバー</span>
            <div className="member-manual-row">
              <input
                value={memberInput}
                disabled={!canEdit}
                placeholder="名前を入力"
                onChange={(event) => setMemberInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitMemberInput();
                  }
                }}
              />
              <button type="button" className="secondary-button" disabled={!canEdit || memberInput.trim() === ""} onClick={submitMemberInput}>
                追加
              </button>
            </div>
          </div>
        )}
      </div>
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
              <label
                className={`tag-choice ${selected ? "selected" : ""}`}
                key={tag.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onOpenTagContextMenu(tag, event.clientX, event.clientY);
                }}
              >
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
        <textarea
          className="auto-size-textarea"
          value={draft.memo}
          disabled={!canEdit}
          rows={getTextareaRows(draft.memo)}
          onChange={(event) => updateDraft("memo", event.target.value)}
        />
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

type DatePart = "year" | "month" | "day";

function DateField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [selectedPart, setSelectedPart] = useState<DatePart>("year");
  const [editing, setEditing] = useState(false);
  const [digitBuffer, setDigitBuffer] = useState("");
  const cancelValueRef = useRef(value);
  const parts = parseDate(value);

  function startEditing(part: DatePart) {
    if (disabled) return;
    cancelValueRef.current = value;
    setEditing(true);
    setSelectedPart(part);
    setDigitBuffer("");
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function finishEditing() {
    setEditing(false);
    setDigitBuffer("");
  }

  function cancelEditing() {
    onChange(cancelValueRef.current);
    finishEditing();
  }

  function updatePart(part: DatePart, nextValue: number) {
    const next = { ...parts, [part]: nextValue };
    onChange(formatDateParts(next.year, next.month, next.day));
  }

  function movePart(direction: -1 | 1) {
    const order: DatePart[] = ["year", "month", "day"];
    const nextIndex = clamp(order.indexOf(selectedPart) + direction, 0, order.length - 1);
    setSelectedPart(order[nextIndex]);
    setDigitBuffer("");
  }

  function handleDigit(digit: string) {
    const maxLength = selectedPart === "year" ? 4 : 2;
    const nextBuffer = `${digitBuffer}${digit}`.slice(0, maxLength);
    const rawValue = Number(nextBuffer);
    const nextValue = selectedPart === "year"
      ? clamp(rawValue, 1900, 2099)
      : selectedPart === "month"
        ? clamp(nextBuffer.length === 1 ? rawValue * 10 : rawValue, 1, 12)
        : clamp(nextBuffer.length === 1 ? rawValue * 10 : rawValue, 1, getDaysInMonth(parts.year, parts.month));

    updatePart(selectedPart, nextValue);
    setDigitBuffer(nextBuffer);

    if (nextBuffer.length === maxLength) {
      if (selectedPart === "year") setSelectedPart("month");
      if (selectedPart === "month") setSelectedPart("day");
      setDigitBuffer("");
    }
  }

  function handleBackspace() {
    if (digitBuffer.length > 0) {
      const nextBuffer = digitBuffer.slice(0, -1);
      setDigitBuffer(nextBuffer);
      if (nextBuffer) updatePart(selectedPart, Number(nextBuffer));
      return;
    }
    movePart(-1);
  }

  function incrementSelectedPart(delta: -1 | 1) {
    const currentDate = new Date(parts.year, parts.month - 1, parts.day);
    if (selectedPart === "year") currentDate.setFullYear(currentDate.getFullYear() + delta);
    if (selectedPart === "month") currentDate.setMonth(currentDate.getMonth() + delta);
    if (selectedPart === "day") currentDate.setDate(currentDate.getDate() + delta);
    onChange(formatDateParts(currentDate.getFullYear(), currentDate.getMonth() + 1, currentDate.getDate()));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!editing) startEditing(selectedPart);

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleDigit(event.key);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      movePart(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      incrementSelectedPart(event.key === "ArrowUp" ? 1 : -1);
      setDigitBuffer("");
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      handleBackspace();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  return (
    <label className="field date-field">
      <span>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className={`date-input ${editing ? "editing" : ""}`}
        disabled={disabled}
        onClick={(event) => {
          if (event.target === event.currentTarget) startEditing(selectedPart);
        }}
        onBlur={finishEditing}
        onKeyDown={handleKeyDown}
      >
        <span className={selectedPart === "year" ? "selected" : ""} onMouseDown={(event) => { event.preventDefault(); startEditing("year"); }}>{parts.year}</span>
        <strong>-</strong>
        <span className={selectedPart === "month" ? "selected" : ""} onMouseDown={(event) => { event.preventDefault(); startEditing("month"); }}>{parts.month.toString().padStart(2, "0")}</span>
        <strong>-</strong>
        <span className={selectedPart === "day" ? "selected" : ""} onMouseDown={(event) => { event.preventDefault(); startEditing("day"); }}>{parts.day.toString().padStart(2, "0")}</span>
      </button>
    </label>
  );
}

function TimeField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [selectedPart, setSelectedPart] = useState<"hour" | "minute">("hour");
  const [editing, setEditing] = useState(false);
  const [digitBuffer, setDigitBuffer] = useState("");
  const cancelValueRef = useRef(value);
  const { hour, minute } = parseTime(value);

  function updatePart(part: "hour" | "minute", nextValue: number) {
    const nextHour = part === "hour" ? clamp(nextValue, 0, 23) : hour;
    const nextMinute = part === "minute" ? clamp(nextValue, 0, 59) : minute;
    onChange(formatTime(nextHour, nextMinute));
  }

  function startEditing(part: "hour" | "minute") {
    if (disabled) return;
    cancelValueRef.current = value;
    setEditing(true);
    setSelectedPart(part);
    setDigitBuffer("");
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function finishEditing() {
    setEditing(false);
    setDigitBuffer("");
  }

  function cancelEditing() {
    onChange(cancelValueRef.current);
    finishEditing();
  }

  function handleDigit(digit: string) {
    const nextBuffer = `${digitBuffer}${digit}`.slice(0, 2);
    const maxValue = selectedPart === "hour" ? 23 : 59;
    const maxTens = selectedPart === "hour" ? 2 : 5;
    const digitValue = Number(digit);
    const singleDigitCompletesPart = digitBuffer.length === 0 && digitValue > maxTens;
    const rawTwoDigitValue = Number(nextBuffer);
    const constrainedTwoDigitValue = selectedPart === "hour" && digitBuffer === "2"
      ? clamp(rawTwoDigitValue, 20, 23)
      : clamp(rawTwoDigitValue, 0, maxValue);
    const nextValue = nextBuffer.length === 1
      ? singleDigitCompletesPart
        ? digitValue
        : digitValue * 10
      : constrainedTwoDigitValue;
    updatePart(selectedPart, nextValue);
    setDigitBuffer(singleDigitCompletesPart ? "" : nextBuffer);

    if (nextBuffer.length === 2 || singleDigitCompletesPart) {
      if (selectedPart === "hour") {
        setSelectedPart("minute");
        setDigitBuffer("");
      } else {
        setDigitBuffer("");
      }
    }
  }

  function handleBackspace() {
    if (digitBuffer.length > 0) {
      const nextBuffer = digitBuffer.slice(0, -1);
      setDigitBuffer(nextBuffer);
      updatePart(selectedPart, nextBuffer ? Number(nextBuffer) : 0);
      return;
    }

    if (selectedPart === "minute") {
      setSelectedPart("hour");
      setDigitBuffer(hour.toString().padStart(2, "0").slice(0, 1));
      return;
    }

    updatePart("hour", 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!editing) startEditing(selectedPart);

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleDigit(event.key);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSelectedPart("hour");
      setDigitBuffer("");
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSelectedPart("minute");
      setDigitBuffer("");
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 1 : -1;
      const currentValue = selectedPart === "hour" ? hour : minute;
      const maxValue = selectedPart === "hour" ? 23 : 59;
      updatePart(selectedPart, wrap(currentValue + delta, maxValue));
      setDigitBuffer("");
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      handleBackspace();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  return (
    <label className="field time-field">
      <span>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className={`time-input ${editing ? "editing" : ""}`}
        disabled={disabled}
        onClick={(event) => {
          if (event.target === event.currentTarget) startEditing(selectedPart);
        }}
        onBlur={finishEditing}
        onKeyDown={handleKeyDown}
      >
        <span
          className={selectedPart === "hour" ? "selected" : ""}
          onMouseDown={(event) => {
            event.preventDefault();
            startEditing("hour");
          }}
        >
          {hour.toString().padStart(2, "0")}
        </span>
        <strong>:</strong>
        <span
          className={selectedPart === "minute" ? "selected" : ""}
          onMouseDown={(event) => {
            event.preventDefault();
            startEditing("minute");
          }}
        >
          {minute.toString().padStart(2, "0")}
        </span>
      </button>
    </label>
  );
}

function parseTime(value: string) {
  const [rawHour, rawMinute] = value.split(":").map(Number);
  return {
    hour: clamp(Number.isFinite(rawHour) ? rawHour : 0, 0, 23),
    minute: clamp(Number.isFinite(rawMinute) ? rawMinute : 0, 0, 59),
  };
}

function formatTime(hour: number, minute: number) {
  return `${clamp(hour, 0, 23).toString().padStart(2, "0")}:${clamp(minute, 0, 59).toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrap(value: number, max: number) {
  if (value < 0) return max;
  if (value > max) return 0;
  return value;
}

function parseDate(value: string) {
  const [rawYear, rawMonth, rawDay] = value.split("-").map(Number);
  const year = clamp(Number.isFinite(rawYear) ? rawYear : new Date().getFullYear(), 1900, 2099);
  const month = clamp(Number.isFinite(rawMonth) ? rawMonth : 1, 1, 12);
  const day = clamp(Number.isFinite(rawDay) ? rawDay : 1, 1, getDaysInMonth(year, month));
  return { year, month, day };
}

function formatDateParts(year: number, month: number, day: number) {
  const safeYear = clamp(year, 1900, 2099);
  const safeMonth = clamp(month, 1, 12);
  const safeDay = clamp(day, 1, getDaysInMonth(safeYear, safeMonth));
  return `${safeYear.toString().padStart(4, "0")}-${safeMonth.toString().padStart(2, "0")}-${safeDay.toString().padStart(2, "0")}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function normalizeDraftDateTime(schedule: Schedule) {
  const endDate = schedule.endDate ?? schedule.date;
  if (endDate < schedule.date) {
    return { ...schedule, endDate: schedule.date, endTime: schedule.startTime };
  }

  if (endDate === schedule.date && compareTime(schedule.endTime, schedule.startTime) < 0) {
    return { ...schedule, endDate: schedule.date, endTime: schedule.startTime };
  }

  return { ...schedule, endDate };
}

function compareTime(left: string, right: string) {
  return parseTime(left).hour * 60 + parseTime(left).minute - (parseTime(right).hour * 60 + parseTime(right).minute);
}

function splitMembers(value: string) {
  return value
    .split(/[、,\s]+/)
    .map((member) => member.trim())
    .filter(Boolean);
}

function getTextareaRows(value: string) {
  return Math.min(12, Math.max(3, value.split("\n").length));
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}
