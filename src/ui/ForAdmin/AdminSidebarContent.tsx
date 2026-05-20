import { useEffect, useState } from "react";
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
}) {
  if (!selectedSchedule) return <div className="empty-state">タスクを選択してください</div>;

  if (mode === "edit") {
    return (
      <ScheduleEditor
        schedule={selectedSchedule}
        role="Admin"
        tags={tags}
        groupMembers={groupMembers}
        groupMembersError={groupMembersError}
        onAddTag={onAddTag}
        onOpenTagContextMenu={onOpenTagContextMenu}
        onSave={onSaveSchedule}
        onDelete={onDeleteSchedule}
        onDuplicate={onDuplicateSchedule}
        onMarkAsRead={onMarkAsRead}
      />
    );
  }

  return <ScheduleDetail schedule={selectedSchedule} role="Admin" onMarkAsRead={onMarkAsRead} />;
}

function ScheduleEditor({
  schedule,
  role,
  tags,
  groupMembers,
  groupMembersError,
  onAddTag,
  onOpenTagContextMenu,
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

  function updateDraft(field: keyof Schedule, value: string | string[] | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
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
      <Field label="日付" value={draft.date} disabled={!canEdit} onChange={(value) => updateDraft("date", value)} />
      <div className="field-row">
        <Field label="開始予定時間" value={draft.startTime} disabled={!canEdit} onChange={(value) => updateDraft("startTime", value)} />
        <Field label="終了予定時間" value={draft.endTime} disabled={!canEdit} onChange={(value) => updateDraft("endTime", value)} />
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
