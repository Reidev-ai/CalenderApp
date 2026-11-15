import { useEffect, useRef, useState } from "react";
import { ImageOff, LoaderCircle, RotateCcw } from "lucide-react";
import type { AuthUser } from "../../types";
import type { WorkbookPreviewSheet } from "../../utils/workbookPreview";

export type CalendarPreviewData = { format: "png"; dataUrl: string } | { format: "xlsx"; sheets: WorkbookPreviewSheet[] };

export function CalendarExportPreview({ data, status, error, members, memberId, disabled, onMemberChange, onRetry }: {
  data: CalendarPreviewData | null;
  status: "loading" | "ready" | "error" | "empty";
  error?: string;
  members: AuthUser[];
  memberId: string;
  disabled: boolean;
  onMemberChange: (id: string) => void;
  onRetry: () => void;
}) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const [zoom, setZoom] = useState("fit");
  const [viewportWidth, setViewportWidth] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setViewportWidth(viewport.clientWidth));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const sheet = data?.format === "xlsx" ? data.sheets[sheetIndex] ?? data.sheets[0] : null;
  const scale = sheet ? zoom === "fit" ? Math.min(1, Math.max(0.1, (viewportWidth - 24) / sheet.width)) : Number(zoom) : 1;

  return <section className="export-preview" aria-label="出力プレビュー" aria-busy={status === "loading"}>
    <div className="export-preview-toolbar">
      <strong>プレビュー</strong>
      {members.length > 0 && <select aria-label="画像プレビューのメンバー" value={memberId} disabled={disabled} onChange={(event) => onMemberChange(event.target.value)}>
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>}
      {sheet && <select aria-label="プレビューの倍率" value={zoom} onChange={(event) => setZoom(event.target.value)}>
        <option value="fit">幅に合わせる</option>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
      </select>}
    </div>
    {data?.format === "xlsx" && <div className="export-sheet-tabs" role="tablist" aria-label="Excelのシート">
      {data.sheets.map((item, index) => <button key={item.name} type="button" role="tab" aria-selected={sheetIndex === index} aria-controls="export-sheet-panel" id={`export-sheet-tab-${index}`} onClick={() => setSheetIndex(index)}>{item.name}</button>)}
    </div>}
    <div className={`export-preview-viewport ${data?.format === "png" ? "is-image" : ""}`} ref={viewportRef}>
      {status === "loading" && <div className="export-preview-message" role="status"><LoaderCircle className="desktop-update-spinner" size={24} /><span>プレビューを作成中</span></div>}
      {status === "empty" && <div className="export-preview-message" role="status"><ImageOff size={24} /><span>メンバーを選択してください</span></div>}
      {status === "error" && <div className="export-preview-message" role="alert"><ImageOff size={24} /><span>{error ?? "プレビューを作成できませんでした"}</span><button className="icon-button" title="プレビューを再作成" aria-label="プレビューを再作成" onClick={onRetry}><RotateCcw size={18} /></button></div>}
      {status === "ready" && data?.format === "png" && <img className="export-preview-image" src={data.dataUrl} alt="カレンダー出力プレビュー" />}
      {status === "ready" && sheet && <div id="export-sheet-panel" role="tabpanel" aria-labelledby={`export-sheet-tab-${sheetIndex}`} className="export-sheet-panel" style={{ width: sheet.width * scale, height: sheet.height * scale }}>
        <table className="export-sheet-table" aria-label={`${sheet.name}の出力内容`} style={{ width: sheet.width, height: sheet.height, transform: `scale(${scale})` }}>
          <colgroup>{sheet.columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <tbody>{sheet.rows.map((row) => <tr key={row.number} style={{ height: row.height }}>{row.cells.map((cell) => <td key={cell.address} data-cell={cell.address} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={cell.style}>{cell.text}</td>)}</tr>)}</tbody>
        </table>
      </div>}
    </div>
  </section>;
}
