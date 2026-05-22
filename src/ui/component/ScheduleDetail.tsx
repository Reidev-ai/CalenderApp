import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { MemoImage, Schedule, UserRole } from "../../types";

export function ScheduleDetail({
  schedule,
  role,
  currentUserId,
  currentUserName,
  onMarkAsRead,
}: {
  schedule: Schedule;
  role: UserRole;
  currentUserId: string;
  currentUserName: string;
  onMarkAsRead: () => void;
}) {
  const [previewImage, setPreviewImage] = useState<MemoImage | null>(null);
  const isReadByCurrentUser = Boolean((schedule.readByUserIds ?? []).includes(currentUserId) || (currentUserName && schedule.readBy.includes(currentUserName)));

  return (
    <div className="detail-body">
      <h3>{schedule.siteName}</h3>
      <p>{formatScheduleDateRange(schedule)}</p>
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
      {(schedule.memoImages?.length ?? 0) > 0 && (
        <div className="memo-image-grid detail-memo-images">
          {schedule.memoImages?.map((image) => (
            <button className="memo-image-item memo-image-preview-button" key={image.id} type="button" onClick={() => setPreviewImage(image)}>
              <MemoImageElement image={image} />
              <span>{image.name}</span>
            </button>
          ))}
        </div>
      )}
      {previewImage && <MemoImagePreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} />}
      <ReadStatus schedule={schedule} />
      {role === "User" && !isReadByCurrentUser && (
        <button className="primary-button full-width-button" onClick={onMarkAsRead}>確認済みにする</button>
      )}
    </div>
  );
}

export function MemoImagePreviewOverlay({ image, onClose }: { image: MemoImage; onClose: () => void }) {
  return (
    <div className="memo-image-preview-overlay" role="dialog" aria-modal="true" aria-label={`${image.name}のプレビュー`}>
      <button className="memo-image-preview-backdrop" type="button" aria-label="プレビューを閉じる" onClick={onClose} />
      <div className="memo-image-preview-panel">
        <div className="memo-image-preview-head">
          <span>{image.name}</span>
          <button type="button" aria-label="プレビューを閉じる" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <MemoImageElement image={image} />
      </div>
    </div>
  );
}

export function MemoImageElement({ image }: { image: MemoImage }) {
  const [src, setSrc] = useState(image.dataUrl ?? "");

  useEffect(() => {
    if (image.dataUrl || !image.url) {
      setSrc(image.dataUrl ?? "");
      return;
    }

    let active = true;
    let objectUrl = "";
    const token = getStoredAuthToken();

    fetch(`${getApiBaseUrl()}${image.url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((response) => {
        if (!response.ok) throw new Error("画像を読み込めませんでした");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setSrc("");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.dataUrl, image.url]);

  return src ? <img src={src} alt={image.name} /> : <div className="memo-image-placeholder">画像を読み込み中</div>;
}

function getStoredAuthToken() {
  const saved = localStorage.getItem("calender-auth-v1");
  if (!saved) return "";

  try {
    return (JSON.parse(saved) as { token?: string }).token ?? "";
  } catch {
    return "";
  }
}

function getApiBaseUrl() {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (viteEnv?.VITE_API_BASE_URL) return viteEnv.VITE_API_BASE_URL;

  return `http://${window.location.hostname}:8787`;
}

function formatScheduleDateRange(schedule: Schedule) {
  const endDate = schedule.endDate ?? schedule.date;
  return schedule.date === endDate ? schedule.date : `${schedule.date} ~ ${endDate}`;
}

export function ReadStatus({ schedule }: { schedule: Schedule }) {
  return (
    <div className="read-status">
      <strong>既読状況</strong>
      <span>{schedule.readBy.length > 0 ? schedule.readBy.join("、") : "未読"}</span>
    </div>
  );
}
