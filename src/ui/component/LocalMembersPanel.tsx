import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, Users, X } from "lucide-react";
import type { AuthUser } from "../../types";
import { requestDesktop } from "../../desktop";

const membersPath = "/api/groups/local-workspace/members";

export function LocalMembersPanel({ members, onRefresh, onClose }: {
  members: AuthUser[]; onRefresh: () => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<AuthUser | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (deleting) confirmationInputRef.current?.focus();
  }, [deleting]);

  async function save(method: string, id?: string, memberName?: string) {
    setBusy(true);
    setError("");
    try {
      await requestDesktop(method, id ? `${membersPath}/${id}` : membersPath, memberName === undefined ? undefined : { name: memberName });
      await onRefresh();
      if (id) setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });
      else setName("");
      setDeleting(null);
      setConfirmation("");
    } catch (error) { setError(error instanceof Error ? error.message : "メンバーを保存できませんでした"); }
    finally { setBusy(false); }
  }

  return <>
    <button className="account-panel-overlay" aria-label="メンバー管理を閉じる" onClick={onClose} />
    <aside className="account-panel local-members-panel" aria-label="メンバー管理">
      <div className="account-panel-header">
        <Users size={24} />
        <h2>メンバー管理</h2>
        <button className="icon-button" title="閉じる" aria-label="メンバー管理を閉じる" onClick={onClose}><X size={18} /></button>
      </div>
      <form className="local-member-add" onSubmit={(event) => { event.preventDefault(); void save("POST", undefined, name); }}>
        <input aria-label="新しいメンバー名" placeholder="メンバー名" value={name} maxLength={100} disabled={busy} onChange={(event) => setName(event.target.value)} />
        <button className="icon-button" title="メンバーを追加" aria-label="メンバーを追加" disabled={busy || !name.trim()}><Plus size={18} /></button>
      </form>
      {error && <p className="account-panel-message" role="alert">{error}</p>}
      {deleting && <form className="local-member-delete" onSubmit={(event) => { event.preventDefault(); if (!busy && (confirmation === deleting.name || confirmation === "DELETE")) void save("DELETE", deleting.id); }}>
        <p>{deleting.name}を登録一覧から削除します。過去のシフトは残ります。</p>
        <label>メンバー名または DELETE<input ref={confirmationInputRef} aria-label="削除確認" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></label>
        <div className="local-member-delete-actions">
          <button className="secondary-button" type="button" onClick={() => { setDeleting(null); setConfirmation(""); }} disabled={busy}>キャンセル</button>
          <button className="danger-button" disabled={busy || (confirmation !== deleting.name && confirmation !== "DELETE")}>削除</button>
        </div>
      </form>}
      <div className="account-member-list">
        {members.map((member) => <form className="local-member-row" key={member.id} onSubmit={(event) => { event.preventDefault(); void save("PATCH", member.id, drafts[member.id] ?? member.name); }}>
          <input aria-label={`${member.name}の名前`} value={drafts[member.id] ?? member.name} maxLength={100} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [member.id]: event.target.value }))} />
          <button className="icon-button" title="名前を保存" aria-label={`${member.name}の名前を保存`} disabled={busy || !drafts[member.id]?.trim() || drafts[member.id] === member.name}><Check size={16} /></button>
          <button type="button" className="icon-button" title="メンバーを削除" aria-label={`${member.name}を削除`} disabled={busy} onClick={() => { setDeleting(member); setConfirmation(""); }}><Trash2 size={16} /></button>
        </form>)}
        {!members.length && <div className="empty-state compact">メンバーはいません</div>}
      </div>
    </aside>
  </>;
}
