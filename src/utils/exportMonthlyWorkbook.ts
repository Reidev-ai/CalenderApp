import type { Border, Cell, Workbook, Worksheet } from "exceljs";
import type { Schedule } from "../types";
import type { CalendarComparison, ComparisonMark } from "../comparisonTypes";

export function getMonthExportPeriods(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new Error("出力する月が正しくありません");
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return [
    { start: 1, end: 10, name: "1〜10日" },
    { start: 11, end: 20, name: "11〜20日" },
    { start: 21, end: lastDay, name: `21〜${lastDay}日` },
  ];
}

const columnWidths = [5.2, 12, 12.2, 12.2, 12.2, 10, 18, 12, 18];
const thin: Partial<Border> = { style: "thin", color: { argb: "FF333333" } };
const medium: Partial<Border> = { style: "medium", color: { argb: "FF333333" } };

function textLines(text: string, width: number) {
  return text.split(/\r\n|\r|\n/).reduce((total, line) => {
    const length = Array.from(line).reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? 2 : 1), 0);
    return total + Math.max(1, Math.ceil(length / width));
  }, 0);
}

function writeText(cell: Cell, value: string, width: number, day: number, label: string) {
  const height = Math.max(20, textLines(value, width - 2) * 15 + 4);
  if (value.length > 32767 || height > 409) {
    throw new Error(`${day}日の「${label}」がExcelの1セルに表示できる長さを超えています。内容を分けてから出力してください。`);
  }
  // Assign strings as values, never formulas, even when user text starts with '='.
  cell.value = value || null;
  const row = cell.worksheet.getRow(Number(cell.row));
  row.height = Math.max(row.height ?? 20, height);
}

function daySchedules(schedules: Schedule[], dateKey: string) {
  return schedules.filter((schedule) => {
    const endDate = schedule.endDate ?? schedule.date;
    return schedule.date <= dateKey && endDate >= dateKey
      && !(dateKey !== schedule.date && dateKey === endDate && schedule.endTime === "00:00");
  }).sort((left, right) => {
    const leftTime = left.date === dateKey ? left.startTime : "00:00";
    const rightTime = right.date === dateKey ? right.startTime : "00:00";
    return leftTime.localeCompare(rightTime) || left.siteName.localeCompare(right.siteName, "ja") || left.id.localeCompare(right.id);
  });
}

function addTaskBlock(sheet: Worksheet, row: number, day: number, dateKey: string, schedule?: Schedule) {
  const labels: Record<string, string> = {
    [`B${row}`]: "現場名", [`B${row + 1}`]: "内容", [`B${row + 2}`]: "開始時間",
    [`F${row + 2}`]: "メンバー", [`H${row + 2}`]: "元請業者", [`B${row + 3}`]: "住所",
  };
  for (let offset = 0; offset < 4; offset++) {
    const targetRow = sheet.getRow(row + offset);
    targetRow.height = 20;
    for (let col = 2; col <= 9; col++) {
      const cell = targetRow.getCell(col);
      cell.font = { name: "游ゴシック", size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    }
  }
  for (const [ref, label] of Object.entries(labels)) sheet.getCell(ref).value = label;
  for (const range of [`C${row}:I${row}`, `C${row + 1}:I${row + 1}`, `C${row + 2}:E${row + 2}`, `C${row + 3}:I${row + 3}`]) sheet.mergeCells(range);
  if (!schedule) return;
  const fullWidth = columnWidths.slice(2).reduce((sum, width) => sum + width, 0);
  writeText(sheet.getCell(`C${row}`), schedule.siteName, fullWidth, day, "現場名");
  writeText(sheet.getCell(`C${row + 1}`), schedule.content, fullWidth, day, "内容");
  writeText(sheet.getCell(`G${row + 2}`), schedule.members.join("、"), columnWidths[6], day, "メンバー");
  writeText(sheet.getCell(`I${row + 2}`), schedule.contractor, columnWidths[8], day, "元請業者");
  writeText(sheet.getCell(`C${row + 3}`), schedule.address, fullWidth, day, "住所");
  const [hours, minutes] = (schedule.date === dateKey ? schedule.startTime : "00:00").split(":").map(Number);
  const timeCell = sheet.getCell(`C${row + 2}`);
  timeCell.value = (hours * 60 + minutes) / 1440;
  timeCell.numFmt = "hh:mm";
}

function colorTaskBlock(sheet: Worksheet, row: number, day: number, mark: ComparisonMark) {
  const colors = { added: "FFDCFCE7", modified: "FFFEF9C3", deleted: "FFFEE2E2" };
  for (let offset = 0; offset < 4; offset++) for (let column = 2; column <= 9; column++) {
    const cell = sheet.getCell(row + offset, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors[mark.kind] } };
  }
  const title = sheet.getCell(row, 3);
  writeText(title, `【${mark.label}】${title.text}`, columnWidths.slice(2).reduce((sum, width) => sum + width, 0), day, "現場名");
  if (mark.readonly) {
    for (const address of [`C${row}`, `C${row + 1}`, `C${row + 2}`, `G${row + 2}`, `I${row + 2}`, `C${row + 3}`]) {
      const cell = sheet.getCell(address);
      cell.font = { ...cell.font, strike: true, color: { argb: "FF991B1B" } };
    }
  } else if (mark.kind === "modified") {
    const fieldCells: Record<string, string> = { siteName: `C${row}`, content: `C${row + 1}`, startTime: `C${row + 2}`, members: `G${row + 2}`, memberIds: `G${row + 2}`, contractor: `I${row + 2}`, address: `C${row + 3}` };
    for (const field of mark.fields) {
      const cell = sheet.getCell(fieldCells[field.key] ?? `C${row}`);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE68A" } };
    }
  }
}

export async function createMonthlyWorkbook(date: Date, schedules: Schedule[], comparison?: CalendarComparison): Promise<Workbook> {
  const periods = getMonthExportPeriods(date);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Calender";
  const year = date.getFullYear();
  const month = date.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  for (const period of periods) {
    const sheet = workbook.addWorksheet(period.name, {
      views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:2" },
    });
    columnWidths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.mergeCells("A1:B1");
    sheet.mergeCells("C1:I1");
    sheet.getCell("A1").value = `${year}年${month + 1}月`;
    sheet.getCell("A1").font = { name: "游ゴシック", size: 14 };
    sheet.getCell("A1").alignment = { vertical: "middle" };
    sheet.getCell("C1").value = "予定表";
    sheet.getCell("C1").font = { name: "游ゴシック", size: 20 };
    sheet.getCell("C1").alignment = { vertical: "middle" };
    sheet.getRow(1).height = 33;
    sheet.getRow(2).height = 19;
    if (comparison) {
      sheet.mergeCells("A2:I2");
      const legend = sheet.getCell("A2");
      legend.value = `基準: ${comparison.name ? `${comparison.name} / ` : ""}${new Date(comparison.savedAt).toLocaleString("ja-JP")}　緑:追加 / 黄:変更 / 赤:削除・変更前`;
      legend.font = { name: "游ゴシック", size: 10 };
      legend.alignment = { vertical: "middle", wrapText: true };
      sheet.getRow(2).height = Math.max(32, textLines(legend.text, columnWidths.reduce((sum, width) => sum + width, 0) - 2) * 15 + 4);
    }
    let row = 3;
    for (let day = period.start; day <= period.end; day++) {
      const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
      const tasks = daySchedules(schedules, dateKey);
      const dayStart = row;
      if (row + Math.max(tasks.length, 1) * 4 - 1 > 1048576) throw new Error("予定がExcelのシート行数の上限を超えています");
      for (const task of tasks.length ? tasks : [undefined]) {
        addTaskBlock(sheet, row, day, dateKey, task);
        const mark = task ? comparison?.marks[task.id] : undefined;
        if (mark) colorTaskBlock(sheet, row, day, mark);
        row += 4;
      }
      sheet.mergeCells(`A${dayStart}:A${row - 1}`);
      const dayCell = sheet.getCell(`A${dayStart}`);
      dayCell.value = new Date(Date.UTC(year, month, day));
      dayCell.numFmt = "d";
      dayCell.font = { name: "游ゴシック", size: 11 };
      dayCell.alignment = { vertical: "middle", horizontal: "center" };
      dayCell.border = { top: medium, bottom: medium, left: thin, right: thin };
      for (let col = 2; col <= 9; col++) {
        const topCell = sheet.getCell(dayStart, col);
        topCell.border = { ...topCell.border, top: medium };
        const bottomCell = sheet.getCell(row - 1, col);
        bottomCell.border = { ...bottomCell.border, bottom: medium };
      }
    }
    sheet.pageSetup.printArea = `A1:I${row - 1}`;
  }
  return workbook;
}
