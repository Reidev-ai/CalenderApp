import { useEffect, useState } from "react";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { UpdateStatus } from "../../updateTypes";

export function DesktopUpdateButton({ blocked, onBlocked }: { blocked: boolean; onBlocked: () => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState("");
  const [requestPending, setRequestPending] = useState(false);

  useEffect(() => {
    const updates = window.calendarDesktop?.updates;
    if (!updates) return;
    let active = true;
    let statusReceived = false;
    const unsubscribe = updates.subscribe((next) => {
      statusReceived = true;
      if (active) setStatus(next);
    });
    void updates.getStatus().then((next) => { if (active && !statusReceived) setStatus(next); }).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, []);

  if (!status || !status.version || ["disabled", "idle", "checking"].includes(status.phase)) return null;
  const working = status.phase === "downloading" || status.phase === "installing";
  const ready = status.phase === "downloaded";
  const label = status.phase === "downloading" ? `更新 ${status.percent ?? 0}%`
    : status.phase === "installing" ? "更新中"
    : ready ? "アプリを再起動して更新"
    : status.phase === "error" ? "更新を再試行" : "更新";

  async function update() {
    const updates = window.calendarDesktop?.updates;
    if (!updates) return;
    if (blocked) { onBlocked(); return; }
    if (working || requestPending) return;
    setMessage("");
    setRequestPending(true);
    try {
      const next = status?.phase === "downloaded" ? await updates.install() : await updates.download();
      setStatus(next);
    } catch {
      setMessage("更新を開始できませんでした。もう一度お試しください。");
    } finally { setRequestPending(false); }
  }

  return <button type="button" className="desktop-update-button" disabled={working || requestPending}
    aria-label={label} title={message || status.message || (ready
      ? blocked ? "編集中の内容を保存またはキャンセルしてから、アプリを再起動して更新してください" : `クリックするとアプリを再起動してv${status.version}へ更新します`
      : `v${status.version}の更新をダウンロードします。完了しても自動では再起動しません`)}
    onClick={() => void update()}>
    {working ? <LoaderCircle size={14} className="desktop-update-spinner" /> : status.phase === "downloaded" ? <RefreshCw size={14} /> : <Download size={14} />}
    <span aria-live="polite">{label}</span>
  </button>;
}
