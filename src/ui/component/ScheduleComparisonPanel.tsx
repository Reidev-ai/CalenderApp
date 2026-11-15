import { useEffect, useRef, useState } from "react";
import { Check, GitCompareArrows, Pencil, Save, Trash2, X } from "lucide-react";
import type { ScheduleBaseline, ScheduleChange, ScheduleChangeKind } from "../../comparisonTypes";
import { ComparisonBadge } from "./ComparisonBadge";

const labels = { added: "追加", modified: "変更", deleted: "削除" };

export function ScheduleComparisonPanel({ baseline, baselines, changes, enabled, loading, blocked, error, focusId, onEnabledChange, onSave, onSelect, onRename, onDelete, onClose }: {
  baseline: ScheduleBaseline | null;
  baselines: ScheduleBaseline[];
  changes: ScheduleChange[];
  enabled: boolean;
  loading: boolean;
  blocked: boolean;
  error: string;
  focusId: string | null;
  onEnabledChange: (value: boolean) => void;
  onSave: (name: string) => Promise<boolean>;
  onSelect: (id: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [renamedValue, setRenamedValue] = useState("");
  const [filter, setFilter] = useState<"all" | ScheduleChangeKind>("all");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!focusId) return;
    setFilter("all");
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "nearest" }), 0);
    return () => window.clearTimeout(timer);
  }, [focusId]);
  useEffect(() => { setConfirming(false); setEditingName(false); }, [baseline?.id]);
  useEffect(() => {
    if (!loading && document.activeElement === document.body) closeRef.current?.focus();
  }, [loading, confirming, editingName, baseline?.id]);
  const visible = changes.filter((change) => filter === "all" || change.kind === filter);
  const save = async () => { if (await onSave(newName)) setNewName(""); };
  const rename = async () => { if (baseline && await onRename(baseline.id, renamedValue)) setEditingName(false); };

  return <>
    <button className="comparison-overlay" aria-label="差分一覧を閉じる" disabled={loading} onClick={onClose} />
    <aside className="comparison-panel" role="dialog" aria-modal="true" aria-label="状態と差分" ref={panelRef} onKeyDown={(event) => {
      if (event.key === "Escape" && !loading) { event.stopPropagation(); if (confirming) setConfirming(false); else if (editingName) setEditingName(false); else onClose(); }
      if (event.key === "Tab") {
        const items = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="drawer-header"><h2><GitCompareArrows size={20} />状態と差分</h2><button ref={closeRef} className="icon-button" aria-label="差分パネルを閉じる" disabled={loading} onClick={onClose}><X size={18} /></button></div>
      <div className="comparison-controls">
        <form className="comparison-save-row" onSubmit={(event) => { event.preventDefault(); if (!blocked && !loading) void save(); }}>
          <label><span>状態名（任意）</span><input aria-label="新しい保存状態の名前" maxLength={100} value={newName} placeholder="名前なし" disabled={loading} onChange={(event) => setNewName(event.target.value)} /></label>
          <button className="primary-button" disabled={blocked || loading} type="submit"><Save size={16} />{loading ? "処理中" : "状態を保存"}</button>
        </form>
        <div className="comparison-baseline-picker">
          <label><span>比較基準（{baselines.length}件）</span><select aria-label="比較する保存状態" value={baseline?.id ?? ""} disabled={!baselines.length || loading} onChange={(event) => void onSelect(event.target.value)}>
            {!baselines.length && <option value="">保存状態なし</option>}
            {baselines.map((item) => <option key={item.id} value={item.id}>{item.name ? `${item.name} / ` : ""}{new Date(item.savedAt).toLocaleString("ja-JP")}</option>)}
          </select></label>
          <button className="icon-button" title="保存状態の名前を変更" aria-label="保存状態の名前を変更" disabled={!baseline || loading || confirming} onClick={() => { setRenamedValue(baseline?.name ?? ""); setEditingName(true); }}><Pencil size={16} /></button>
          <button className="icon-button" title="選択した保存状態を削除" aria-label="選択した保存状態を削除" disabled={!baseline || loading || editingName} onClick={() => setConfirming(true)}><Trash2 size={16} /></button>
        </div>
        {editingName && baseline && <form className="comparison-rename-row" onSubmit={(event) => { event.preventDefault(); if (!loading) void rename(); }}>
          <input aria-label="保存状態の名前" value={renamedValue} maxLength={100} placeholder={new Date(baseline.savedAt).toLocaleString("ja-JP")} disabled={loading} onChange={(event) => setRenamedValue(event.target.value)} autoFocus />
          <button className="icon-button" title="名前を保存" aria-label="保存状態の名前を保存" disabled={loading}><Check size={16} /></button>
          <button type="button" className="icon-button" title="名前の変更をキャンセル" aria-label="名前の変更をキャンセル" disabled={loading} onClick={() => setEditingName(false)}><X size={16} /></button>
        </form>}
        <label className="comparison-toggle"><input type="checkbox" checked={enabled} disabled={!baseline || loading} onChange={(event) => onEnabledChange(event.target.checked)} />差分を色で表示</label>
        {blocked && <p className="comparison-status" role="status">編集中の予定を保存またはキャンセルしてください。</p>}
        {error && <p className="comparison-error" role="alert">{error}</p>}
        {confirming && baseline && <div className="comparison-confirm" role="alert">
          <strong>この保存状態を削除しますか？</strong><p>{baseline.name || new Date(baseline.savedAt).toLocaleString("ja-JP")}<br />この保存状態は元に戻せません。現在の予定や他の保存状態は削除しません。</p>
          <div><button className="secondary-button" disabled={loading} onClick={() => setConfirming(false)}>キャンセル</button><button className="danger-button" disabled={loading} onClick={() => void onDelete(baseline.id).then((deleted) => { if (deleted) setConfirming(false); })}>この保存状態を削除</button></div>
        </div>}
      </div>
      {baseline && <div className="comparison-filter"><select aria-label="差分の種類" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
        <option value="all">すべて（{changes.length}）</option>
        {(["added", "modified", "deleted"] as const).map((kind) => <option key={kind} value={kind}>{labels[kind]}（{changes.filter((change) => change.kind === kind).length}）</option>)}
      </select></div>}
      <div className="comparison-change-list">
        {!baseline ? <p className="comparison-empty">まだ状態を保存していません。</p> : visible.length === 0 ? <p className="comparison-empty">{changes.length ? "該当する差分はありません。" : "保存時点からの変更はありません。"}</p> : visible.map((change) => {
          const task = change.after ?? change.before!;
          return <article key={change.id} className={`comparison-change comparison-${change.kind} ${focusId === change.id ? "is-focused" : ""}`} data-change-id={change.id}>
            <header><ComparisonBadge mark={{ kind: change.kind, label: labels[change.kind], sourceId: change.id, fields: change.fields }} /><strong>{task.siteName || "現場名未設定"}</strong></header>
            <p>{task.date}{task.endDate && task.endDate !== task.date ? ` ~ ${task.endDate}` : ""}　{task.startTime} ~ {task.endTime}</p>
            {change.kind === "modified" ? <div className="comparison-field-list">{change.fields.map((field) => <div className="comparison-field" key={field.key}><strong>{field.label}</strong><div className="comparison-before"><span>−</span><span>{field.before || "（空欄）"}</span></div><div className="comparison-after"><span>+</span><span>{field.after || "（空欄）"}</span></div></div>)}</div> : <dl className="comparison-task-summary">{[["内容", task.content], ["メンバー", task.members.join("、")], ["元請業者", task.contractor], ["住所", task.address], ["メモ", task.memo], ["添付画像", (task.memoImages ?? []).map((image) => image.name).join("、")]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
          </article>;
        })}
      </div>
    </aside>
  </>;
}
