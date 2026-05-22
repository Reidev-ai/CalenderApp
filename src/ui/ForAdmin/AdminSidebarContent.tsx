import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, Copy, ImagePlus, Minus, Plus, Trash2, X } from "lucide-react";
import type { MemoImage, Schedule, SidebarMode, Tag, UserRole } from "../../types";
import { MemoImageElement, MemoImagePreviewOverlay, ReadStatus, ScheduleDetail } from "../component/ScheduleDetail";

export function AdminSidebarContent({
  mode,
  role = "Admin",
  selectedSchedule,
  currentUserName,
  tags,
  addressCandidates,
  groupMembers,
  groupMembersError,
  onSaveSchedule,
  onUploadMemoImage,
  onDeleteSchedule,
  onDuplicateSchedule,
  onMarkAsRead,
  onAddTag,
  onUpdateTag,
  onOpenTagContextMenu,
  onDirtyChange,
}: {
  mode: SidebarMode;
  role?: UserRole;
  selectedSchedule: Schedule | null;
  currentUserName: string;
  tags: Tag[];
  addressCandidates: string[];
  groupMembers: string[];
  groupMembersError: string;
  onSaveSchedule: (schedule: Schedule) => Promise<void>;
  onUploadMemoImage: (file: File, onProgress: (progress: number) => void) => Promise<MemoImage>;
  onDeleteSchedule: (scheduleId: string) => void;
  onDuplicateSchedule: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  if (mode === "edit") {
    if (!selectedSchedule) return <EmptyEditorState onDirtyChange={onDirtyChange} />;

    return (
      <ScheduleEditor
        schedule={selectedSchedule}
        currentUserName={currentUserName}
        role={role}
        tags={tags}
        addressCandidates={addressCandidates}
        groupMembers={groupMembers}
        groupMembersError={groupMembersError}
        onAddTag={onAddTag}
        onUpdateTag={onUpdateTag}
        onOpenTagContextMenu={onOpenTagContextMenu}
        onDirtyChange={onDirtyChange}
        onSave={onSaveSchedule}
        onUploadMemoImage={onUploadMemoImage}
        onDelete={onDeleteSchedule}
        onDuplicate={onDuplicateSchedule}
        onMarkAsRead={onMarkAsRead}
      />
    );
  }

  if (!selectedSchedule) return <div className="empty-state">タスクを選択してください</div>;

  return <ScheduleDetail schedule={selectedSchedule} role="Admin" currentUserName={currentUserName} onMarkAsRead={onMarkAsRead} />;
}

function EmptyEditorState({ onDirtyChange }: { onDirtyChange: (isDirty: boolean) => void }) {
  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange]);

  return <div className="empty-state">タスクを選択してください</div>;
}

type MemoImageUploadItem = {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  progress: number;
};

function ScheduleEditor({
  schedule,
  currentUserName,
  role,
  tags,
  addressCandidates,
  groupMembers,
  groupMembersError,
  onAddTag,
  onUpdateTag,
  onOpenTagContextMenu,
  onDirtyChange,
  onSave,
  onUploadMemoImage,
  onDelete,
  onDuplicate,
  onMarkAsRead,
}: {
  schedule: Schedule;
  currentUserName: string;
  role: UserRole;
  tags: Tag[];
  addressCandidates: string[];
  groupMembers: string[];
  groupMembersError: string;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSave: (schedule: Schedule) => Promise<void>;
  onUploadMemoImage: (file: File, onProgress: (progress: number) => void) => Promise<MemoImage>;
  onDelete: (scheduleId: string) => void;
  onDuplicate: (schedule: Schedule) => void;
  onMarkAsRead: () => void;
}) {
  const [draft, setDraft] = useState(schedule);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [memberInput, setMemberInput] = useState("");
  const [customMemberCandidates, setCustomMemberCandidates] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<MemoImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [memoImageUploads, setMemoImageUploads] = useState<MemoImageUploadItem[]>([]);
  const [completedMemoImageIds, setCompletedMemoImageIds] = useState<string[]>([]);
  const canEdit = role === "Admin" || (role === "User" && draft.isPersonal);
  const isReadByCurrentUser = Boolean(currentUserName && draft.readBy.includes(currentUserName));
  const isDirty = JSON.stringify(draft) !== JSON.stringify(schedule);
  const additionalMembers = uniqueMembers([...customMemberCandidates, ...draft.members]).filter((member) => !groupMembers.includes(member));

  useEffect(() => {
    setDraft(schedule);
  }, [schedule]);

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  function updateDraft(field: keyof Schedule, value: string | string[] | boolean | MemoImage[]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function addMemoImages(files: FileList | null) {
    if (!files || !canEdit) return;
    const images = Array.from(files).filter((file) => !file.type || file.type.startsWith("image/"));
    if (images.length === 0) return;

    const uploadItems = images.map((file) => ({
      id: createMemoImageId(),
      file,
      name: file.name || "添付画像",
      previewUrl: URL.createObjectURL(file),
      progress: 0,
    }));
    setMemoImageUploads((current) => [...current, ...uploadItems]);

    for (const uploadItem of uploadItems) {
      try {
        const image = await onUploadMemoImage(uploadItem.file, (fileProgress) => {
          setMemoImageUploads((current) => current.map((item) => (
            item.id === uploadItem.id ? { ...item, progress: fileProgress } : item
          )));
        });

        setMemoImageUploads((current) => current.filter((item) => item.id !== uploadItem.id));
        setCompletedMemoImageIds((current) => [...current, image.id]);
        URL.revokeObjectURL(uploadItem.previewUrl);
        window.setTimeout(() => {
          setCompletedMemoImageIds((current) => current.filter((id) => id !== image.id));
        }, 1000);
        setDraft((current) => ({
          ...current,
          memoImages: [...(current.memoImages ?? []), image],
        }));
      } catch (error) {
        console.error("Failed to upload memo image", error);
        URL.revokeObjectURL(uploadItem.previewUrl);
        setMemoImageUploads((current) => current.filter((item) => item.id !== uploadItem.id));
      }
    }
  }

  function removeMemoImage(imageId: string) {
    setDraft((current) => ({
      ...current,
      memoImages: (current.memoImages ?? []).filter((image) => image.id !== imageId),
    }));
  }

  async function handleSave() {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  function updateDateTimeDraft(field: "date" | "endDate" | "startTime" | "endTime", value: string) {
    setDraft((current) => normalizeDraftDateTime({ ...current, [field]: value }));
  }

  function addMember(member: string) {
    const normalizedMember = member.trim();
    if (!normalizedMember) return;
    if (!groupMembers.includes(normalizedMember)) {
      setCustomMemberCandidates((current) => current.includes(normalizedMember) ? current : [...current, normalizedMember]);
    }
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
            {additionalMembers.length > 0 && (
              <>
                <span className="member-picker-title">追加メンバー</span>
                <div className="member-choice-list">
                  {additionalMembers.map((member) => {
                    const selected = draft.members.includes(member);

                    return (
                      <button type="button" className={`member-choice-button ${selected ? "selected" : ""}`} disabled={!canEdit} key={member} onClick={() => addMember(member)}>
                        {member}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
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
      <AddressField value={draft.address} candidates={addressCandidates} disabled={!canEdit} onChange={(value) => updateDraft("address", value)} />
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
      <div className="field">
        <span className="field-label-row">
          メモ
          <label className={`inline-add-button memo-image-add ${!canEdit ? "disabled" : ""}`}>
            <ImagePlus size={14} />
            画像
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={!canEdit}
              onChange={(event) => {
                void addMemoImages(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </span>
        <textarea
          className="auto-size-textarea"
          value={draft.memo}
          disabled={!canEdit}
          rows={getTextareaRows(draft.memo)}
          onChange={(event) => updateDraft("memo", event.target.value)}
        />
      </div>
      {((draft.memoImages?.length ?? 0) > 0 || memoImageUploads.length > 0) && (
        <div className="memo-image-grid">
          {memoImageUploads.map((upload) => (
            <div className="memo-image-item memo-image-upload-card" key={upload.id}>
              <img src={upload.previewUrl} alt={upload.name} />
              <span>{upload.name}</span>
              <div className="memo-upload-status" aria-label="画像送信中">
                <span className="memo-upload-ring" style={{ "--progress": `${upload.progress}%` } as CSSProperties} />
              </div>
            </div>
          ))}
          {draft.memoImages?.map((image) => (
            <div className="memo-image-item" key={image.id}>
              <button className="memo-image-preview-button" type="button" onClick={() => setPreviewImage(image)}>
                <MemoImageElement image={image} />
                <span>{image.name}</span>
              </button>
              {completedMemoImageIds.includes(image.id) ? (
                <div className="memo-upload-status done" aria-label="画像保存完了">
                  <Check size={14} />
                </div>
              ) : (
                <button type="button" aria-label={`${image.name}を削除`} disabled={!canEdit} onClick={() => removeMemoImage(image.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {previewImage && <MemoImagePreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} />}
      <ReadStatus schedule={draft} />
      <div className="sidebar-actions">
        {isDirty ? (
          <button type="button" className="secondary-button" disabled={saving} onClick={() => setDraft(schedule)}>キャンセル</button>
        ) : (
          <button type="button" className="danger-button" disabled={!canEdit || saving} onClick={() => onDelete(draft.id)}>
            <Trash2 size={16} />
            削除
          </button>
        )}
        <button type="button" className="secondary-button" disabled={!canEdit || saving} onClick={() => onDuplicate(draft)}>
          <Copy size={16} />
          複製
        </button>
        {!isReadByCurrentUser && <button type="button" className="secondary-button" disabled={saving} onClick={onMarkAsRead}>既読</button>}
        <button type="button" className="primary-button" disabled={!canEdit || saving} onClick={() => void handleSave()}>{saving ? "保存中" : "保存"}</button>
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

function AddressField({
  value,
  candidates,
  disabled,
  onChange,
}: {
  value: string;
  candidates: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalizedValue = value.trim().toLowerCase();
  const filteredCandidates = candidates
    .filter((candidate) => {
      if (!normalizedValue) return true;
      return candidate.toLowerCase().includes(normalizedValue);
    })
    .slice(0, 8);

  function selectAddress(address: string) {
    onChange(address);
    setOpen(false);
  }

  return (
    <label className="field address-field">
      <span>住所</span>
      <input
        value={value}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
      />
      {open && !disabled && filteredCandidates.length > 0 && (
        <div className="address-suggestion-list">
          {filteredCandidates.map((address) => (
            <button type="button" key={address} onMouseDown={(event) => event.preventDefault()} onClick={() => selectAddress(address)}>
              {address}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

type DatePart = "year" | "month" | "day";

function DateField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const keyboardInputRef = useRef<HTMLInputElement | null>(null);
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

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    if (!editing) startEditing(selectedPart);

    if (/^\d$/.test(event.key)) {
      if (event.currentTarget === keyboardInputRef.current) return;
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

  function handleTextInput(text: string) {
    const digits = text.replace(/\D/g, "");
    if (!digits) return;
    digits.split("").forEach(handleDigit);
    if (keyboardInputRef.current) keyboardInputRef.current.value = "";
  }

  return (
    <label className="field date-field">
      <span>{label}</span>
      <input
        ref={keyboardInputRef}
        className="date-keyboard-input"
        type="tel"
        defaultValue=""
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        aria-label={`${label}を数字入力`}
        autoComplete="off"
        onFocus={() => startEditing(selectedPart)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const offset = event.clientX - rect.left;
          const nextPart = offset < rect.width / 3 ? "year" : offset < (rect.width * 2) / 3 ? "month" : "day";
          startEditing(nextPart);
        }}
        onInput={(event) => {
          handleTextInput(event.currentTarget.value);
        }}
        onBlur={finishEditing}
        onKeyDown={handleKeyDown}
      />
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
  const keyboardInputRef = useRef<HTMLInputElement | null>(null);
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

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    if (!editing) startEditing(selectedPart);

    if (/^\d$/.test(event.key)) {
      if (event.currentTarget === keyboardInputRef.current) return;
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

  function handleTextInput(text: string) {
    const digits = text.replace(/\D/g, "");
    if (!digits) return;
    digits.split("").forEach(handleDigit);
    if (keyboardInputRef.current) keyboardInputRef.current.value = "";
  }

  return (
    <label className="field time-field">
      <span>{label}</span>
      <input
        ref={keyboardInputRef}
        className="time-keyboard-input"
        type="tel"
        defaultValue=""
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        aria-label={`${label}を数字入力`}
        autoComplete="off"
        onFocus={() => startEditing(selectedPart)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          startEditing(event.clientX - rect.left < rect.width / 2 ? "hour" : "minute");
        }}
        onInput={(event) => {
          handleTextInput(event.currentTarget.value);
        }}
        onBlur={finishEditing}
        onKeyDown={handleKeyDown}
      />
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

function uniqueMembers(members: string[]) {
  return [...new Set(members.map((member) => member.trim()).filter(Boolean))];
}

function getTextareaRows(value: string) {
  return Math.min(12, Math.max(3, value.split("\n").length));
}

function readMemoImage(file: File): Promise<MemoImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: createMemoImageId(),
        name: file.name,
        type: file.type,
        dataUrl: String(reader.result),
        createdAt: new Date().toISOString(),
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function createMemoImageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `memo-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}
