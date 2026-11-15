import type { Border, Cell, Workbook } from "exceljs";
import type { CSSProperties } from "react";

export interface WorkbookPreviewCell {
  address: string;
  text: string;
  colSpan: number;
  rowSpan: number;
  style: CSSProperties;
}

export interface WorkbookPreviewSheet {
  name: string;
  width: number;
  height: number;
  columnWidths: number[];
  rows: { number: number; height: number; cells: WorkbookPreviewCell[] }[];
}

function borderStyle(border?: Partial<Border>) {
  if (!border?.style) return "none";
  const width = border.style === "medium" ? 2 : border.style === "thick" ? 3 : 1;
  const color = border.color?.argb?.slice(-6) ?? "333333";
  return `${width}px solid #${color}`;
}

function cellText(cell: Cell) {
  if (cell.value instanceof Date && cell.numFmt === "d") return String(cell.value.getUTCDate());
  if (typeof cell.value === "number" && cell.numFmt === "hh:mm") {
    const minutes = Math.round(cell.value * 1440);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return cell.text;
}

// Read the generated workbook, including its merges and row sizes, rather than
// building a second schedule layout that could drift from the downloaded XLSX.
export function createWorkbookPreview(workbook: Workbook): WorkbookPreviewSheet[] {
  return workbook.worksheets.map((sheet) => {
    const columnWidths = Array.from({ length: sheet.columnCount }, (_, index) => (sheet.getColumn(index + 1).width ?? 8.43) * 7 + 5);
    const rows = Array.from({ length: sheet.rowCount }, (_, index) => {
      const row = sheet.getRow(index + 1);
      const cells: WorkbookPreviewCell[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = row.findCell(column);
        if (!cell) {
          cells.push({ address: `${sheet.getColumn(column).letter}${row.number}`, text: "", colSpan: 1, rowSpan: 1, style: {} });
          continue;
        }
        if (cell.address !== cell.master.address) continue;
        let colSpan = 1;
        let rowSpan = 1;
        if (cell.isMerged) {
          while (column + colSpan <= sheet.columnCount && row.findCell(column + colSpan)?.master.address === cell.address) colSpan++;
          while (row.number + rowSpan <= sheet.rowCount && sheet.findRow(row.number + rowSpan)?.findCell(column)?.master.address === cell.address) rowSpan++;
        }
        cells.push({
          address: cell.address, text: cellText(cell), colSpan, rowSpan,
          style: {
            fontFamily: cell.font?.name ?? "sans-serif",
            fontSize: `${cell.font?.size ?? 11}pt`,
            fontWeight: cell.font?.bold ? 700 : 400,
            color: cell.font?.color?.argb ? `#${cell.font.color.argb.slice(-6)}` : undefined,
            textDecoration: cell.font?.strike ? "line-through" : undefined,
            backgroundColor: cell.fill?.type === "pattern" && cell.fill.fgColor?.argb ? `#${cell.fill.fgColor.argb.slice(-6)}` : undefined,
            textAlign: cell.alignment?.horizontal === "center" ? "center" : cell.alignment?.horizontal === "right" ? "right" : "left",
            verticalAlign: cell.alignment?.vertical === "top" ? "top" : cell.alignment?.vertical === "bottom" ? "bottom" : "middle",
            borderTop: borderStyle(cell.border?.top),
            borderBottom: borderStyle(sheet.getCell(row.number + rowSpan - 1, column).border?.bottom),
            borderLeft: borderStyle(cell.border?.left),
            borderRight: borderStyle(sheet.getCell(row.number, column + colSpan - 1).border?.right),
          },
        });
      }
      return { number: row.number, height: (row.height ?? 15) * 4 / 3, cells };
    });
    return { name: sheet.name, width: columnWidths.reduce((sum, width) => sum + width, 0), height: rows.reduce((sum, row) => sum + row.height, 0), columnWidths, rows };
  });
}
