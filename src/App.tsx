import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Download, GripVertical, Menu, PanelRightOpen, Plus, Search, Settings, SlidersHorizontal, Trash2 } from "lucide-react";
import { mockSchedules } from "./mock/mockSchedules";
import type { AuthSession, AuthUser, CalendarViewMode, JoinRequest, Schedule, SidebarMode, Tag, TaskCellPriorityItem, UserRole } from "./types";
import { LoginView } from "./ui/Share/login/LoginView";
import { CalendarDayDesktop, CalendarMonthDesktop, CalendarWeekDesktop } from "./ui/component/CalendarViews";
import { SideBar } from "./ui/component/SideBar";
import { getMonthGridDays, getWeekDays, minutesToTime, timeToMinutes, toDateKey } from "./utils/time";

const fallbackMaxVisibleColumns = 3;
const currentMember = "佐藤";
const storageKey = "calender-schedules-v1";
const trashStorageKey = "calender-trash-v1";
const tagStorageKey = "calender-tags-v1";
const offlineStorageKey = "calender-offline-cache-v1";
const authStorageKey = "calender-auth-v1";
type CaptureTarget = "current" | "members";
type SearchSort = "dateAsc" | "dateDesc" | "updatedDesc" | "siteName";
const defaultTaskCellPriority: TaskCellPriorityItem[] = [
  { id: "time", label: "開始予定時間" },
  { id: "siteName", label: "現場名" },
  { id: "members", label: "メンバー" },
  { id: "contractor", label: "元請け業者" },
  { id: "address", label: "住所" },
  { id: "memo", label: "メモ" },
];
const defaultTags: Tag[] = [
  { id: "blue", name: "通常", color: "#3b82f6" },
  { id: "green", name: "確認", color: "#22c55e" },
  { id: "orange", name: "注意", color: "#f97316" },
  { id: "red", name: "重要", color: "#ef4444" },
  { id: "purple", name: "夜間", color: "#a855f7" },
  { id: "teal", name: "調査", color: "#14b8a6" },
];

export default function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    const saved = localStorage.getItem(authStorageKey);
    return saved ? (JSON.parse(saved) as AuthSession) : null;
  });
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? (JSON.parse(saved) as Schedule[]) : mockSchedules;
  });
  const [trashSchedules, setTrashSchedules] = useState<Schedule[]>(() => {
    const saved = localStorage.getItem(trashStorageKey);
    return saved ? (JSON.parse(saved) as Schedule[]) : [];
  });
  const [tags, setTags] = useState<Tag[]>(() => {
    const saved = localStorage.getItem(tagStorageKey);
    return saved ? (JSON.parse(saved) as Tag[]) : defaultTags;
  });
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(mockSchedules[0]?.id ?? null);
  const [draftNewSchedule, setDraftNewSchedule] = useState<Schedule | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [settingOpen, setSettingOpen] = useState(false);
  const [capturePanelOpen, setCapturePanelOpen] = useState(false);
  const [captureRendering, setCaptureRendering] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>("current");
  const [captureSchedules, setCaptureSchedules] = useState<Schedule[] | null>(null);
  const [selectedCaptureUserIds, setSelectedCaptureUserIds] = useState<string[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("edit");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [overlapList, setOverlapList] = useState<Schedule[]>([]);
  const [anchorDate, setAnchorDate] = useState(() => new Date("2026-05-11T09:00:00"));
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const role = authSession?.user.role ?? "Guest";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSort, setSearchSort] = useState<SearchSort>("dateAsc");
  const [memberFilters, setMemberFilters] = useState<string[]>([]);
  const [groupUsers, setGroupUsers] = useState<AuthUser[]>([]);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupMembersError, setGroupMembersError] = useState("");
  const [apiMessage, setApiMessage] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [dirtyEditor, setDirtyEditor] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [maxVisibleColumns, setMaxVisibleColumns] = useState(fallbackMaxVisibleColumns);
  const [taskCellPriority, setTaskCellPriority] = useState<TaskCellPriorityItem[]>(defaultTaskCellPriority);
  const [tagContextMenu, setTagContextMenu] = useState<{ tag: Tag; x: number; y: number } | null>(null);
  const now = useCurrentTime();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const captureStageRef = useRef<HTMLDivElement | null>(null);
  const weekDates = useMemo(() => getWeekDays(anchorDate), [anchorDate]);
  const monthDates = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);
  const selectedSchedule = draftNewSchedule ?? schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null;
  const allMembers = useMemo(() => [...new Set(schedules.flatMap((schedule) => schedule.members))].sort(), [schedules]);
  const allTags = useMemo(() => tags, [tags]);
  const visibleSchedules = useMemo(
    () => filterSchedulesByUi(schedules, role, searchQuery, memberFilters, tagFilters),
    [schedules, role, searchQuery, memberFilters, tagFilters],
  );
  const unreadSchedules = useMemo(
    () => visibleSchedules.filter((schedule) => !schedule.readBy.includes(authSession?.user.name ?? currentMember)),
    [authSession?.user.name, visibleSchedules],
  );
  const unreadChangeSchedules = useMemo(
    () => visibleSchedules.filter((schedule) => !(schedule.changeReadBy ?? []).includes(authSession?.user.id ?? "")),
    [authSession?.user.id, visibleSchedules],
  );
  const confirmedChangeSchedules = useMemo(
    () => visibleSchedules.filter((schedule) => (schedule.changeReadBy ?? []).includes(authSession?.user.id ?? "")),
    [authSession?.user.id, visibleSchedules],
  );
  const searchActive = searchQuery.trim() !== "" || memberFilters.length > 0 || tagFilters.length > 0;

  useEffect(() => {
    if (authSession) {
      localStorage.setItem(authStorageKey, JSON.stringify(authSession));
    } else {
      localStorage.removeItem(authStorageKey);
    }
  }, [authSession]);

  useEffect(() => {
    if (!authSession) return;

    void refreshGroupMembers(authSession.user.groupId);
    void refreshServerData();
  }, [authSession?.user.groupId]);

  useEffect(() => {
    const selectableUsers = groupUsers.filter((user) => user.role !== "Guest");
    setSelectedCaptureUserIds((current) => {
      const validIds = new Set(selectableUsers.map((user) => user.id));
      const kept = current.filter((id) => validIds.has(id));
      return kept.length > 0 ? kept : selectableUsers.map((user) => user.id);
    });
  }, [groupUsers]);

  async function refreshServerData() {
    setApiMessage("");

    try {
      const [schedulePayload, trashPayload, tagPayload] = await Promise.all([
        getApiJson<{ schedules: Schedule[] }>("/api/schedules"),
        getApiJson<{ schedules: Schedule[] }>("/api/trash"),
        getApiJson<{ tags: Tag[] }>("/api/tags"),
      ]);
      const cache = loadOfflineCache();
      const nextSchedules = cache ? mergeLatestSchedules(schedulePayload.schedules, cache.schedules) : schedulePayload.schedules;
      const nextTrashSchedules = cache ? mergeLatestSchedules(trashPayload.schedules, cache.trashSchedules) : trashPayload.schedules;
      setSchedules(nextSchedules);
      setTrashSchedules(nextTrashSchedules);
      setTags(tagPayload.tags);
      setSelectedScheduleId((current) => current ?? nextSchedules[0]?.id ?? null);
      setOfflineMode(false);
      saveOfflineCache(nextSchedules, nextTrashSchedules, tagPayload.tags);
    } catch (error) {
      const cache = loadOfflineCache();
      if (cache) {
        setSchedules(cache.schedules);
        setTrashSchedules(cache.trashSchedules);
        setTags(cache.tags);
        setOfflineMode(true);
        setApiMessage("オフライン表示中です。APIに接続できないためローカルキャッシュを使っています。");
        return;
      }
      setOfflineMode(true);
      setApiMessage(error instanceof Error ? error.message : "APIからデータを取得できませんでした");
    }
  }

  async function refreshGroupMembers(groupId: string) {
    setGroupMembersError("");
    const fallbackMembers = authSession?.user.name ? [authSession.user.name] : [];
    setGroupMembers((current) => mergeMemberNames(fallbackMembers, current));

    try {
      const payload = await getApiJson<{ users: AuthSession["user"][] }>(`/api/groups/${encodeURIComponent(groupId)}/members`);
      setGroupUsers(payload.users);
      setGroupMembers(mergeMemberNames(fallbackMembers, payload.users.map((user) => user.name)));
    } catch (error) {
      try {
        const payload = await getApiJson<{ joinRequests: JoinRequest[] }>(`/api/join-requests?groupId=${encodeURIComponent(groupId)}`);
        const approvedMembers = payload.joinRequests
          .filter((request) => request.status === "approved")
          .map((request) => request.user?.name)
          .filter((name): name is string => Boolean(name));
        setGroupMembers(mergeMemberNames(fallbackMembers, approvedMembers));
        setGroupUsers([]);
        setGroupMembersError("");
      } catch {
        setGroupMembers((current) => mergeMemberNames(fallbackMembers, current));
        setGroupMembersError(error instanceof Error ? error.message : "グループメンバーを取得できませんでした");
      }
    }
  }

  async function updateGroupMember(userId: string, patch: Partial<Pick<AuthUser, "name" | "role">>) {
    if (!authSession) return;

    try {
      await patchApiJson<{ user: AuthUser }>(`/api/groups/${encodeURIComponent(authSession.user.groupId)}/members/${encodeURIComponent(userId)}`, patch);
      await refreshGroupMembers(authSession.user.groupId);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "メンバーを更新できませんでした");
    }
  }

  async function removeGroupMember(userId: string, memberName: string) {
    if (!authSession) return;
    if (!confirm(`${memberName} を完全に削除します。この操作は取り消せません。続けますか？`)) return;
    const typedName = prompt(`削除するには「${memberName}」と入力してください`);
    if (typedName !== memberName) {
      setApiMessage("入力が一致しなかったため削除を中止しました");
      return;
    }

    try {
      await deleteApiJson<{ user: AuthUser }>(`/api/groups/${encodeURIComponent(authSession.user.groupId)}/members/${encodeURIComponent(userId)}`);
      await refreshGroupMembers(authSession.user.groupId);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "メンバーを削除できませんでした");
    }
  }

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem(trashStorageKey, JSON.stringify(trashSchedules));
  }, [trashSchedules]);

  useEffect(() => {
    localStorage.setItem(tagStorageKey, JSON.stringify(tags));
  }, [tags]);

  useEffect(() => {
    if (role !== "Admin" && !(role === "User" && selectedSchedule?.isPersonal) && sidebarMode === "edit") {
      setSidebarMode("detail");
    }
  }, [role, selectedSchedule?.isPersonal, sidebarMode]);

  function confirmDiscardIfDirty() {
    return (!dirtyEditor && !draftNewSchedule) || confirm("保存していない変更があります。破棄しますか？");
  }

  function openSchedule(schedule: Schedule) {
    if (!confirmDiscardIfDirty()) return;
    setDraftNewSchedule(null);
    setSelectedScheduleId(schedule.id);
    setSidebarMode(role === "Admin" || (role === "User" && schedule.isPersonal) ? "edit" : "detail");
    setSidebarOpen(true);
  }

  function openOverlapList(schedules: Schedule[]) {
    if (!confirmDiscardIfDirty()) return;
    setDraftNewSchedule(null);
    setOverlapList(schedules);
    setSidebarMode("overlapList");
    setSidebarOpen(true);
  }

  function changeSidebarMode(mode: SidebarMode) {
    if (mode === "overlapList") {
      if (!confirmDiscardIfDirty()) return;
      setOverlapList(getCurrentViewSchedules());
    }
    if (mode !== "edit") setDraftNewSchedule(null);
    setSidebarMode(mode);
  }

  function getCurrentViewSchedules() {
    if (viewMode === "month") {
      return visibleSchedules.filter((schedule) => {
        const endDate = schedule.endDate ?? schedule.date;
        const monthStart = toDateKey(monthDates[0]);
        const monthEnd = toDateKey(monthDates[monthDates.length - 1]);
        return schedule.date <= monthEnd && endDate >= monthStart;
      });
    }

    if (viewMode === "week") {
      const weekStart = toDateKey(weekDates[0]);
      const weekEnd = toDateKey(weekDates[weekDates.length - 1]);
      return visibleSchedules.filter((schedule) => {
        const endDate = schedule.endDate ?? schedule.date;
        return schedule.date <= weekEnd && endDate >= weekStart;
      });
    }

    const dayKey = toDateKey(anchorDate);
    return visibleSchedules.filter((schedule) => {
      const endDate = schedule.endDate ?? schedule.date;
      return schedule.date <= dayKey && endDate >= dayKey;
    });
  }

  function moveScheduleByDrag(schedule: Schedule, nextDate: string, nextStartMinutes: number) {
    if (role !== "Admin" && !(role === "User" && schedule.isPersonal && schedule.ownerUserId === authSession?.user.id)) return;
    if (!confirmDiscardIfDirty()) return;

    const original = schedules.find((item) => item.id === schedule.id);
    if (!original) return;

    const durationMinutes = getScheduleDurationMinutes(original);
    const nextStart = Math.max(0, Math.min(1439, nextStartMinutes));
    const nextEndTotal = nextStart + durationMinutes;
    const endDayOffset = Math.floor(nextEndTotal / 1440);
    const endMinutes = nextEndTotal % 1440;
    const nextSchedule = {
      ...original,
      date: nextDate,
      endDate: addDaysToDateKey(nextDate, endDayOffset),
      startTime: minutesToTime(nextStart),
      endTime: minutesToTime(endMinutes),
    };

    void saveSchedule(nextSchedule);
  }

  async function saveSchedule(schedule: Schedule) {
    const normalizedSchedule = normalizeScheduleDateRange({
      ...schedule,
      groupId: schedule.groupId ?? authSession?.user.groupId,
      ownerUserId: schedule.ownerUserId ?? (schedule.isPersonal ? authSession?.user.id : undefined),
      isPersonal: role === "User" ? true : schedule.isPersonal,
    });
    const exists = schedules.some((item) => item.id === normalizedSchedule.id);

    try {
      const payload = exists
        ? await putApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(normalizedSchedule.id)}`, normalizedSchedule)
        : await postApiJson<{ schedule: Schedule }>("/api/schedules", normalizedSchedule);
      setSchedules((current) => {
        const hasSchedule = current.some((item) => item.id === payload.schedule.id);
        return hasSchedule ? current.map((item) => (item.id === payload.schedule.id ? payload.schedule : item)) : [...current, payload.schedule];
      });
      setSelectedScheduleId(payload.schedule.id);
      setDraftNewSchedule(null);
      setSidebarMode("edit");
      setDirtyEditor(false);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "スケジュールを保存できませんでした");
    }
  }

  async function deleteSchedule(scheduleId: string) {
    const target = schedules.find((schedule) => schedule.id === scheduleId);
    if (!target || !confirm("このタスクをゴミ箱に移動しますか？")) return;

    try {
      const payload = await deleteApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(scheduleId)}`);
      setSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
      setTrashSchedules((current) => [payload.schedule, ...current]);
      setSelectedScheduleId(null);
      setDraftNewSchedule(null);
      setDirtyEditor(false);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "スケジュールを削除できませんでした");
    }
  }

  async function restoreSchedule(schedule: Schedule) {
    try {
      const payload = await postApiJson<{ schedule: Schedule }>(`/api/trash/${encodeURIComponent(schedule.id)}/restore`);
      setTrashSchedules((current) => current.filter((item) => item.id !== payload.schedule.id));
      setSchedules((current) => [...current, payload.schedule]);
      setSelectedScheduleId(payload.schedule.id);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "スケジュールを復元できませんでした");
    }
  }

  function duplicateSchedule(schedule: Schedule) {
    if (!confirmDiscardIfDirty()) return;
    const duplicated = {
      ...schedule,
      id: createScheduleId(),
      siteName: `${schedule.siteName} コピー`,
      readBy: [],
    };
    void saveSchedule(duplicated);
  }

  function createNewSchedule() {
    if (role !== "Admin" && role !== "User") return;
    if (!confirmDiscardIfDirty()) return;
    const dateKey = selectedDateKey ?? toDateKey(new Date());
    const { startTime, endTime } = getDefaultScheduleTimeRange(new Date());
    const isPersonal = role === "User";
    const schedule: Schedule = {
      id: createScheduleId(),
      groupId: authSession?.user.groupId,
      ownerUserId: isPersonal ? authSession?.user.id : undefined,
      siteName: isPersonal ? "個人タスク" : "新規現場",
      content: "",
      date: dateKey,
      endDate: dateKey,
      startTime,
      endTime,
      members: isPersonal && authSession?.user.name ? [authSession.user.name] : [],
      contractor: "",
      address: "",
      memo: "",
      tagColor: "#3b82f6",
      tagColors: ["#3b82f6"],
      readBy: [],
      isPersonal,
    };
    setDraftNewSchedule(schedule);
    setSelectedScheduleId(schedule.id);
    setSidebarMode("edit");
    setDirtyEditor(true);
    setSidebarOpen(true);
  }

  async function markSelectedAsRead() {
    if (!selectedSchedule) return;
    try {
      const payload = await postApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(selectedSchedule.id)}/read`, { member: authSession?.user.name ?? currentMember });
      setSchedules((current) => current.map((schedule) => (schedule.id === payload.schedule.id ? payload.schedule : schedule)));
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "既読にできませんでした");
    }
  }

  async function markScheduleChangeAsRead(schedule: Schedule) {
    try {
      const payload = await postApiJson<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(schedule.id)}/change-read`);
      setSchedules((current) => current.map((item) => (item.id === payload.schedule.id ? payload.schedule : item)));
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "変更通知を確認済みにできませんでした");
    }
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      setSidebarWidth(Math.min(620, Math.max(300, nextWidth)));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  async function addTag() {
    try {
      const payload = await postApiJson<{ tag: Tag }>("/api/tags", { id: createScheduleId(), name: "新しいタグ", color: "#64748b" });
      setTags((current) => [...current, payload.tag]);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "タグを追加できませんでした");
    }
  }

  async function updateTag(tagId: string, patch: Partial<Tag>) {
    try {
      const payload = await patchApiJson<{ tag: Tag }>(`/api/tags/${encodeURIComponent(tagId)}`, patch);
      setTags((current) => current.map((tag) => (tag.id === tagId ? payload.tag : tag)));
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "タグを更新できませんでした");
    }
  }

  function openTagContextMenu(tag: Tag, x: number, y: number) {
    setTagContextMenu({ tag, x, y });
  }

  async function deleteTag(tag: Tag) {
    try {
      await deleteApiJson<{ tag: Tag }>(`/api/tags/${encodeURIComponent(tag.id)}`);
      setTags((current) => current.filter((item) => item.id !== tag.id));
      setSchedules((current) => current.map((schedule) => removeTagFromSchedule(schedule, tag.color)));
      setTrashSchedules((current) => current.map((schedule) => removeTagFromSchedule(schedule, tag.color)));
      setTagFilters((current) => current.filter((color) => color !== tag.color));
      setTagContextMenu(null);
      setApiMessage("");
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "タグを削除できませんでした");
    }
  }

  function moveAnchor(step: number) {
    setAnchorDate((current) => {
      const next = new Date(current);
      if (viewMode === "month") next.setMonth(next.getMonth() + step);
      if (viewMode === "week") next.setDate(next.getDate() + step * 7);
      if (viewMode === "day") next.setDate(next.getDate() + step);
      return next;
    });
  }

  function selectDate(dateKey: string) {
    if (!confirmDiscardIfDirty()) return;
    setDraftNewSchedule(null);
    setSelectedDateKey(dateKey);
    setAnchorDate(dateKeyToDate(dateKey));
  }

  function changeViewMode(mode: CalendarViewMode) {
    if (selectedDateKey) setAnchorDate(dateKeyToDate(selectedDateKey));
    setViewMode(mode);
  }

  function goToday() {
    const today = new Date();
    setAnchorDate(today);
    setSelectedDateKey(toDateKey(today));
  }

  async function renderCalendarImage(schedulesForCapture: Schedule[]) {
    setCaptureSchedules(schedulesForCapture);
    setCaptureRendering(true);
    await nextAnimationFrame();
    await nextAnimationFrame();

    if (!captureStageRef.current) throw new Error("画像出力の準備ができませんでした");

    return toPng(captureStageRef.current, {
      width: 1920,
      height: 1080,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
  }

  async function downloadCalendarImage() {
    setCaptureLoading(true);

    try {
      const dataUrl = await renderCalendarImage(visibleSchedules);
      downloadDataUrl(dataUrl, `${getCalendarExportBaseName(viewMode, anchorDate)}.png`);
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "画像を作成できませんでした");
    } finally {
      setCaptureRendering(false);
      setCaptureSchedules(null);
      setCaptureLoading(false);
    }
  }

  async function downloadMemberCalendarImages() {
    const selectedIds = new Set(selectedCaptureUserIds);
    const exportUsers = groupUsers.filter((user) => user.role !== "Guest" && selectedIds.has(user.id));
    if (exportUsers.length === 0) {
      setApiMessage("出力対象のメンバーがいません");
      return;
    }

    setCaptureLoading(true);

    try {
      if (exportUsers.length === 1) {
        const user = exportUsers[0];
        const dataUrl = await renderCalendarImage(getSchedulesForMember(user.name));
        downloadDataUrl(dataUrl, `${getCalendarExportBaseName(viewMode, anchorDate)}-${safeFileName(user.name)}.png`);
        return;
      }

      const zip = new JSZip();
      for (const user of exportUsers) {
        const dataUrl = await renderCalendarImage(getSchedulesForMember(user.name));
        zip.file(
          `${getCalendarExportBaseName(viewMode, anchorDate)}-${safeFileName(user.name)}.png`,
          dataUrlToBase64(dataUrl),
          { base64: true },
        );
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${getCalendarExportBaseName(viewMode, anchorDate)}.zip`);
    } catch (error) {
      setApiMessage(error instanceof Error ? error.message : "メンバー別画像を作成できませんでした");
    } finally {
      setCaptureRendering(false);
      setCaptureSchedules(null);
      setCaptureLoading(false);
    }
  }

  function getSchedulesForMember(memberName: string) {
    return visibleSchedules.filter((schedule) => schedule.members.includes(memberName));
  }

  function logout() {
    setAuthSession(null);
    setSelectedScheduleId(null);
    setSidebarMode("detail");
  }

  if (!authSession) {
    return <LoginView onAuthenticated={setAuthSession} />;
  }

  const sidebarTitleButton = (
    <button className="icon-button calendar-title-sidebar-button" aria-label={sidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"} onClick={() => setSidebarOpen((value) => !value)}>
      <PanelRightOpen size={18} />
    </button>
  );

  return (
    <div className="app-shell">
      <TopBar
        viewMode={viewMode}
        role={role}
        searchQuery={searchQuery}
        memberFilters={memberFilters}
        tagFilters={tagFilters}
        members={allMembers}
        tags={allTags}
        unreadCount={unreadChangeSchedules.length}
        userName={authSession.user.name}
        groupId={authSession.user.groupId}
        groupMembers={groupMembers}
        groupUsers={groupUsers}
        groupMembersError={groupMembersError}
        onUpdateGroupMember={updateGroupMember}
        onRemoveGroupMember={removeGroupMember}
        onGroupMembersRefresh={() => refreshGroupMembers(authSession.user.groupId)}
        onOpenSetting={() => setSettingOpen(true)}
        onOpenNotifications={() => setNotificationOpen((value) => !value)}
        onViewModeChange={changeViewMode}
        onLogout={logout}
        onSearchQueryChange={setSearchQuery}
        onMemberFiltersChange={setMemberFilters}
        onTagFiltersChange={setTagFilters}
        onCreateNew={createNewSchedule}
        onToday={goToday}
        onPrevious={() => moveAnchor(-1)}
        onNext={() => moveAnchor(1)}
      />
      <main
        className={`workspace ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}
        style={{ gridTemplateColumns: sidebarOpen ? `minmax(0, 1fr) ${sidebarWidth}px` : "minmax(0, 1fr) 0px" }}
      >
        {(apiMessage || offlineMode) && <div className="api-message-banner">{offlineMode ? "オフライン表示中" : apiMessage}</div>}
        {searchActive && (
          <SearchResultPanel
            schedules={visibleSchedules}
            sort={searchSort}
            onSortChange={setSearchSort}
            onSelectSchedule={openSchedule}
            onClear={() => {
              setSearchQuery("");
              setMemberFilters([]);
              setTagFilters([]);
            }}
          />
        )}
        {notificationOpen && (
          <NotificationPanel
            unreadSchedules={unreadChangeSchedules}
            confirmedSchedules={confirmedChangeSchedules}
            onSelectSchedule={(schedule) => {
              openSchedule(schedule);
              setNotificationOpen(false);
            }}
            onMarkAsRead={(schedule) => {
              void markScheduleChangeAsRead(schedule);
            }}
          />
        )}
        {viewMode === "month" ? (
          <CalendarMonthDesktop
            anchorDate={anchorDate}
            monthDates={monthDates}
            schedules={visibleSchedules}
            role={role}
            taskCellPriority={taskCellPriority}
            selectedDateKey={selectedDateKey}
            titleAction={sidebarTitleButton}
            onSelectDate={selectDate}
            onSelectSchedule={openSchedule}
            onOpenHiddenList={openOverlapList}
            onMoveScheduleDate={(schedule, dateKey) => moveScheduleByDrag(schedule, dateKey, timeToMinutes(schedule.startTime))}
          />
        ) : viewMode === "day" ? (
          <CalendarDayDesktop
            date={anchorDate}
            schedules={visibleSchedules}
            fallbackMaxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
            role={role}
            taskCellPriority={taskCellPriority}
            titleAction={sidebarTitleButton}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
            onMoveSchedule={moveScheduleByDrag}
          />
        ) : (
          <CalendarWeekDesktop
            weekDates={weekDates}
            schedules={visibleSchedules}
            fallbackMaxVisibleColumns={maxVisibleColumns}
            currentMinute={currentMinute}
            role={role}
            taskCellPriority={taskCellPriority}
            titleAction={sidebarTitleButton}
            onSelectSchedule={openSchedule}
            onOpenOverlapList={openOverlapList}
            onMoveSchedule={moveScheduleByDrag}
          />
        )}
        <SideBar
          open={sidebarOpen}
          role={role}
          mode={sidebarMode}
          selectedSchedule={selectedSchedule}
          overlapList={overlapList}
          tags={tags}
          groupMembers={groupMembers}
          groupMembersError={groupMembersError}
          onModeChange={changeSidebarMode}
          onSelectSchedule={openSchedule}
          onSaveSchedule={saveSchedule}
          onDeleteSchedule={deleteSchedule}
          onDuplicateSchedule={duplicateSchedule}
          onMarkAsRead={markSelectedAsRead}
          onAddTag={addTag}
          onOpenTagContextMenu={openTagContextMenu}
          onStartResize={startSidebarResize}
          onDirtyChange={setDirtyEditor}
        />
      </main>
      <SettingDrawer
        open={settingOpen}
        tags={tags}
        taskCellPriority={taskCellPriority}
        trashSchedules={trashSchedules}
        captureLoading={captureLoading}
        onOpenCapturePanel={() => setCapturePanelOpen(true)}
        onTaskCellPriorityChange={setTaskCellPriority}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onRestoreSchedule={restoreSchedule}
        onOpenTagContextMenu={openTagContextMenu}
        onClose={() => setSettingOpen(false)}
      />
      {capturePanelOpen && (
        <CalendarCapturePanel
          viewMode={viewMode}
          anchorDate={anchorDate}
          role={role}
          target={captureTarget}
          memberCount={groupUsers.filter((user) => user.role !== "Guest").length}
          members={groupUsers.filter((user) => user.role !== "Guest")}
          selectedMemberIds={selectedCaptureUserIds}
          loading={captureLoading}
          onTargetChange={setCaptureTarget}
          onSelectedMembersChange={setSelectedCaptureUserIds}
          onDownload={() => {
            if (captureTarget === "members") {
              void downloadMemberCalendarImages();
              return;
            }
            void downloadCalendarImage();
          }}
          onClose={() => setCapturePanelOpen(false)}
        />
      )}
      {captureRendering && (
        <div className="calendar-capture-layer" aria-hidden="true">
          <div className="calendar-capture-stage" ref={captureStageRef}>
            {viewMode === "month" ? (
              <CalendarMonthDesktop
                anchorDate={anchorDate}
                monthDates={monthDates}
                schedules={captureSchedules ?? visibleSchedules}
                role={role}
                taskCellPriority={taskCellPriority}
                selectedDateKey={selectedDateKey}
                onSelectDate={() => undefined}
                onSelectSchedule={() => undefined}
                onOpenHiddenList={() => undefined}
                onMoveScheduleDate={() => undefined}
              />
            ) : viewMode === "day" ? (
              <CalendarDayDesktop
                date={anchorDate}
                schedules={captureSchedules ?? visibleSchedules}
                fallbackMaxVisibleColumns={maxVisibleColumns}
                currentMinute={currentMinute}
                role={role}
                taskCellPriority={taskCellPriority}
                onSelectSchedule={() => undefined}
                onOpenOverlapList={() => undefined}
                onMoveSchedule={() => undefined}
              />
            ) : (
              <CalendarWeekDesktop
                weekDates={weekDates}
                schedules={captureSchedules ?? visibleSchedules}
                fallbackMaxVisibleColumns={maxVisibleColumns}
                currentMinute={currentMinute}
                role={role}
                taskCellPriority={taskCellPriority}
                onSelectSchedule={() => undefined}
                onOpenOverlapList={() => undefined}
                onMoveSchedule={() => undefined}
              />
            )}
          </div>
        </div>
      )}
      {tagContextMenu && (
        <TagContextMenu
          tag={tagContextMenu.tag}
          x={tagContextMenu.x}
          y={tagContextMenu.y}
          onDelete={deleteTag}
          onClose={() => setTagContextMenu(null)}
        />
      )}
    </div>
  );
}

type TopBarProps = {
  viewMode: CalendarViewMode;
  role: UserRole;
  searchQuery: string;
  memberFilters: string[];
  tagFilters: string[];
  members: string[];
  tags: Tag[];
  unreadCount: number;
  userName: string;
  groupId: string;
  groupMembers: string[];
  groupUsers: AuthUser[];
  groupMembersError: string;
  onUpdateGroupMember: (userId: string, patch: Partial<Pick<AuthUser, "name" | "role">>) => void;
  onRemoveGroupMember: (userId: string, memberName: string) => void;
  onGroupMembersRefresh: () => void;
  onOpenSetting: () => void;
  onOpenNotifications: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onLogout: () => void;
  onSearchQueryChange: (query: string) => void;
  onMemberFiltersChange: (members: string[]) => void;
  onTagFiltersChange: (tags: string[]) => void;
  onCreateNew: () => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

function TopBar({
  viewMode,
  role,
  searchQuery,
  memberFilters,
  tagFilters,
  members,
  tags,
  unreadCount,
  userName,
  groupId,
  groupMembers,
  groupUsers,
  groupMembersError,
  onUpdateGroupMember,
  onRemoveGroupMember,
  onGroupMembersRefresh,
  onOpenSetting,
  onOpenNotifications,
  onViewModeChange,
  onLogout,
  onSearchQueryChange,
  onMemberFiltersChange,
  onTagFiltersChange,
  onCreateNew,
  onToday,
  onPrevious,
  onNext,
}: TopBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [joinRequestLoading, setJoinRequestLoading] = useState(false);
  const [joinRequestMessage, setJoinRequestMessage] = useState("");
  const [editingMemberNameById, setEditingMemberNameById] = useState<Record<string, string>>({});
  const hasFilter = memberFilters.length > 0 || tagFilters.length > 0;
  const userInitial = getUserInitial(userName);
  const pendingJoinRequests = joinRequests.filter((request) => request.status === "pending");

  useEffect(() => {
    if (role !== "Admin") return;
    void refreshJoinRequests();
  }, [role, groupId]);

  async function refreshJoinRequests() {
    setJoinRequestLoading(true);
    setJoinRequestMessage("");

    try {
      const payload = await getApiJson<{ joinRequests: JoinRequest[] }>(`/api/join-requests?groupId=${encodeURIComponent(groupId)}`);
      setJoinRequests(payload.joinRequests);
    } catch (error) {
      setJoinRequestMessage(error instanceof Error ? error.message : "承認待ちを取得できませんでした");
    } finally {
      setJoinRequestLoading(false);
    }
  }

  async function approvePendingRequest(requestId: string) {
    setJoinRequestLoading(true);
    setJoinRequestMessage("");

    try {
      await postApiJson(`/api/join-requests/${requestId}/approve`);
      await refreshJoinRequests();
      onGroupMembersRefresh();
    } catch (error) {
      setJoinRequestMessage(error instanceof Error ? error.message : "承認に失敗しました");
    } finally {
      setJoinRequestLoading(false);
    }
  }

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu-button" aria-label="メニュー" onClick={() => setMobileMenuOpen(true)}>
        <Menu size={18} />
      </button>
      <div className="topbar-group topbar-primary-actions">
        <div className="search-root">
          <div className="search-box">
            <Search size={16} />
            <input value={searchQuery} placeholder="検索" onChange={(event) => onSearchQueryChange(event.target.value)} />
          </div>
        </div>
        <div className="filter-menu-root">
          <button className={`secondary-button filter-button ${hasFilter ? "active-filter" : ""}`} onClick={() => setFilterOpen((value) => !value)}>
            <SlidersHorizontal size={16} />
            <span className="button-label">フィルター</span>
          </button>
          {filterOpen && (
            <div className="filter-popover">
              <div className="filter-field">
                <span>メンバー</span>
                <div className="filter-check-list">
                  {members.map((member) => (
                    <label className="filter-check-item" key={member}>
                      <input
                        type="checkbox"
                        checked={memberFilters.includes(member)}
                        onChange={() => onMemberFiltersChange(toggleListValue(memberFilters, member))}
                      />
                      <span>{member}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="filter-field">
                <span>タグ</span>
                <div className="filter-check-list">
                  {tags.map((tag) => (
                    <label className="filter-check-item" key={tag.id}>
                      <input
                        type="checkbox"
                        checked={tagFilters.includes(tag.color)}
                        onChange={() => onTagFiltersChange(toggleListValue(tagFilters, tag.color))}
                      />
                      <span className="tag-preview-dot" style={{ background: tag.color }} />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <button className="icon-button" aria-label="設定" onClick={onOpenSetting}>
          <Settings size={18} />
        </button>
        <button className="icon-button notification-button" aria-label="通知" onClick={onOpenNotifications}>
          <Bell size={18} />
          {unreadCount > 0 && <span className="notification-dot" />}
        </button>
        {(role === "Admin" || role === "User") && (
          <button className="primary-button" onClick={onCreateNew}>
            <Plus size={16} />
            <span className="button-label">新規作成</span>
          </button>
        )}
      </div>
      <div className="topbar-group">
        <div className="segmented-control" aria-label="表示切替">
          <button className={viewMode === "month" ? "active" : ""} onClick={() => onViewModeChange("month")}>月</button>
          <button className={viewMode === "week" ? "active" : ""} onClick={() => onViewModeChange("week")}>週</button>
          <button className={viewMode === "day" ? "active" : ""} onClick={() => onViewModeChange("day")}>日</button>
        </div>
        <label className="view-mode-select" aria-label="表示切替">
          <select value={viewMode} onChange={(event) => onViewModeChange(event.target.value as CalendarViewMode)}>
            <option value="month">月</option>
            <option value="week">週</option>
            <option value="day">日</option>
          </select>
        </label>
        <button className="secondary-button" onClick={onToday}>
          <CalendarDays size={16} />
          <span className="today-button-label">今日</span>
        </button>
        <button className="icon-button" aria-label="前へ" onClick={onPrevious}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-button" aria-label="次へ" onClick={onNext}>
          <ChevronRight size={18} />
        </button>
        <button className="account-avatar-button" aria-label="アカウント" onClick={() => setAccountPanelOpen(true)}>
          {userInitial}
          {pendingJoinRequests.length > 0 && <span className="account-pending-badge">{pendingJoinRequests.length}</span>}
        </button>
      </div>
      {accountPanelOpen && (
        <>
          <button className="account-panel-overlay" aria-label="アカウントパネルを閉じる" onClick={() => setAccountPanelOpen(false)} />
          <aside className="account-panel">
            <div className="account-panel-header">
              <div className="account-avatar-large">{userInitial}</div>
              <div className="account-panel-user">
                <h2>{userName}</h2>
                <p>{role}</p>
              </div>
              <button className="icon-button" aria-label="アカウントパネルを閉じる" onClick={() => setAccountPanelOpen(false)}>×</button>
            </div>
            <div className="account-panel-section">
              <h3>グループ</h3>
              <div className="account-info-row">
                <span>グループID</span>
                <strong>{groupId}</strong>
              </div>
              <div className="account-member-list">
                {groupUsers.length > 0 ? (
                  groupUsers.map((member) => {
                    const draftName = editingMemberNameById[member.id] ?? member.name;

                    return (
                      <div className="account-member-item editable" key={member.id}>
                        <span className="account-member-avatar">{getUserInitial(member.name)}</span>
                        <input
                          value={draftName}
                          aria-label={`${member.name}の表示名`}
                          onChange={(event) => setEditingMemberNameById((current) => ({ ...current, [member.id]: event.target.value }))}
                          onBlur={() => {
                            if (draftName.trim() && draftName.trim() !== member.name) onUpdateGroupMember(member.id, { name: draftName.trim() });
                          }}
                        />
                        <select value={member.role} onChange={(event) => onUpdateGroupMember(member.id, { role: event.target.value as UserRole })}>
                          <option value="Admin">Admin</option>
                          <option value="User">User</option>
                        </select>
                        <button className="icon-button" aria-label={`${member.name}を削除`} onClick={() => onRemoveGroupMember(member.id, member.name)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })
                ) : groupMembers.length === 0 ? (
                  <div className="empty-state compact">{groupMembersError ? "メンバーを取得できません" : "メンバーはいません"}</div>
                ) : (
                  groupMembers.map((member) => (
                    <div className="account-member-item" key={member}>
                      <span className="account-member-avatar">{getUserInitial(member)}</span>
                      <span>{member}</span>
                    </div>
                  ))
                )}
              </div>
              {groupMembersError && <p className="account-panel-message">{groupMembersError}</p>}
            </div>
            {role === "Admin" && (
              <div className="account-panel-section">
                <div className="account-section-title-row">
                  <h3>承認待ち</h3>
                  <button className="text-button" disabled={joinRequestLoading} onClick={refreshJoinRequests}>更新</button>
                </div>
                {joinRequestMessage && <p className="account-panel-message">{joinRequestMessage}</p>}
                {joinRequestLoading && pendingJoinRequests.length === 0 ? (
                  <div className="empty-state compact">読み込み中</div>
                ) : pendingJoinRequests.length === 0 ? (
                  <div className="empty-state compact">承認待ちはありません</div>
                ) : (
                  <div className="pending-request-list">
                    {pendingJoinRequests.map((request) => (
                      <div className="pending-request-item" key={request.id}>
                        <div className="pending-request-user">
                          <strong>{request.user?.name ?? "名前なし"}</strong>
                          <span>{request.user?.email ?? request.userId}</span>
                        </div>
                        <button className="secondary-button pending-approve-button" disabled={joinRequestLoading} onClick={() => approvePendingRequest(request.id)}>
                          <Check size={15} />
                          承認
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className="danger-button full-width-button logout-button"
              onClick={() => {
                setAccountPanelOpen(false);
                onLogout();
              }}
            >
              ログアウト
            </button>
          </aside>
        </>
      )}
      {mobileMenuOpen && (
        <>
          <button className="mobile-menu-overlay" aria-label="メニューを閉じる" onClick={() => setMobileMenuOpen(false)} />
          <aside className="mobile-action-drawer">
            <div className="mobile-action-header">
              <h2>操作</h2>
              <button className="icon-button" aria-label="メニューを閉じる" onClick={() => setMobileMenuOpen(false)}>×</button>
            </div>
            <label className="mobile-action-search">
              <Search size={16} />
              <input value={searchQuery} placeholder="検索" onChange={(event) => onSearchQueryChange(event.target.value)} />
            </label>
            <div className="mobile-action-section">
              <div className="mobile-action-section-title">
                <SlidersHorizontal size={16} />
                <span>フィルター</span>
              </div>
              <div className="filter-field">
                <span>メンバー</span>
                <div className="filter-check-list">
                  {members.map((member) => (
                    <label className="filter-check-item" key={member}>
                      <input
                        type="checkbox"
                        checked={memberFilters.includes(member)}
                        onChange={() => onMemberFiltersChange(toggleListValue(memberFilters, member))}
                      />
                      <span>{member}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="filter-field">
                <span>タグ</span>
                <div className="filter-check-list">
                  {tags.map((tag) => (
                    <label className="filter-check-item" key={tag.id}>
                      <input
                        type="checkbox"
                        checked={tagFilters.includes(tag.color)}
                        onChange={() => onTagFiltersChange(toggleListValue(tagFilters, tag.color))}
                      />
                      <span className="tag-preview-dot" style={{ background: tag.color }} />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mobile-action-buttons">
              <button
                className="secondary-button full-width-button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenSetting();
                }}
              >
                <Settings size={16} />
                設定
              </button>
              {(role === "Admin" || role === "User") && (
                <button
                  className="primary-button full-width-button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onCreateNew();
                  }}
                >
                  <Plus size={16} />
                  新規作成
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </header>
  );
}

function getUserInitial(name: string) {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName[0].toUpperCase() : "?";
}

function mergeMemberNames(...memberGroups: string[][]) {
  return [...new Set(memberGroups.flat().map((member) => member.trim()).filter(Boolean))];
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.split(",")[1] ?? "";
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_") || "member";
}

async function getApiJson<T>(path: string): Promise<T> {
  return requestApiJson<T>(path, { method: "GET" });
}

async function postApiJson<T>(path: string, body?: unknown): Promise<T> {
  return requestApiJson<T>(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function putApiJson<T>(path: string, body: unknown): Promise<T> {
  return requestApiJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchApiJson<T>(path: string, body: unknown): Promise<T> {
  return requestApiJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteApiJson<T>(path: string): Promise<T> {
  return requestApiJson<T>(path, { method: "DELETE" });
}

async function requestApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const apiBaseUrl = getApiBaseUrl();
  const authToken = getStoredAuthToken();
  const headers = new Headers(init.headers);
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  } catch {
    throw new Error(`APIに接続できません: ${apiBaseUrl}`);
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "API error");
  }

  return payload as T;
}

function getStoredAuthToken() {
  const saved = localStorage.getItem(authStorageKey);
  if (!saved) return "";

  try {
    return (JSON.parse(saved) as AuthSession).token ?? "";
  } catch {
    return "";
  }
}

function getApiBaseUrl() {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (viteEnv?.VITE_API_BASE_URL) return viteEnv.VITE_API_BASE_URL;

  return `http://${window.location.hostname}:8787`;
}

function saveOfflineCache(schedules: Schedule[], trashSchedules: Schedule[], tags: Tag[]) {
  const today = new Date();
  const minDate = new Date(today);
  minDate.setFullYear(minDate.getFullYear() - 1);
  const maxDate = new Date(today);
  maxDate.setFullYear(maxDate.getFullYear() + 2);
  const minKey = toDateKey(minDate);
  const maxKey = toDateKey(maxDate);
  const inRange = (schedule: Schedule) => schedule.date <= maxKey && (schedule.endDate ?? schedule.date) >= minKey;
  localStorage.setItem(offlineStorageKey, JSON.stringify({
    savedAt: new Date().toISOString(),
    schedules: schedules.filter(inRange),
    trashSchedules: trashSchedules.filter(inRange),
    tags,
  }));
}

function loadOfflineCache(): { schedules: Schedule[]; trashSchedules: Schedule[]; tags: Tag[] } | null {
  const saved = localStorage.getItem(offlineStorageKey);
  if (!saved) return null;

  try {
    return JSON.parse(saved) as { schedules: Schedule[]; trashSchedules: Schedule[]; tags: Tag[] };
  } catch {
    return null;
  }
}

function mergeLatestSchedules(serverSchedules: Schedule[], cachedSchedules: Schedule[]) {
  const merged = new Map<string, Schedule>();
  serverSchedules.forEach((schedule) => merged.set(schedule.id, schedule));
  cachedSchedules.forEach((schedule) => {
    const current = merged.get(schedule.id);
    if (!current || getScheduleSavedAt(schedule) > getScheduleSavedAt(current)) {
      merged.set(schedule.id, schedule);
    }
  });

  return [...merged.values()].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
}

function getScheduleSavedAt(schedule: Schedule) {
  return Date.parse(schedule.updatedAt ?? schedule.createdAt ?? "1970-01-01T00:00:00.000Z");
}

function getCalendarExportBaseName(viewMode: CalendarViewMode, anchorDate: Date) {
  if (viewMode === "month") {
    return `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, "0")}`;
  }

  if (viewMode === "week") {
    const week = getWeekDays(anchorDate);
    const start = week[0];
    const end = week[week.length - 1];
    return `${start.getMonth() + 1}月${start.getDate()}日-${end.getMonth() + 1}月${end.getDate()}日`;
  }

  return toDateKey(anchorDate);
}

function NotificationPanel({
  unreadSchedules,
  confirmedSchedules,
  onSelectSchedule,
  onMarkAsRead,
}: {
  unreadSchedules: Schedule[];
  confirmedSchedules: Schedule[];
  onSelectSchedule: (schedule: Schedule) => void;
  onMarkAsRead: (schedule: Schedule) => void;
}) {
  const [confirmedOpen, setConfirmedOpen] = useState(false);

  return (
    <aside className="notification-panel">
      <h2>通知</h2>
      <p>{unreadSchedules.length}件の未確認変更があります</p>
      {unreadSchedules.length === 0 ? (
        <div className="empty-state">通知はありません</div>
      ) : (
        unreadSchedules.map((schedule) => (
          <div className="notification-item" key={schedule.id}>
            <button className="overlap-item" onClick={() => onSelectSchedule(schedule)}>
              <span>{schedule.date} {schedule.startTime}</span>
              <strong>{schedule.siteName}</strong>
              <small>{schedule.members.join("、") || "メンバー未指定"}</small>
            </button>
            <button className="text-button" onClick={() => onMarkAsRead(schedule)}>確認済み</button>
          </div>
        ))
      )}
      <button className="text-button notification-confirmed-toggle" onClick={() => setConfirmedOpen((value) => !value)}>
        確認済みリスト {confirmedOpen ? "閉じる" : "開く"} ({confirmedSchedules.length})
      </button>
      {confirmedOpen && (
        <div className="notification-confirmed-list">
          {confirmedSchedules.length === 0 ? (
            <div className="empty-state compact">確認済みはありません</div>
          ) : (
            confirmedSchedules.map((schedule) => (
              <button className="overlap-item" key={schedule.id} onClick={() => onSelectSchedule(schedule)}>
                <span>{schedule.date} {schedule.startTime}</span>
                <strong>{schedule.siteName}</strong>
                <small>{schedule.members.join("、") || "メンバー未指定"}</small>
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  );
}

function SearchResultPanel({
  schedules,
  sort,
  onSortChange,
  onSelectSchedule,
  onClear,
}: {
  schedules: Schedule[];
  sort: SearchSort;
  onSortChange: (sort: SearchSort) => void;
  onSelectSchedule: (schedule: Schedule) => void;
  onClear: () => void;
}) {
  const sortedSchedules = [...schedules].sort((a, b) => {
    if (sort === "dateDesc") return `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`);
    if (sort === "updatedDesc") return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    if (sort === "siteName") return a.siteName.localeCompare(b.siteName, "ja");
    return `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
  });

  return (
    <aside className="search-result-panel">
      <div className="search-result-head">
        <div>
          <strong>検索結果</strong>
          <span>{sortedSchedules.length}件</span>
        </div>
        <select className="search-sort-select" value={sort} onChange={(event) => onSortChange(event.target.value as SearchSort)}>
          <option value="dateAsc">日時が早い順</option>
          <option value="dateDesc">日時が遅い順</option>
          <option value="updatedDesc">更新が新しい順</option>
          <option value="siteName">現場名順</option>
        </select>
        <button className="text-button" onClick={onClear}>クリア</button>
      </div>
      {sortedSchedules.length === 0 ? (
        <div className="empty-state compact">該当するタスクはありません</div>
      ) : (
        <div className="search-result-list">
          {sortedSchedules.map((schedule) => (
            <button className="search-result-item" key={schedule.id} onClick={() => onSelectSchedule(schedule)}>
              <span>{formatScheduleDateRange(schedule)} {schedule.startTime} ~ {schedule.endTime}</span>
              <strong>{schedule.siteName}</strong>
              <small>{schedule.members.join("、") || "メンバー未指定"}</small>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function TagContextMenu({
  tag,
  x,
  y,
  onDelete,
  onClose,
}: {
  tag: Tag;
  x: number;
  y: number;
  onDelete: (tag: Tag) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button className="context-menu-backdrop" aria-label="タグメニューを閉じる" onClick={onClose} />
      <div className="tag-context-menu" style={{ left: x, top: y }}>
        <div className="tag-context-title">
          <span className="tag-preview-dot" style={{ background: tag.color }} />
          <strong>{tag.name}</strong>
        </div>
        <button className="danger-button" onClick={() => onDelete(tag)}>
          <Trash2 size={15} />
          削除
        </button>
      </div>
    </>
  );
}

function CalendarCapturePanel({
  viewMode,
  anchorDate,
  role,
  target,
  memberCount,
  members,
  selectedMemberIds,
  loading,
  onTargetChange,
  onSelectedMembersChange,
  onDownload,
  onClose,
}: {
  viewMode: CalendarViewMode;
  anchorDate: Date;
  role: UserRole;
  target: CaptureTarget;
  memberCount: number;
  members: AuthUser[];
  selectedMemberIds: string[];
  loading: boolean;
  onTargetChange: (target: CaptureTarget) => void;
  onSelectedMembersChange: (memberIds: string[]) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const selectedCount = target === "members" ? selectedMemberIds.length : memberCount;
  const outputFormatLabel = target === "members" && selectedCount > 1 ? "ZIP" : "PNG";

  return (
    <>
      <button className="capture-panel-overlay" aria-label="画像出力を閉じる" onClick={onClose} />
      <aside className="capture-panel">
        <div className="drawer-header">
          <h2>画像出力</h2>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        <div className="capture-preview-box">
          <div className="capture-preview-ratio">
            <CalendarDays size={34} />
            <strong>1920 × 1080</strong>
            <span>{getViewModeLabel(viewMode)} / {toDateKey(anchorDate)}</span>
          </div>
        </div>
        <div className="capture-option-grid">
          <label className="field">
            <span>出力サイズ</span>
            <select value="fhd" disabled>
              <option value="fhd">FHD 1920×1080</option>
            </select>
          </label>
          <label className="field">
            <span>形式</span>
            <select value={outputFormatLabel.toLowerCase()} disabled>
              <option value="png">PNG</option>
              <option value="zip">ZIP</option>
            </select>
          </label>
          <label className="field">
            <span>出力対象</span>
            <select value={target} onChange={(event) => onTargetChange(event.target.value as CaptureTarget)}>
              <option value="current">現在の表示</option>
              {role === "Admin" && <option value="members">各メンバーごと</option>}
            </select>
          </label>
          <label className="field">
            <span>対象表示</span>
            <select value={viewMode} disabled>
              <option value="month">月表示</option>
              <option value="week">週表示</option>
              <option value="day">日表示</option>
            </select>
          </label>
          <label className="field">
            <span>背景</span>
            <select value="white" disabled>
              <option value="white">白背景</option>
            </select>
          </label>
        </div>
        {target === "members" && (
          <div className="capture-member-select">
            <div className="capture-member-select-head">
              <strong>メンバー別出力</strong>
              <button type="button" className="text-button" onClick={() => onSelectedMembersChange(members.map((member) => member.id))}>全員</button>
            </div>
            <div className="capture-member-list">
              {members.map((member) => (
                <label className="filter-check-item" key={member.id}>
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(member.id)}
                    onChange={() => onSelectedMembersChange(toggleListValue(selectedMemberIds, member.id))}
                  />
                  <span>{member.name}</span>
                </label>
              ))}
            </div>
            <p className="capture-panel-note">
              {selectedCount > 1
                ? `${selectedCount}人分のPNGをZIPにまとめて保存します。`
                : `${selectedCount}人分のPNGを保存します。`}
            </p>
          </div>
        )}
        <div className="capture-panel-actions">
          <button className="secondary-button" onClick={onClose}>閉じる</button>
          <button className="primary-button" disabled={loading || (target === "members" && selectedCount === 0)} onClick={onDownload}>
            <Download size={16} />
            {loading ? "画像を作成中" : `${outputFormatLabel}を保存`}
          </button>
        </div>
      </aside>
    </>
  );
}

function getViewModeLabel(viewMode: CalendarViewMode) {
  if (viewMode === "month") return "月表示";
  if (viewMode === "week") return "週表示";
  return "日表示";
}

function SettingDrawer({
  open,
  tags,
  taskCellPriority,
  trashSchedules,
  captureLoading,
  onOpenCapturePanel,
  onTaskCellPriorityChange,
  onAddTag,
  onUpdateTag,
  onRestoreSchedule,
  onOpenTagContextMenu,
  onClose,
}: {
  open: boolean;
  tags: Tag[];
  taskCellPriority: TaskCellPriorityItem[];
  trashSchedules: Schedule[];
  captureLoading: boolean;
  onOpenCapturePanel: () => void;
  onTaskCellPriorityChange: (priority: TaskCellPriorityItem[]) => void;
  onAddTag: () => void;
  onUpdateTag: (tagId: string, patch: Partial<Tag>) => void;
  onRestoreSchedule: (schedule: Schedule) => void;
  onOpenTagContextMenu: (tag: Tag, x: number, y: number) => void;
  onClose: () => void;
}) {
  const [draggedPriorityIndex, setDraggedPriorityIndex] = useState<number | null>(null);

  function movePriorityItem(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const next = [...taskCellPriority];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    onTaskCellPriorityChange(next);
  }

  return (
    <>
      {open && <button className="drawer-overlay" aria-label="設定を閉じる" onClick={onClose} />}
      <aside className={`setting-drawer ${open ? "open" : ""}`}>
        <div className="drawer-header">
          <h2>設定</h2>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        <button className="secondary-button full-width-button" disabled={captureLoading} onClick={onOpenCapturePanel}>
          <Download size={16} />
          画像出力を開く
        </button>
        <div className="field">
          <span>TaskCell表示優先順位</span>
          <div className="priority-sort-list">
            {taskCellPriority.map((item, index) => (
              <button
                type="button"
                className={`priority-sort-item ${draggedPriorityIndex === index ? "dragging" : ""}`}
                draggable
                key={item.id}
                onDragStart={(event) => {
                  setDraggedPriorityIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedPriorityIndex !== null) movePriorityItem(draggedPriorityIndex, index);
                  setDraggedPriorityIndex(null);
                }}
                onDragEnd={() => setDraggedPriorityIndex(null)}
              >
                <GripVertical size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-section">
          <div className="settings-section-head">
            <h3>タグ</h3>
            <button className="secondary-button" onClick={onAddTag}>
              <Plus size={16} />
              タグを追加
            </button>
          </div>
          {tags.map((tag) => (
            <div
              className="tag-editor-row"
              key={tag.id}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenTagContextMenu(tag, event.clientX, event.clientY);
              }}
            >
              <input
                className="tag-color-input"
                type="color"
                value={tag.color}
                aria-label={`${tag.name}の色`}
                onChange={(event) => onUpdateTag(tag.id, { color: event.target.value })}
              />
              <input
                value={tag.name}
                aria-label="タグ名"
                onChange={(event) => onUpdateTag(tag.id, { name: event.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="settings-section">
          <div className="settings-section-head">
            <h3>ゴミ箱</h3>
            <span className="settings-count-label">{trashSchedules.length}件</span>
          </div>
          {trashSchedules.length === 0 ? (
            <div className="empty-state compact">ゴミ箱は空です</div>
          ) : (
            <div className="settings-trash-list">
              {trashSchedules.map((schedule) => (
                <div className="settings-trash-item" key={schedule.id}>
                  <div>
                    <span>{formatScheduleDateRange(schedule)} {schedule.startTime} ~ {schedule.endTime}</span>
                    <strong>{schedule.siteName}</strong>
                    <small>{schedule.members.join("、") || "メンバー未指定"}</small>
                  </div>
                  <button className="secondary-button" onClick={() => onRestoreSchedule(schedule)}>復元</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function filterSchedulesByUi(
  schedules: Schedule[],
  role: UserRole,
  searchQuery: string,
  memberFilters: string[],
  tagFilters: string[],
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return schedules.filter((schedule) => {
    if (role === "User" && !schedule.members.includes(currentMember) && !schedule.isPersonal) return false;
    if (role === "Guest" && !schedule.members.includes(currentMember)) return false;
    if (memberFilters.length > 0 && !memberFilters.some((member) => schedule.members.includes(member))) return false;
    if (tagFilters.length > 0 && !tagFilters.some((tagColor) => getScheduleTagColors(schedule).includes(tagColor))) return false;
    if (!normalizedQuery) return true;

    return [
      schedule.siteName,
      schedule.content,
      schedule.date,
      schedule.endDate,
      schedule.startTime,
      schedule.endTime,
      schedule.members.join(" "),
      schedule.contractor,
      schedule.address,
      schedule.memo,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

function toggleListValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function getDefaultScheduleTimeRange(date: Date) {
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const nextHourMinutes = Math.floor(currentMinutes / 60 + 1) * 60;
  const startMinutes = nextHourMinutes >= 1440 ? 0 : nextHourMinutes;
  const endMinutes = startMinutes + 60;

  return {
    startTime: minutesToTime(startMinutes),
    endTime: minutesToTime(endMinutes),
  };
}

function getScheduleDurationMinutes(schedule: Schedule) {
  const startDate = dateKeyToDate(schedule.date);
  const endDate = dateKeyToDate(schedule.endDate ?? schedule.date);
  const dayDiff = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  const startMinutes = timeStringToMinutes(schedule.startTime);
  const endMinutes = timeStringToMinutes(schedule.endTime);
  return Math.max(30, dayDiff * 1440 + endMinutes - startMinutes);
}

function timeStringToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = dateKeyToDate(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function dateKeyToDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function createScheduleId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getScheduleTagColors(schedule: Schedule) {
  return schedule.tagColors?.length ? schedule.tagColors : [schedule.tagColor];
}

function normalizeScheduleDateRange(schedule: Schedule): Schedule {
  const normalized = {
    ...schedule,
    endDate: schedule.endDate ?? schedule.date,
    startTime: normalizeTimeString(schedule.startTime),
    endTime: normalizeTimeString(schedule.endTime),
  };

  if (normalized.endDate < normalized.date) {
    return { ...normalized, endDate: normalized.date, endTime: normalized.startTime };
  }

  if (normalized.endDate === normalized.date && timeStringToMinutes(normalized.endTime) < timeStringToMinutes(normalized.startTime)) {
    return { ...normalized, endTime: normalized.startTime };
  }

  return normalized;
}

function normalizeTimeString(time: string) {
  const [rawHour, rawMinute] = time.split(":").map(Number);
  const hour = Math.min(23, Math.max(0, Number.isFinite(rawHour) ? rawHour : 0));
  const minute = Math.min(59, Math.max(0, Number.isFinite(rawMinute) ? rawMinute : 0));
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function formatScheduleDateRange(schedule: Schedule) {
  const endDate = schedule.endDate ?? schedule.date;
  return schedule.date === endDate ? schedule.date : `${schedule.date} ~ ${endDate}`;
}

function removeTagFromSchedule(schedule: Schedule, color: string): Schedule {
  const nextColors = getScheduleTagColors(schedule).filter((tagColor) => tagColor !== color);
  return {
    ...schedule,
    tagColors: nextColors,
    tagColor: nextColors[0] ?? "#3b82f6",
  };
}

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    const intervalId = window.setInterval(updateNow, 60 * 1000);
    updateNow();

    return () => window.clearInterval(intervalId);
  }, []);

  return now;
}
