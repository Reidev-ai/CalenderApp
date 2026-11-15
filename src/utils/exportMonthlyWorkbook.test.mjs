import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createMonthlyWorkbook, getMonthExportPeriods } from "./exportMonthlyWorkbook.ts";
import { createWorkbookPreview } from "./workbookPreview.ts";

function task(id, date, patch = {}) {
  return { id, date, endDate: date, siteName: id, content: "作業内容", startTime: "09:00", endTime: "10:00", members: ["佐藤", "鈴木"], contractor: "施工会社", address: "東京都", memo: "", tagColor: "#3b82f6", readBy: [], ...patch };
}

function dayRows(sheet) {
  const days = [];
  sheet.eachRow((row) => {
    const cell = row.getCell(1);
    if (cell.address === cell.master.address && cell.value instanceof Date) days.push({ day: cell.value.getUTCDate(), row: row.number });
  });
  return days;
}

test("28/29/30/31-day months always use 1-10, 11-20 and the remaining dates", async () => {
  for (const [year, month, last] of [[2026, 1, 28], [2028, 1, 29], [2026, 3, 30], [2026, 0, 31]]) {
    const workbook = await createMonthlyWorkbook(new Date(year, month, 15), []);
    assert.equal(workbook.worksheets.length, 3);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["1〜10日", "11〜20日", `21〜${last}日`]);
    assert.deepEqual(workbook.worksheets.flatMap((sheet) => dayRows(sheet).map(({ day }) => day)), Array.from({ length: last }, (_, index) => index + 1));
    assert.equal(workbook.worksheets[2].rowCount, 2 + (last - 20) * 4);
    assert.equal(workbook.worksheets[0].getCell("C3").value, null);
  }
});

test("tasks repeat four template rows in time order and share one day label", async () => {
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), [task("later", "2026-01-01"), task("earlier", "2026-01-01", { startTime: "07:05" })]);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("C3").value, "earlier");
  assert.equal(sheet.getCell("C7").value, "later");
  assert.equal(sheet.getCell("A10").master.address, "A3");
  assert.equal(sheet.getCell("A11").value.getUTCDate(), 2);
  assert.equal(sheet.getCell("B3").value, "現場名");
  assert.equal(sheet.getCell("B4").value, "内容");
  assert.equal(sheet.getCell("B5").value, "開始時間");
  assert.equal(sheet.getCell("F5").value, "メンバー");
  assert.equal(sheet.getCell("H5").value, "元請業者");
  assert.equal(sheet.getCell("B6").value, "住所");
  assert.equal(sheet.getCell("C5").value, 425 / 1440);
  assert.equal(sheet.getCell("C5").numFmt, "hh:mm");
  assert.equal(sheet.getCell("G5").value, "佐藤、鈴木");
  assert.equal(sheet.getCell("I5").value, "施工会社");
  assert.equal(sheet.getCell("C6").value, "東京都");
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.printTitlesRow, "1:2");
});

test("all boundary dates go into the correct sheets without duplicates", async () => {
  const dates = [1, 10, 11, 20, 21, 31];
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), dates.map((day) => task(`day-${day}`, `2026-01-${String(day).padStart(2, "0")}`)));
  for (const [index, days] of [[0, [1, 10]], [1, [11, 20]], [2, [21, 31]]]) {
    const sheet = workbook.worksheets[index];
    assert.deepEqual(dayRows(sheet).filter(({ row }) => sheet.getCell(row, 3).value).map(({ day }) => day), days);
  }
});

test("multi-day tasks include month/range crossings but exclude a midnight end date", async () => {
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), [
    task("incoming", "2025-12-31", { endDate: "2026-01-02", endTime: "00:00" }),
    task("cross-range", "2026-01-10", { endDate: "2026-01-11", endTime: "01:00" }),
    task("outgoing", "2026-01-31", { endDate: "2026-02-02" }),
    task("outside", "2026-02-10"),
  ]);
  for (const [sheetIndex, day, name, time] of [[0, 1, "incoming", 0], [0, 10, "cross-range", 9 / 24], [1, 11, "cross-range", 0], [2, 31, "outgoing", 9 / 24]]) {
    const sheet = workbook.worksheets[sheetIndex];
    const { row } = dayRows(sheet).find((entry) => entry.day === day);
    assert.equal(sheet.getCell(row, 3).value, name);
    assert.equal(sheet.getCell(row + 2, 3).value, time);
  }
  assert.equal(workbook.worksheets[0].getCell("C7").value, null);
});

test("long member lists wrap, special characters remain literal, and XLSX reopens", async () => {
  const name = '=HYPERLINK("https://example.invalid","<現場&名称>")';
  const members = Array.from({ length: 20 }, (_, index) => `メンバー${index + 1}`);
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), [task(name, "2026-01-01", { members, content: "作業1\n作業2", contractor: "A&B <会社>" })]);
  const sheet = workbook.worksheets[0];
  assert.ok(sheet.getRow(5).height > 20);
  assert.equal(sheet.getCell("G5").alignment.wrapText, true);
  const bytes = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  assert.equal(reopened.worksheets.length, 3);
  assert.equal(reopened.worksheets[0].getCell("C3").value, name);
  assert.equal(reopened.worksheets[0].getCell("G5").value, members.join("、"));
  assert.equal(reopened.worksheets[0].getCell("I5").value, "A&B <会社>");
  assert.equal(reopened.worksheets[0].getCell("C3").type, ExcelJS.ValueType.String);
  const zip = await JSZip.loadAsync(bytes);
  for (const path of Object.keys(zip.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))) {
    assert.doesNotMatch(await zip.file(path).async("string"), /<f(?:\s|>)/);
  }
});

test("invalid month and oversized text fail explicitly instead of silently truncating", async () => {
  assert.throws(() => getMonthExportPeriods(new Date("invalid")), /正しくありません/);
  await assert.rejects(createMonthlyWorkbook(new Date(2026, 0, 1), [task("too-long", "2026-01-01", { content: "あ".repeat(32768) })]), /長さを超えています/);
});

test("preview reads the same workbook values, date/time formats and merged cells", async () => {
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), [
    task("<現場&名称>", "2026-01-01", { startTime: "07:05", members: ["山田", "田中"] }),
    task("second", "2026-01-01"), task("last", "2026-01-31", { startTime: "23:59" }),
  ]);
  const preview = createWorkbookPreview(workbook);
  assert.deepEqual(preview.map((sheet) => sheet.name), workbook.worksheets.map((sheet) => sheet.name));
  const cell = (sheet, address) => sheet.rows.flatMap((row) => row.cells).find((item) => item.address === address);
  assert.equal(cell(preview[0], "A3").text, "1");
  assert.equal(cell(preview[0], "A3").rowSpan, 8);
  assert.equal(cell(preview[0], "A4"), undefined);
  assert.equal(cell(preview[0], "C3").colSpan, 7);
  assert.equal(cell(preview[0], "C3").text, "<現場&名称>");
  assert.equal(cell(preview[0], "D3"), undefined);
  assert.equal(cell(preview[0], "C5").text, "07:05");
  assert.equal(cell(preview[0], "G5").text, "山田、田中");
  assert.equal(cell(preview[2], "C45").text, "23:59");
  for (const [index, sheet] of preview.entries()) {
    const original = workbook.worksheets[index];
    assert.equal(sheet.rows.length, original.rowCount);
    assert.equal(sheet.height, sheet.rows.reduce((sum, row) => sum + row.height, 0));
    for (const row of sheet.rows) for (const entry of row.cells) {
      const source = original.getCell(entry.address);
      if (typeof source.value === "string") assert.equal(entry.text, source.value);
      assert.equal(source.address, source.master.address);
    }
  }
});

test("preview preserves wrapping height and does not change workbook serialization", async () => {
  const members = Array.from({ length: 20 }, (_, index) => `メンバー${index + 1}`);
  const workbook = await createMonthlyWorkbook(new Date(2026, 1, 1), [task("=literal", "2026-02-01", { members })]);
  const before = JSON.stringify(workbook.model);
  const preview = createWorkbookPreview(workbook);
  assert.equal(JSON.stringify(workbook.model), before);
  assert.equal(preview[0].rows[4].height, workbook.worksheets[0].getRow(5).height * 4 / 3);
  assert.ok(preview[0].rows[4].height > preview[0].rows[3].height);
  assert.equal(preview[0].rows[4].cells.find((cell) => cell.address === "G5").text, members.join("、"));
});

test("comparison export retains three sheets and previews the actual colored, labeled and struck cells", async () => {
  const schedules = [task("add", "2026-01-01"), task("edit", "2026-01-11"), task("old", "2026-01-21")];
  const comparison = { savedAt: "2026-01-01T00:00:00Z", marks: {
    add: { kind: "added", label: "追加", sourceId: "add", fields: [] },
    edit: { kind: "modified", label: "変更", sourceId: "edit", fields: [{ key: "members", label: "メンバー", before: "旧", after: "新" }] },
    old: { kind: "deleted", label: "変更前", sourceId: "old", readonly: true, fields: [] },
  } };
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), schedules, comparison);
  const preview = createWorkbookPreview(workbook);
  assert.equal(workbook.worksheets.length, 3);
  for (const [index, expected, color] of [[0, "【追加】add", "#DCFCE7"], [1, "【変更】edit", "#FEF9C3"], [2, "【変更前】old", "#FEE2E2"]]) {
    const sheet = workbook.worksheets[index];
    assert.equal(sheet.getCell("C3").value, expected);
    assert.match(sheet.getCell("A2").text, /緑:追加 \/ 黄:変更 \/ 赤:削除/);
    const cell = preview[index].rows[2].cells.find(cell => cell.address === "C3");
    assert.equal(cell.text, expected);
    assert.equal(cell.style.backgroundColor, color);
  }
  assert.equal(workbook.worksheets[1].getCell("G5").fill.fgColor.argb, "FFFDE68A");
  assert.equal(preview[2].rows[2].cells.find(cell => cell.address === "C3").style.textDecoration, "line-through");
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(reopened.worksheets[2].getCell("C3").font.strike, true);
  assert.equal(schedules[0].siteName, "add");
});

test("named comparison headers wrap without clipping a 100-character snapshot name", async () => {
  const name = "保存した状態".repeat(20);
  const workbook = await createMonthlyWorkbook(new Date(2026, 0, 1), [], { name, savedAt: "2026-01-01T00:00:00Z", marks: {} });
  for (const sheet of workbook.worksheets) {
    assert.ok(sheet.getCell("A2").text.includes(name));
    assert.ok(sheet.getRow(2).height > 32);
  }
});
