import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { UpdateStatus } from "../../updateTypes";

export function DesktopUpdateButton({ blocked, onBlocked }: { blocked: boolean; onBlocked: () => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState("");
  const [requestPending, setRequestPending] = useState(false);
  const wantsInstall = useRef(false);
  const installRequested = useRef(false);

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

  useEffect(() => {
    if (status?.phase !== "downloaded" || !wantsInstall.current || blocked || installRequested.current) return;
    const updates = window.calendarDesktop?.updates;
    if (!updates) return;
    installRequested.current = true;
    void updates.install().then((next) => {
      if (next.phase === "error") wantsInstall.current = false;
      setStatus(next);
    }).catch(() => {
      setMessage("更新を開始できませんでした。もう一度お試しください。");
      wantsInstall.current = false;
    }).finally(() => { installRequested.current = false; });
  }, [status, blocked]);

  if (!status || !status.version || ["disabled", "idle", "checking"].includes(status.phase)) return null;
  const working = status.phase === "downloading" || status.phase === "installing";
  const waiting = status.phase === "downloaded" && blocked;
  const label = status.phase === "downloading" ? `更新 ${status.percent ?? 0}%`
    : status.phase === "installing" ? "更新中"
    : waiting ? "保存後に更新"
    : status.phase === "downloaded" ? "再起動して更新"
    : status.phase === "error" ? "更新を再試行" : "更新";

  async function update() {
    const updates = window.calendarDesktop?.updates;
    if (!updates) return;
    if (blocked) { onBlocked(); return; }
    if (working || requestPending || installRequested.current) return;
    wantsInstall.current = true;
    setMessage("");
    setRequestPending(true);
    try {
      const next = status?.phase === "downloaded" ? await updates.install() : await updates.download();
      setStatus(next);
      if (next.phase === "error") wantsInstall.current = false;
    } catch {
      wantsInstall.current = false;
      setMessage("更新を開始できませんでした。もう一度お試しください。");
    } finally { setRequestPending(false); }
  }

  return <button type="button" className="desktop-update-button" disabled={working || requestPending}
    aria-label={label} title={message || status.message || (waiting ? "編集内容を保存すると更新・再起動します" : `v${status.version}へ更新し、アプリを再起動します`)}
    onClick={() => void update()}>
    {working ? <LoaderCircle size={14} className="desktop-update-spinner" /> : status.phase === "downloaded" ? <RefreshCw size={14} /> : <Download size={14} />}
    <span aria-live="polite">{label}</span>
  </button>;
}
