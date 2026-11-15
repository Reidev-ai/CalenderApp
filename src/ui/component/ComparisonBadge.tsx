import type { CalendarComparison, ComparisonMark } from "../../comparisonTypes";

export function ComparisonBadge({ mark }: { mark?: ComparisonMark }) {
  return mark ? <span className={`comparison-badge comparison-${mark.kind}`}>{mark.label}</span> : null;
}

export function ComparisonLegend({ comparison }: { comparison?: CalendarComparison }) {
  if (!comparison) return null;
  return <div className="comparison-legend" aria-label="差分の凡例">
    <span className="comparison-baseline-label" title={comparison.name}>{comparison.name ? `${comparison.name} / ` : ""}{new Date(comparison.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 基準</span>
    <span className="comparison-badge comparison-added">追加</span>
    <span className="comparison-badge comparison-modified">変更</span>
    <span className="comparison-badge comparison-deleted">削除／変更前</span>
  </div>;
}
