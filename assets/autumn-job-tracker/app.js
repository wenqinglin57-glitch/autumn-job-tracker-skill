const STORAGE_KEY = "autumn-job-tracker-records-v1";
const DEMO_KEY = "autumn-job-tracker-demo-v1";
const ALERTS_KEY = "autumn-job-tracker-alerts-v1";
const PROFILE_KEY = "autumn-job-tracker-profile-v1";
const EMAIL_HISTORY_KEY = "autumn-job-tracker-email-history-v1";
const EMAIL_SIGNALS_KEY = "autumn-job-tracker-email-signals-v1";
const SCHEDULE_KEY = "autumn-job-tracker-schedule-v1";
const PENDING_CAPTURE_KEY = "autumn-job-tracker-pending-capture-v1";
const IS_EXTENSION = typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

const demoRecords = [
  {
    id: "demo-1",
    enterpriseName: "远山科技",
    enterpriseNameSource: "manual",
    jobTitle: "产品培训生",
    location: "上海",
    appliedDate: "2026-08-03",
    progress: "一面",
    queryUrl: "https://example.com/careers",
    demo: true,
  },
  {
    id: "demo-2",
    enterpriseName: "星河数据",
    enterpriseNameSource: "manual",
    jobTitle: "数据分析师",
    location: "杭州",
    appliedDate: "2026-08-06",
    progress: "笔试",
    queryUrl: "https://example.com/jobs",
    demo: true,
  },
  {
    id: "demo-3",
    enterpriseName: "云帆互联",
    enterpriseNameSource: "manual",
    jobTitle: "运营管培生",
    location: "深圳",
    appliedDate: "2026-08-08",
    progress: "简历筛选",
    queryUrl: "https://example.com/applications",
    demo: true,
  },
];

const elements = {
  recordsBody: document.querySelector("#recordsBody"),
  mobileRecords: document.querySelector("#mobileRecords"),
  archivedRecordsBody: document.querySelector("#archivedRecordsBody"),
  archivedMobileRecords: document.querySelector("#archivedMobileRecords"),
  archivedCount: document.querySelector("#archivedCount"),
  archivedEmpty: document.querySelector("#archivedEmpty"),
  emptyState: document.querySelector("#emptyState"),
  resultCount: document.querySelector("#resultCount"),
  searchInput: document.querySelector("#searchInput"),
  progressFilter: document.querySelector("#progressFilter"),
  totalStat: document.querySelector("#totalStat"),
  weekStat: document.querySelector("#weekStat"),
  activeStat: document.querySelector("#activeStat"),
  interviewStat: document.querySelector("#interviewStat"),
  offerStat: document.querySelector("#offerStat"),
  offerRateStat: document.querySelector("#offerRateStat"),
  focusNextAction: document.querySelector("#focusNextAction"),
  focusDeadline: document.querySelector("#focusDeadline"),
  focusDeadlineHint: document.querySelector("#focusDeadlineHint"),
  focusTodoCount: document.querySelector("#focusTodoCount"),
  focusTodoHint: document.querySelector("#focusTodoHint"),
  recordDialog: document.querySelector("#recordDialog"),
  recordForm: document.querySelector("#recordForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  recordManualHint: document.querySelector("#recordManualHint"),
  recordId: document.querySelector("#recordId"),
  enterpriseName: document.querySelector("#enterpriseName"),
  jobTitle: document.querySelector("#jobTitle"),
  location: document.querySelector("#location"),
  appliedDate: document.querySelector("#appliedDate"),
  progress: document.querySelector("#progress"),
  deadline: document.querySelector("#deadline"),
  queryUrl: document.querySelector("#queryUrl"),
  deleteButton: document.querySelector("#deleteButton"),
  toast: document.querySelector("#toast"),
  demoBanner: document.querySelector("#demoBanner"),
  localNotice: document.querySelector("#localNotice"),
  infoDialog: document.querySelector("#infoDialog"),
  infoDialogTitle: document.querySelector("#infoDialogTitle"),
  infoDialogText: document.querySelector("#infoDialogText"),
  alertsDialog: document.querySelector("#alertsDialog"),
  alertsList: document.querySelector("#alertsList"),
  profileDialog: document.querySelector("#profileDialog"),
  profileForm: document.querySelector("#profileForm"),
  profileName: document.querySelector("#profileName"),
  profilePhone: document.querySelector("#profilePhone"),
  emailFields: document.querySelector("#emailFields"),
  addEmailButton: document.querySelector("#addEmailButton"),
  closeProfileDialog: document.querySelector("#closeProfileDialog"),
  profileDisplayName: document.querySelector("#profileDisplayName"),
  profileDisplayMeta: document.querySelector("#profileDisplayMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  mobileRefreshButton: document.querySelector("#mobileRefreshButton"),
  scheduleTimes: document.querySelector("#scheduleTimes"),
  addScheduleTime: document.querySelector("#addScheduleTime"),
  saveScheduleButton: document.querySelector("#saveScheduleButton"),
  scheduleSummary: document.querySelector("#scheduleSummary"),
  mailHistoryBody: document.querySelector("#mailHistoryBody"),
  mailHistoryCards: document.querySelector("#mailHistoryCards"),
  mailHistoryCount: document.querySelector("#mailHistoryCount"),
  mailHistoryEmpty: document.querySelector("#mailHistoryEmpty"),
  pendingMailPanel: document.querySelector("#pendingMailPanel"),
  pendingMailCount: document.querySelector("#pendingMailCount"),
  pendingMailList: document.querySelector("#pendingMailList"),
  mailSelectionToolbar: document.querySelector("#mailSelectionToolbar"),
  selectAllEmails: document.querySelector("#selectAllEmails"),
  selectedMailCount: document.querySelector("#selectedMailCount"),
  deleteSelectedEmails: document.querySelector("#deleteSelectedEmails"),
  mascotButton: document.querySelector("#mascotButton"),
  mascotImage: document.querySelector("#mascotImage"),
  mascotAlertBadge: document.querySelector("#mascotAlertBadge"),
  mascotTitle: document.querySelector("#mascotTitle"),
  mascotSpeech: document.querySelector("#mascotSpeech"),
  mobileMascotButton: document.querySelector("#mobileMascotButton"),
};

let records = [];
let toastTimer;
let activeProfile = null;
let pendingManualDraft = null;
let pendingCaptureQueue = [];
let emailHistory = [];
let emailSignals = [];
let selectedEmailKeys = new Set();
let latestAlerts = [];

function cleanManualEnterpriseName(value) {
  const name = String(value || "").trim();
  if (/今天你投简历了吗/.test(name)) return "";
  return name;
}

function normalizeManualEnterprise(record) {
  if (!record || typeof record !== "object") return record;
  const currentManual = record.enterpriseNameSource === "manual" ? record.enterpriseName : "";
  const legacyManual = record.companySource === "manual" ? record.company : "";
  const enterpriseName = cleanManualEnterpriseName(currentManual || legacyManual);
  const { company: _company, companySource: _companySource, ...recordWithoutLegacyCompany } = record;
  return {
    ...recordWithoutLegacyCompany,
    enterpriseName,
    enterpriseNameSource: enterpriseName ? "manual" : "",
    ...(record.progress === "未通过" ? {
      archived: true,
      archivedAt: record.archivedAt || record.statusUpdatedAt || record.lastCheckedAt || new Date().toISOString(),
    } : {}),
  };
}

function recordsLikelySame(left, right) {
  const clean = (value) => String(value || "").replace(/[\s（）()·._-]/g, "").toLocaleLowerCase("zh-CN");
  const leftKey = clean(left?.applicationKey);
  const rightKey = clean(right?.applicationKey);
  if (leftKey && rightKey) return leftKey === rightKey;
  const pageIdentity = (value) => {
    try {
      const url = new URL(value || "");
      return `${url.origin}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
    } catch {
      return "";
    }
  };
  const leftPage = pageIdentity(left?.queryUrl);
  const rightPage = pageIdentity(right?.queryUrl);
  return Boolean(clean(left?.jobTitle) && leftPage && clean(left?.jobTitle) === clean(right?.jobTitle) && leftPage === rightPage);
}

function sanitizeRecords(value) {
  if (!Array.isArray(value)) return [];
  const deduplicated = [];
  for (const sourceRecord of value.map(normalizeManualEnterprise)) {
    const duplicateIndex = deduplicated.findIndex((record) => recordsLikelySame(record, sourceRecord));
    if (duplicateIndex < 0) {
      deduplicated.push(sourceRecord);
      continue;
    }
    const previous = deduplicated[duplicateIndex];
    deduplicated[duplicateIndex] = {
      ...sourceRecord,
      ...previous,
      enterpriseName: previous.enterpriseName || sourceRecord.enterpriseName || "",
      enterpriseNameSource: previous.enterpriseName || sourceRecord.enterpriseName ? "manual" : "",
      deadline: previous.deadline || sourceRecord.deadline || "",
      archived: Boolean(previous.archived || sourceRecord.archived || previous.progress === "未通过" || sourceRecord.progress === "未通过"),
      archivedAt: previous.archivedAt || sourceRecord.archivedAt || "",
    };
  }
  return deduplicated;
}

function extensionGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function extensionSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

async function loadRecords() {
  if (IS_EXTENSION) {
    const saved = await extensionGet([STORAGE_KEY, DEMO_KEY]);
    if (Array.isArray(saved[STORAGE_KEY])) {
      const cleanRecords = sanitizeRecords(saved[STORAGE_KEY]);
      if (JSON.stringify(saved[STORAGE_KEY]) !== JSON.stringify(cleanRecords)) {
        await extensionSet({ [STORAGE_KEY]: cleanRecords });
      }
      return cleanRecords;
    }

    if (!saved[DEMO_KEY]) {
      await extensionSet({ [DEMO_KEY]: "shown", [STORAGE_KEY]: demoRecords });
      return [...demoRecords];
    }
    return [];
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const cleanRecords = sanitizeRecords(parsed);
      if (Array.isArray(parsed) && JSON.stringify(parsed) !== JSON.stringify(cleanRecords)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanRecords));
      }
      return cleanRecords;
    } catch {
      return [];
    }
  }

  if (!localStorage.getItem(DEMO_KEY)) {
    localStorage.setItem(DEMO_KEY, "shown");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demoRecords));
    return [...demoRecords];
  }

  return [];
}

function saveRecords() {
  if (IS_EXTENSION) {
    return extensionSet({ [STORAGE_KEY]: records });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return Promise.resolve();
}

function getFilteredRecords() {
  const keyword = elements.searchInput.value.trim().toLocaleLowerCase("zh-CN");
  const progress = elements.progressFilter.value;

  return [...records]
    .filter((record) => !record.archived)
    .filter((record) => {
      const text = `${record.enterpriseName} ${record.jobTitle} ${record.location}`.toLocaleLowerCase("zh-CN");
      return (!keyword || text.includes(keyword)) && (!progress || record.progress === progress);
    })
    .sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "#";
  } catch {
    return "#";
  }
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}.${month}.${day}`;
}

function statusClass(progress) {
  if (["已投递"].includes(progress)) return "status-applied";
  if (["简历筛选"].includes(progress)) return "status-screening";
  if (["测评"].includes(progress)) return "status-test";
  if (["笔试"].includes(progress)) return "status-written";
  if (["一面", "二面", "HR面"].includes(progress)) return "status-interview";
  if (progress === "Offer") return "status-offer";
  if (progress === "已撤回") return "status-withdrawn";
  return "status-rejected";
}

function automationNote(record) {
  if (record.automationStatus === "needs-login") {
    return `<span class="check-note warning">需重新登录</span>`;
  }
  if (record.lastCheckedAt) {
    const checked = new Date(record.lastCheckedAt);
    const label = Number.isNaN(checked.getTime())
      ? "已自动检查"
      : `${String(checked.getMonth() + 1).padStart(2, "0")}.${String(checked.getDate()).padStart(2, "0")} 已检查`;
    return `<span class="check-note">${label}</span>`;
  }
  return "";
}

function formatDateTime(value) {
  if (!value) return "等待通知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderScheduleTimes(times = ["12:00", "18:00"]) {
  const safeTimes = Array.isArray(times) && times.length ? times.slice(0, 5) : ["12:00", "18:00"];
  elements.scheduleTimes.innerHTML = safeTimes
    .map(
      (time) => `<label class="schedule-time-row">
        <span class="sr-only">每日检查时间</span>
        <input type="time" value="${escapeHtml(time)}" required />
        <button class="schedule-remove" type="button" aria-label="删除这个检查时间" ${safeTimes.length === 1 ? "hidden" : ""}>×</button>
      </label>`,
    )
    .join("");
  elements.addScheduleTime.hidden = safeTimes.length >= 5;
}

function currentScheduleTimes() {
  return Array.from(elements.scheduleTimes.querySelectorAll('input[type="time"]'))
    .map((input) => input.value)
    .filter(Boolean);
}

function renderScheduleSummary(times = [], alarms = [], nextRunAt = 0) {
  const nextTimestamp = Number(nextRunAt) || alarms
    .map((alarm) => Number(alarm.scheduledTime || alarm.when || 0))
    .filter((value) => value > Date.now())
    .sort((a, b) => a - b)[0] || 0;
  const timeText = times.length ? times.join("、") : "尚未设置";
  const nextText = nextTimestamp
    ? `；下次 ${new Date(nextTimestamp).toLocaleString("zh-CN", { hour12: false })}`
    : "";
  elements.scheduleSummary.textContent = `每天 ${timeText} 检查招聘网站和已登记邮箱${nextText}`;
}

function emailMatchBadge(item) {
  if (item.matchStatus === "matched") return '<span class="mail-match-badge">已匹配投递</span>';
  if (item.matchStatus === "confirmed") return '<span class="mail-match-badge confirmed">已确认邮件</span>';
  return '<span class="mail-match-badge pending">待确认</span>';
}

function formatHistoryTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "刚刚"
    : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function mailScopeLabel(scope) {
  return {
    inbox: "收件箱",
    spam: "垃圾邮件",
    promotions: "广告／推广",
    all: "全部邮件",
  }[scope] || "全部邮件";
}

function pendingMailSignature(item) {
  if (item.signature) return String(item.signature);
  return `${item.sourceHost || ""}|${item.subject || ""}|${item.date || item.messageDate || ""}|${String(item.snippet || "").slice(0, 120)}`
    .replace(/[\s（）()·._-]/g, "")
    .toLocaleLowerCase("zh-CN");
}

function renderPendingEmails(historyItems = emailHistory, signalItems = emailSignals) {
  const fromHistory = (Array.isArray(historyItems) ? historyItems : []).filter((item) => item.matchStatus === "pending");
  const historySignatures = new Set(fromHistory.map(pendingMailSignature));
  const fromSignals = (Array.isArray(signalItems) ? signalItems : [])
    .filter((item) => !historySignatures.has(pendingMailSignature(item)))
    .map((item) => ({
      ...item,
      matchStatus: "pending",
      lastDetectedAt: item.detectedAt || item.date || new Date().toISOString(),
      messageDate: item.date || "",
    }));
  const pending = [...fromHistory, ...fromSignals]
    .filter((item, index, array) => array.findIndex((candidate) => pendingMailSignature(candidate) === pendingMailSignature(item)) === index)
    .sort((a, b) => String(b.lastDetectedAt || "").localeCompare(String(a.lastDetectedAt || "")))
    .slice(0, 80);

  elements.pendingMailPanel.hidden = pending.length === 0;
  elements.pendingMailCount.textContent = `${pending.length} 封`;
  elements.pendingMailList.innerHTML = pending
    .map((item) => {
      const signature = pendingMailSignature(item);
      return `<article class="pending-mail-item">
        <div class="pending-mail-item-head">
          <strong>${escapeHtml(item.enterpriseName || "企业待确认")}</strong>
          <span>${escapeHtml(formatHistoryTime(item.lastDetectedAt))}</span>
        </div>
        <h3>${escapeHtml(item.subject || "招聘通知")}</h3>
        ${item.snippet ? `<p>${escapeHtml(item.snippet)}</p>` : ""}
        <div class="pending-mail-meta">
          <span>${escapeHtml(item.provider || item.sourceHost || "网页邮箱")}</span>
          <span>${escapeHtml(mailScopeLabel(item.mailScope))}</span>
          ${item.jobTitle ? `<span>${escapeHtml(item.jobTitle)}</span>` : ""}
        </div>
        <div class="pending-mail-actions">
          <button class="pending-mail-dismiss" type="button" data-mail-decision="dismiss" data-mail-signature="${escapeHtml(signature)}">取消</button>
          <button class="pending-mail-confirm" type="button" data-mail-decision="confirm" data-mail-signature="${escapeHtml(signature)}">确认并加入邮件记录</button>
        </div>
      </article>`;
    })
    .join("");
}

function emailSelectionKey(item) {
  const id = String(item?.id ?? "").trim();
  if (id) return `id:${id}`;
  const signature = String(item?.signature ?? "").trim();
  if (signature) return `signature:${signature}`;
  const mailResultKey = String(item?.mailResultKey ?? "").trim();
  const sourceHost = String(item?.sourceHost ?? "").trim().toLowerCase();
  if (mailResultKey) return `result:${sourceHost}|${mailResultKey}`;
  const fallback = `${sourceHost}|${item?.subject || ""}|${item?.messageDate || item?.date || ""}|${item?.lastDetectedAt || ""}`
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s（）()·._-]/g, "");
  return `fallback:${fallback}`;
}

function emailDeletionDescriptor(item) {
  return {
    key: emailSelectionKey(item),
    id: item?.id ?? "",
    signature: item?.signature || "",
    mailResultKey: item?.mailResultKey || "",
    sourceHost: item?.sourceHost || "",
    subject: item?.subject || "",
    messageDate: item?.messageDate || item?.date || "",
    lastDetectedAt: item?.lastDetectedAt || "",
  };
}

function renderEmailHistory(items = emailHistory) {
  emailHistory = Array.isArray(items) ? items : [];
  const acceptedHistory = emailHistory.filter((item) => item.matchStatus !== "pending");
  const availableKeys = new Set(acceptedHistory.map(emailSelectionKey));
  selectedEmailKeys = new Set([...selectedEmailKeys].filter((key) => availableKeys.has(key)));
  const visible = acceptedHistory.slice(0, 100);
  elements.mailHistoryCount.textContent = visible.length
    ? `已记录 ${acceptedHistory.length} 封秋招相关邮件`
    : "还没有抓取到秋招邮件";
  elements.mailHistoryEmpty.hidden = visible.length > 0;
  elements.mailHistoryBody.innerHTML = visible
    .map(
      (item) => `<tr>
        <td><input class="mail-select-checkbox" type="checkbox" data-select-email-key="${escapeHtml(emailSelectionKey(item))}" ${selectedEmailKeys.has(emailSelectionKey(item)) ? "checked" : ""} aria-label="选择邮件：${escapeHtml(item.subject || "招聘通知")}" /></td>
        <td>${escapeHtml(formatHistoryTime(item.lastDetectedAt))}</td>
        <td>${item.mailDetailUrl || item.mailboxUrl ? `<a class="site-link" href="${escapeHtml(safeUrl(item.mailDetailUrl || item.mailboxUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.provider || item.sourceHost || "网页邮箱")} · 打开邮件 ↗</a>` : escapeHtml(item.provider || item.sourceHost || "网页邮箱")}</td>
        <td>${escapeHtml(mailScopeLabel(item.mailScope))}</td>
        <td class="mail-job-cell"><strong>${escapeHtml(item.enterpriseName || "企业待确认")}</strong><small>${escapeHtml(item.jobTitle || "岗位待确认")}</small></td>
        <td class="mail-subject-cell" title="${escapeHtml(item.subject || "招聘通知")}"><strong>${escapeHtml(item.subject || "招聘通知")}</strong>${item.snippet ? `<small>${escapeHtml(item.snippet)}</small>` : ""}</td>
        <td>${emailMatchBadge(item)}${item.progress ? `<small class="mail-stage">${escapeHtml(item.progress)}</small>` : ""}</td>
        <td>${item.deadline ? formatDateTime(item.deadline) : "—"}</td>
        <td><button class="mail-delete-button" type="button" data-delete-email-id="${escapeHtml(item.id || "")}" data-delete-email-signature="${escapeHtml(item.signature || "")}">删除</button></td>
      </tr>`,
    )
    .join("");
  elements.mailHistoryCards.innerHTML = visible
    .map(
      (item) => `<article class="mail-card">
        <div class="mail-card-head"><label class="mail-card-select"><input class="mail-select-checkbox" type="checkbox" data-select-email-key="${escapeHtml(emailSelectionKey(item))}" ${selectedEmailKeys.has(emailSelectionKey(item)) ? "checked" : ""} /><strong>${escapeHtml(item.enterpriseName || "企业待确认")}</strong></label><span class="mail-card-actions">${emailMatchBadge(item)}<button class="mail-delete-button" type="button" data-delete-email-id="${escapeHtml(item.id || "")}" data-delete-email-signature="${escapeHtml(item.signature || "")}">删除</button></span></div>
        <h3>${escapeHtml(item.subject || "招聘通知")}</h3>
        <p>${escapeHtml(item.jobTitle || "岗位待确认")}</p>
        ${item.snippet ? `<p class="mail-card-snippet">${escapeHtml(item.snippet)}</p>` : ""}
        ${item.progress ? `<p>${escapeHtml(item.progress)}</p>` : ""}
        <div class="mail-card-meta"><small>${escapeHtml(item.provider || item.sourceHost || "网页邮箱")} · ${escapeHtml(mailScopeLabel(item.mailScope))}</small><small>${escapeHtml(formatHistoryTime(item.lastDetectedAt))}</small></div>
        ${item.mailDetailUrl || item.mailboxUrl ? `<a class="site-link mail-card-link" href="${escapeHtml(safeUrl(item.mailDetailUrl || item.mailboxUrl))}" target="_blank" rel="noopener noreferrer">打开邮件详情 ↗</a>` : ""}
      </article>`,
    )
    .join("");
  elements.mailSelectionToolbar.hidden = acceptedHistory.length === 0;
  elements.selectedMailCount.textContent = `已选择 ${selectedEmailKeys.size} 封`;
  elements.deleteSelectedEmails.disabled = selectedEmailKeys.size === 0;
  elements.selectAllEmails.checked = acceptedHistory.length > 0 && selectedEmailKeys.size === acceptedHistory.length;
  elements.selectAllEmails.indeterminate = selectedEmailKeys.size > 0 && selectedEmailKeys.size < acceptedHistory.length;
  renderPendingEmails(emailHistory, emailSignals);
}

async function decidePendingEmail(button) {
  const signature = button.dataset.mailSignature || "";
  const decision = button.dataset.mailDecision;
  if (!signature || !["confirm", "dismiss"].includes(decision)) return;
  const card = button.closest(".pending-mail-item");
  const buttons = Array.from(card?.querySelectorAll("button") || []);
  buttons.forEach((item) => { item.disabled = true; });
  let result = null;
  try {
    result = await runtimeMessage({
      type: decision === "confirm" ? "CONFIRM_EMAIL_SIGNAL" : "DISMISS_EMAIL_SIGNAL",
      signature,
    });
  } catch {
    result = null;
  }
  if (!result?.saved) {
    buttons.forEach((item) => { item.disabled = false; });
    showToast("处理失败，请重新打开面板后再试");
    return;
  }
  emailSignals = result.emailSignals || [];
  renderEmailHistory(result.emailHistory || []);
  showToast(decision === "confirm" ? "邮件已加入秋招邮件记录" : "已取消并忽略这封邮件");
}

async function deleteHistoryEmail(button) {
  const id = button.dataset.deleteEmailId || "";
  const signature = button.dataset.deleteEmailSignature || "";
  if (!id && !signature) return;
  if (!window.confirm("确定从秋招邮件记录中删除这封邮件吗？删除后不会在下次刷新时重新加入。")) return;
  button.disabled = true;
  let result = null;
  try {
    result = await runtimeMessage({ type: "DELETE_EMAIL_HISTORY", id, signature });
  } catch {
    result = null;
  }
  if (!result?.deleted) {
    button.disabled = false;
    showToast("删除失败，请重新打开面板后再试");
    return;
  }
  renderEmailHistory(result.emailHistory || []);
  showToast("邮件已从秋招邮件记录中删除");
}

async function deleteSelectedHistoryEmails() {
  const selectedItems = emailHistory
    .filter((item) => item.matchStatus !== "pending" && selectedEmailKeys.has(emailSelectionKey(item)))
    .map(emailDeletionDescriptor);
  if (!selectedItems.length) return;
  if (!window.confirm(`确定删除所选的 ${selectedItems.length} 封邮件吗？删除后不会在下次刷新时重新加入。`)) return;
  elements.deleteSelectedEmails.disabled = true;
  let result = null;
  try {
    result = await runtimeMessage({ type: "DELETE_EMAIL_HISTORY_BULK", items: selectedItems });
  } catch {
    result = null;
  }
  if (!result?.deletedCount) {
    elements.deleteSelectedEmails.disabled = false;
    showToast("批量删除失败，请重新打开面板后再试");
    return;
  }
  selectedEmailKeys.clear();
  renderEmailHistory(result.emailHistory || []);
  showToast(`已删除 ${result.deletedCount} 封邮件`);
}

async function refreshAutomationDashboard() {
  if (!IS_EXTENSION) {
    renderScheduleTimes();
    renderScheduleSummary(["12:00", "18:00"]);
    renderEmailHistory([]);
    renderPendingEmails([], []);
    renderMascot([]);
    return;
  }
  const status = await runtimeMessage({ type: "GET_AUTOMATION_STATUS" });
  const times = status?.scheduleTimes || ["12:00", "18:00"];
  renderScheduleTimes(times);
  renderScheduleSummary(times, status?.alarms || [], status?.nextRunAt || 0);
  emailSignals = Array.isArray(status?.emailSignals) ? status.emailSignals : [];
  renderEmailHistory(status?.emailHistory || []);
  renderMascot(status?.alerts || []);
}

async function saveSchedule() {
  const times = currentScheduleTimes();
  if (!times.length || new Set(times).size !== times.length) {
    showToast("请设置 1–5 个不重复的检查时间");
    return;
  }
  elements.saveScheduleButton.disabled = true;
  let result;
  try {
    result = IS_EXTENSION
      ? await runtimeMessage({ type: "SAVE_SCHEDULE", times })
      : { saved: true, times, alarms: [] };
  } catch {
    result = null;
  } finally {
    elements.saveScheduleButton.disabled = false;
  }
  if (!result?.saved) {
    showToast("时间设置无效，请重新填写");
    return;
  }
  renderScheduleTimes(result.times);
  renderScheduleSummary(result.times, result.alarms || [], result.nextRunAt || 0);
  showToast("每日抓取时间已保存");
}

function pendingAction(record) {
  const actionByProgress = {
    测评: "完成测评",
    笔试: "参加笔试",
    一面: "参加一面",
    二面: "参加二面",
    HR面: "参加 HR 面",
  };
  return actionByProgress[record.progress] || "暂无测试／面试待办";
}

function todoTemplate(record) {
  const hasTodo = ["测评", "笔试", "一面", "二面", "HR面"].includes(record.progress);
  const overdue = Boolean(record.deadline && new Date(record.deadline).getTime() < Date.now());
  const deadlineLabel = record.deadline
    ? `${overdue ? "已截止" : "截止"}：${formatDateTime(record.deadline)}`
    : hasTodo
      ? "截止时间待通知"
      : "";
  return `<div class="todo-cell"><strong>${escapeHtml(pendingAction(record))}</strong>${deadlineLabel ? `<small class="${overdue ? "overdue" : ""}">${deadlineLabel}</small>` : ""}</div>`;
}

function loginTemplate(record) {
  if (record.automationStatus === "checked") {
    return `<span class="login-indicator ok"><i class="login-light"></i>正常</span>`;
  }
  if (["needs-login", "unavailable"].includes(record.automationStatus)) {
    return `<span class="login-indicator failed"><i class="login-light">!</i>需处理</span>`;
  }
  return `<span class="login-indicator unknown"><i class="login-light"></i>未检查</span>`;
}

function renderStats() {
  const terminal = ["Offer", "未通过", "已撤回"];
  const interview = ["一面", "二面", "HR面"];
  const now = new Date();
  const monday = new Date(now);
  const weekday = (now.getDay() + 6) % 7;
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - weekday);

  const activeCount = records.filter((record) => !terminal.includes(record.progress)).length;
  const interviewCount = records.filter((record) => interview.includes(record.progress)).length;
  const offerCount = records.filter((record) => record.progress === "Offer").length;
  const weekCount = records.filter((record) => new Date(`${record.appliedDate}T00:00:00`) >= monday).length;
  const offerRate = records.length ? Math.round((offerCount / records.length) * 100) : 0;

  elements.totalStat.textContent = records.length;
  elements.weekStat.textContent = `本周新增 ${weekCount} 份`;
  elements.activeStat.textContent = activeCount;
  elements.interviewStat.textContent = interviewCount;
  elements.offerStat.textContent = offerCount;
  elements.offerRateStat.textContent = `Offer 率 ${offerRate}%`;

  const actionable = records
    .filter((record) => ["测评", "笔试", "一面", "二面", "HR面"].includes(record.progress))
    .sort((left, right) => String(left.deadline || "9999").localeCompare(String(right.deadline || "9999")));
  const nextAction = actionable[0];
  const upcomingDeadline = records
    .filter((record) => record.deadline && new Date(record.deadline).getTime() >= Date.now())
    .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime())[0];

  elements.focusTodoCount.textContent = `${actionable.length} 项`;
  elements.focusTodoHint.textContent = actionable.length
    ? "优先完成有截止时间的测评、笔试或面试"
    : "当前没有需要立即完成的事项";
  elements.focusNextAction.textContent = nextAction
    ? `${pendingAction(nextAction)} · ${nextAction.enterpriseName || "企业待确认"} · ${nextAction.jobTitle}`
    : records.length
      ? "目前没有待完成事项，继续留意邮箱与网申状态。"
      : "添加一条投递记录，开始安排你的求职节奏。";
  elements.focusDeadline.textContent = upcomingDeadline ? formatDateTime(upcomingDeadline.deadline) : "暂未设置";
  elements.focusDeadlineHint.textContent = upcomingDeadline
    ? `${upcomingDeadline.enterpriseName || "企业待确认"} · ${upcomingDeadline.jobTitle}`
    : "补充测评或面试截止时间";
}

function rowTemplate(record) {
  const enterpriseLabel = record.enterpriseName || "待填写";
  const firstCharacter = Array.from(enterpriseLabel.trim())[0] || "企";
  return `
    <tr>
      <td><span class="job-name">${escapeHtml(record.jobTitle)}</span></td>
      <td>
        <div class="enterprise-cell">
          <span class="enterprise-logo">${escapeHtml(firstCharacter)}</span>
          <strong>${escapeHtml(enterpriseLabel)}</strong>
        </div>
      </td>
      <td>${escapeHtml(record.location)}</td>
      <td>${escapeHtml(formatDate(record.appliedDate))}</td>
      <td><span class="progress-badge ${statusClass(record.progress)}">${escapeHtml(record.progress)}</span></td>
      <td>${todoTemplate(record)}</td>
      <td>
        <div class="site-cell">
          <a class="site-link" href="${escapeHtml(safeUrl(record.queryUrl))}" target="_blank" rel="noopener noreferrer">
            打开网站 <span aria-hidden="true">↗</span>
          </a>
          ${automationNote(record)}
        </div>
      </td>
      <td>${loginTemplate(record)}</td>
      <td><button class="row-action" type="button" data-edit="${escapeHtml(record.id)}" aria-label="编辑 ${escapeHtml(record.jobTitle)}">•••</button></td>
    </tr>`;
}

function cardTemplate(record) {
  const enterpriseLabel = record.enterpriseName || "企业待填写";
  const firstCharacter = Array.from(enterpriseLabel.trim())[0] || "企";
  return `
    <article class="record-card">
      <div class="record-card-head">
        <span class="enterprise-logo">${escapeHtml(firstCharacter)}</span>
        <div>
          <h3>${escapeHtml(record.jobTitle)}</h3>
          <p>${escapeHtml(enterpriseLabel)}</p>
        </div>
        <button class="row-action" type="button" data-edit="${escapeHtml(record.id)}" aria-label="编辑 ${escapeHtml(record.jobTitle)}">•••</button>
      </div>
      <div class="record-card-meta">
        <div><small>工作地点</small><span>${escapeHtml(record.location)}</span></div>
        <div><small>投递日期</small><span>${escapeHtml(formatDate(record.appliedDate))}</span></div>
      </div>
      <div class="record-card-todo">
        ${todoTemplate(record)}
        ${loginTemplate(record)}
      </div>
      <div class="record-card-actions">
        <span class="progress-badge ${statusClass(record.progress)}">${escapeHtml(record.progress)}</span>
        <div class="site-cell mobile-site-cell">
          <a class="site-link" href="${escapeHtml(safeUrl(record.queryUrl))}" target="_blank" rel="noopener noreferrer">打开查询网站 <span aria-hidden="true">↗</span></a>
          ${automationNote(record)}
        </div>
      </div>
    </article>`;
}

function render() {
  const filtered = getFilteredRecords();
  const archived = records
    .filter((record) => record.archived)
    .sort((a, b) => String(b.archivedAt || b.statusUpdatedAt || "").localeCompare(String(a.archivedAt || a.statusUpdatedAt || "")));
  const hasSearch = elements.searchInput.value.trim() || elements.progressFilter.value;

  elements.recordsBody.innerHTML = filtered.map(rowTemplate).join("");
  elements.mobileRecords.innerHTML = filtered.map(cardTemplate).join("");
  elements.archivedRecordsBody.innerHTML = archived.map(rowTemplate).join("");
  elements.archivedMobileRecords.innerHTML = archived.map(cardTemplate).join("");
  elements.archivedCount.textContent = `共 ${archived.length} 条已结束记录`;
  elements.archivedEmpty.hidden = archived.length > 0;
  const activeTotal = records.filter((record) => !record.archived).length;
  elements.resultCount.textContent = hasSearch
    ? `找到 ${filtered.length} 条，进行中 ${activeTotal} 条`
    : `共 ${activeTotal} 条进行中记录`;
  elements.emptyState.hidden = filtered.length > 0;
  elements.demoBanner.hidden = !records.some((record) => record.demo);
  renderStats();
}

function todayString() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60_000;
  return new Date(today.getTime() - offset).toISOString().slice(0, 10);
}

function readManualDraftFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get("new") !== "1") return null;
  const draft = {
    manualOnly: params.get("manualOnly") === "1",
    enterpriseName: "",
    jobTitle: params.get("jobTitle") || "",
    location: params.get("location") || "",
    appliedDate: params.get("appliedDate") || "",
    progress: params.get("progress") || "已投递",
    deadline: params.get("deadline") || "",
    queryUrl: params.get("queryUrl") || "",
  };
  history.replaceState(null, "", location.pathname);
  return draft;
}

async function readPendingCaptureDrafts() {
  const params = new URLSearchParams(location.search);
  if (params.get("capture") !== "1") return [];
  history.replaceState(null, "", location.pathname);
  const stored = await extensionGet([PENDING_CAPTURE_KEY]);
  await extensionSet({ [PENDING_CAPTURE_KEY]: null });
  const applications = Array.isArray(stored[PENDING_CAPTURE_KEY]?.applications)
    ? stored[PENDING_CAPTURE_KEY].applications
    : [];
  return applications.map((application) => ({
    captureManual: true,
    manualOnly: !application.jobTitle || !application.location || application.location === "待确认" || !application.appliedDate,
    enterpriseName: "",
    jobTitle: application.jobTitle || "",
    location: application.location === "待确认" ? "" : application.location || "",
    appliedDate: application.appliedDate || "",
    progress: application.progress || "已投递",
    deadline: application.deadline || "",
    queryUrl: application.queryUrl || "",
    applicationKey: application.applicationKey || "",
    rawTitle: application.rawTitle || "",
  }));
}

function findCapturedRecord(prefill) {
  if (!prefill.captureManual) return null;
  return records.find((record) => {
    if (record.demo) return false;
    if (prefill.applicationKey && record.applicationKey === prefill.applicationKey) return true;
    return record.jobTitle === prefill.jobTitle && safeUrl(record.queryUrl) === safeUrl(prefill.queryUrl);
  }) || null;
}

function openAddDialog(prefill = {}) {
  const existing = findCapturedRecord(prefill);
  elements.recordForm.reset();
  elements.recordForm.dataset.captureManual = prefill.captureManual ? "1" : "";
  elements.recordForm.dataset.applicationKey = prefill.applicationKey || existing?.applicationKey || "";
  elements.recordForm.dataset.rawTitle = prefill.rawTitle || existing?.rawTitle || "";
  elements.recordId.value = existing?.id || "";
  elements.dialogTitle.textContent = prefill.captureManual
    ? existing ? "补充企业名字并更新投递" : "填写企业名字并保存投递"
    : "新增投递";
  elements.recordManualHint.hidden = !prefill.manualOnly && !prefill.captureManual;
  elements.recordManualHint.textContent = prefill.captureManual
    ? prefill.manualOnly
      ? "企业名字不会自动读取；当前网页还有部分信息未识别，请手动补充后保存。"
      : "企业名字不会从网页自动读取。其他识别内容已预填，请填写企业名字并核对后保存。"
    : "企业名字不会自动读取；当前网页信息不完整，已保留地址栏链接，请手动填写缺少内容。";
  elements.enterpriseName.value = existing?.enterpriseName || "";
  elements.jobTitle.value = existing?.jobTitle || prefill.jobTitle || "";
  elements.location.value = existing?.location || prefill.location || "";
  elements.appliedDate.value = existing?.appliedDate || (Object.hasOwn(prefill, "appliedDate") ? prefill.appliedDate : todayString());
  elements.progress.value = prefill.progress || "已投递";
  elements.deadline.value = prefill.deadline || existing?.deadline || "";
  elements.queryUrl.value = existing?.queryUrl || prefill.queryUrl || "";
  elements.deleteButton.hidden = !existing;
  elements.recordDialog.showModal();
  window.setTimeout(() => elements.enterpriseName.focus(), 40);
}

function openEditDialog(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  elements.recordId.value = record.id;
  elements.recordForm.dataset.captureManual = "";
  elements.recordForm.dataset.applicationKey = record.applicationKey || "";
  elements.recordForm.dataset.rawTitle = record.rawTitle || "";
  elements.enterpriseName.value = record.enterpriseName || "";
  elements.jobTitle.value = record.jobTitle;
  elements.location.value = record.location;
  elements.appliedDate.value = record.appliedDate;
  elements.progress.value = record.progress;
  elements.deadline.value = record.deadline || "";
  elements.queryUrl.value = record.queryUrl;
  elements.dialogTitle.textContent = "编辑投递";
  elements.recordManualHint.hidden = true;
  elements.deleteButton.hidden = false;
  elements.recordDialog.showModal();
}

function closeRecordDialog(clearCaptureQueue = true) {
  if (clearCaptureQueue) pendingCaptureQueue = [];
  safeCloseDialog(elements.recordDialog);
}

function safeCloseDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function upsertRecord(event) {
  event.preventDefault();
  elements.enterpriseName.setCustomValidity("");
  if (!elements.recordForm.reportValidity()) return;
  const enterpriseName = cleanManualEnterpriseName(elements.enterpriseName.value);
  if (!enterpriseName) {
    elements.enterpriseName.setCustomValidity("请填写真实的企业名字，不要填写网页标题");
    elements.enterpriseName.reportValidity();
    return;
  }

  const id = elements.recordId.value || crypto.randomUUID();
  const record = {
    id,
    enterpriseName,
    enterpriseNameSource: "manual",
    jobTitle: elements.jobTitle.value.trim(),
    location: elements.location.value.trim(),
    appliedDate: elements.appliedDate.value,
    progress: elements.progress.value,
    archived: elements.progress.value === "未通过",
    archivedAt: elements.progress.value === "未通过"
      ? records.find((item) => item.id === id)?.archivedAt || new Date().toISOString()
      : "",
    deadline: elements.deadline.value,
    queryUrl: safeUrl(elements.queryUrl.value.trim()),
    applicationKey: elements.recordForm.dataset.applicationKey || "",
    rawTitle: elements.recordForm.dataset.rawTitle || "",
    demo: false,
  };

  const index = records.findIndex((item) => item.id === id);
  record.identityLocked = true;
  record.identityLockedAt = index >= 0
    ? records[index].identityLockedAt || new Date().toISOString()
    : new Date().toISOString();
  if (index >= 0) records[index] = { ...records[index], ...record };
  else records.push(record);

  saveRecords();
  render();
  closeRecordDialog(false);
  showToast(index >= 0 ? "投递记录已更新" : "投递记录已添加");
  const nextCapture = pendingCaptureQueue.shift();
  if (nextCapture) window.setTimeout(() => openAddDialog(nextCapture), 120);
}

function deleteCurrentRecord() {
  const id = elements.recordId.value;
  const record = records.find((item) => item.id === id);
  if (!record || !window.confirm(`确定删除“${record.jobTitle}”吗？`)) return;

  records = records.filter((item) => item.id !== id);
  saveRecords();
  render();
  closeRecordDialog();
  showToast("投递记录已删除");
}

function clearDemoRecords() {
  records = records.filter((record) => !record.demo);
  saveRecords();
  render();
  showToast("示例记录已清空");
}

function exportRecords() {
  if (!records.length) {
    showToast("暂无可导出的记录");
    return;
  }

  const headers = ["岗位名称", "企业名字", "工作地点", "投递日期", "进度", "测试/面试截止时间", "查询网站", "登录状态", "状态更新时间"];
  const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = records.map((record) =>
    [record.jobTitle, record.enterpriseName || "", record.location, record.appliedDate, record.progress, record.deadline || "", record.queryUrl, record.automationStatus || "未检查", record.statusUpdatedAt || ""]
      .map(csvCell)
      .join(","),
  );
  const csv = `\uFEFF${headers.map(csvCell).join(",")}\n${rows.join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `秋招投递记录-${todayString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("记录已导出");
}

function openInfoDialog(type) {
  const content = {
    devices: {
      title: "设备管理将在云端版启用",
      text: "云端版会列出所有已授权的手机和电脑。添加新设备需要用旧设备扫码批准，丢失设备可以在这里远程撤销。",
    },
    settings: {
      title: "Edge 定时查询将在下一阶段接入",
      text: "查询助手将复用你在 Edge 中已有的招聘网站登录状态。登录失效或需要手机验证码时，会提醒你重新验证。",
    },
    mascotQuiet: {
      title: "小狗暂时没有新通知",
      text: "继续保持节奏吧。小狗会根据早中晚陪你工作、吃饭和休息；有新进程或需要重新登录时，会马上提醒你。",
    },
  }[type];

  elements.infoDialogTitle.textContent = content.title;
  elements.infoDialogText.textContent = content.text;
  elements.infoDialog.showModal();
}

function runtimeMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function emailProvider(address) {
  return globalThis.AutumnRecruitExtractor?.detectEmailProviderFromAddress(address) || {
    name: "企业或其他邮箱",
    domain: String(address || "").split("@").at(-1) || "",
    webmailUrl: "",
    generic: true,
  };
}

function renderEmailFields(emails = [""]) {
  const safeEmails = emails.length ? emails.slice(0, 5) : [""];
  elements.emailFields.innerHTML = safeEmails
    .map((address, index) => {
      const provider = emailProvider(address);
      return `<div class="email-row" data-email-row>
        <input type="email" required autocomplete="email" maxlength="120" value="${escapeHtml(address)}" placeholder="邮箱 ${index + 1}" aria-label="招聘通知邮箱 ${index + 1}" />
        <span class="email-provider">${escapeHtml(address ? provider.name : "自动识别类型")}</span>
        <button class="remove-email" type="button" data-remove-email aria-label="删除这个邮箱" ${safeEmails.length === 1 ? "hidden" : ""}>×</button>
      </div>`;
    })
    .join("");
  elements.addEmailButton.disabled = safeEmails.length >= 5;
}

function currentEmailValues() {
  return Array.from(elements.emailFields.querySelectorAll('input[type="email"]')).map((input) => input.value.trim());
}

function updateProfileDisplay(profile) {
  if (!profile) return;
  elements.profileDisplayName.textContent = profile.name || "我的秋招";
  elements.profileDisplayMeta.textContent = `${profile.emails?.length || 0} 个邮箱 · 当前设备`;
}

async function loadProfile() {
  if (IS_EXTENSION) {
    const stored = await extensionGet([PROFILE_KEY]);
    return stored[PROFILE_KEY] || null;
  }
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
  } catch {
    return null;
  }
}

function openProfileDialog(profile = null, required = false) {
  activeProfile = profile;
  elements.profileName.value = profile?.name || "";
  elements.profilePhone.value = profile?.phone || "";
  renderEmailFields((profile?.emails || []).map((email) => email.address || email));
  elements.closeProfileDialog.hidden = required;
  document.querySelector("#profileDialogTitle").textContent = required ? "欢迎使用秋招进度台" : "修改个人与邮箱信息";
  if (!elements.profileDialog.open) elements.profileDialog.showModal();
  setTimeout(() => elements.profileName.focus(), 50);
}

async function saveProfile(event) {
  event.preventDefault();
  if (!elements.profileForm.reportValidity()) return;
  const addresses = currentEmailValues().filter(Boolean);
  const uniqueAddresses = [...new Set(addresses.map((address) => address.toLowerCase()))];
  if (uniqueAddresses.length < 1 || uniqueAddresses.length > 5 || uniqueAddresses.length !== addresses.length) {
    showToast("请填写 1–5 个不重复的有效邮箱");
    return;
  }

  const profile = {
    name: elements.profileName.value.trim(),
    phone: elements.profilePhone.value.trim(),
    emails: addresses.map((address) => ({ address, ...emailProvider(address) })),
    updatedAt: new Date().toISOString(),
  };

  if (IS_EXTENSION) await extensionSet({ [PROFILE_KEY]: profile });
  else localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  activeProfile = profile;
  updateProfileDisplay(profile);
  safeCloseDialog(elements.profileDialog);
  showToast("基本信息已保存");
  if (IS_EXTENSION) runtimeMessage({ type: "SAVE_PROFILE", profile }).catch(() => {});
  if (pendingManualDraft) {
    const draft = pendingManualDraft;
    pendingManualDraft = null;
    setTimeout(() => openAddDialog(draft), 80);
  } else if (IS_EXTENSION) refreshUnreadAlerts(true);
}

async function refreshAllProgress() {
  if (!IS_EXTENSION) {
    showToast("请安装 Edge 扩展后使用自动刷新");
    return;
  }
  elements.refreshButton.disabled = true;
  elements.mobileRefreshButton.disabled = true;
  elements.refreshButton.classList.add("loading");
  elements.refreshButton.querySelector("b").textContent = "正在刷新…";
  showToast("正在检查申请页面，并按企业名字搜索已登记邮箱…");
  try {
    const result = await runtimeMessage({ type: "RUN_CHECK_NOW" });
    if (result?.reason === "already-running") {
      showToast("已有一次检查正在进行，请稍候");
    } else if (result?.error) {
      showToast(`刷新失败：${result.error}`);
    } else {
      await refreshAutomationDashboard();
      showToast(`刷新完成：打开邮件详情 ${result?.emailsOpened || 0} 封，收录 ${result?.emailsRecorded || 0} 封，待确认 ${result?.emailsQueued || 0} 封`);
    }
  } finally {
    elements.refreshButton.disabled = false;
    elements.mobileRefreshButton.disabled = false;
    elements.refreshButton.classList.remove("loading");
    elements.refreshButton.querySelector("b").textContent = "立即刷新进度";
  }
}

function alertTypeClass(type) {
  if (type === "process-ended") return "negative";
  if (type === "login-failed") return "auth";
  return "";
}

function alertMark(type) {
  if (["process-ended", "login-failed"].includes(type)) return "!";
  if (type === "next-stage") return "✓";
  return "↻";
}

function renderMascot(alerts = latestAlerts) {
  latestAlerts = Array.isArray(alerts) ? alerts : [];
  const unread = latestAlerts.filter((alert) => !alert.read);
  const needsLogin = unread.some((alert) => alert.type === "login-failed") || records.some((record) => ["needs-login", "unavailable"].includes(record.automationStatus));
  const hasProgress = unread.some((alert) => alert.type !== "login-failed");
  const hour = new Date().getHours();
  let mode = hour >= 6 && hour < 12 ? "working" : hour >= 12 && hour < 18 ? "lunch" : "sleeping";
  let title = mode === "working" ? "小狗在工作" : mode === "lunch" ? "小狗在吃饭" : "小狗在休息";
  let speech = mode === "working"
    ? "嗨中午好，小狗要工作啦"
    : mode === "lunch"
      ? "嗨中午好，小狗要去吃饭啦"
      : "嗨晚上，小狗要休息啦";
  let badge = "";

  if (needsLogin) {
    mode = "confused";
    title = "小狗有点疑惑";
    speech = "有页面需要重新登录，点我查看详情。";
    badge = "?";
  } else if (hasProgress) {
    mode = "surprised";
    title = "小狗发现新进程";
    speech = "有新的申请动态，点我查看详情！";
    badge = "!";
  }

  const imageMode = ["lunch", "sleeping", "surprised", "confused"].includes(mode) ? mode : "working";
  elements.mascotButton.dataset.state = mode;
  elements.mascotImage.src = `./assets/dog-${imageMode}.png`;
  elements.mascotTitle.textContent = title;
  elements.mascotSpeech.textContent = speech;
  elements.mascotAlertBadge.hidden = !badge;
  elements.mascotAlertBadge.textContent = badge;
}

function renderUnreadAlerts(alerts, autoOpen = false) {
  latestAlerts = Array.isArray(alerts) ? alerts : [];
  renderMascot(latestAlerts);
  const unread = (Array.isArray(alerts) ? alerts : []).filter((alert) => !alert.read);
  elements.alertsList.innerHTML = unread
    .map((alert) => {
      const created = new Date(alert.createdAt);
      const time = Number.isNaN(created.getTime())
        ? "刚刚"
        : created.toLocaleString("zh-CN", { hour12: false });
      return `<article class="alert-item ${alertTypeClass(alert.type)}">
        <span class="alert-mark">${alertMark(alert.type)}</span>
        <div>
          <strong>${escapeHtml(alert.title || "申请状态更新")}</strong>
          <p>${escapeHtml(alert.message || "你的申请出现了新动态。")}</p>
          <time>${escapeHtml(time)}</time>
        </div>
      </article>`;
    })
    .join("");

  if (
    autoOpen &&
    unread.length &&
    !elements.alertsDialog.open &&
    !elements.profileDialog.open &&
    !elements.recordDialog.open &&
    !elements.infoDialog.open
  ) {
    elements.alertsDialog.showModal();
  }
  if (!unread.length && elements.alertsDialog.open) elements.alertsDialog.close();
}

async function refreshUnreadAlerts(autoOpen = false) {
  if (!IS_EXTENSION) return;
  const stored = await extensionGet([ALERTS_KEY]);
  renderUnreadAlerts(stored[ALERTS_KEY], autoOpen);
}

async function openMascotNotifications() {
  if (IS_EXTENSION) await refreshUnreadAlerts(false);
  const unread = latestAlerts.filter((alert) => !alert.read);
  if (unread.length) {
    if (!elements.alertsDialog.open) elements.alertsDialog.showModal();
    return;
  }
  openInfoDialog("mascotQuiet");
}

async function markUnreadAlertsRead() {
  if (!IS_EXTENSION) return;
  safeCloseDialog(elements.alertsDialog);
  await runtimeMessage({ type: "MARK_ALERTS_READ" });
  showToast("新动态已标为已读");
}

document.querySelector("#addButton").addEventListener("click", () => openAddDialog());
document.querySelector("#emptyAddButton").addEventListener("click", () => openAddDialog());
document.querySelector("#mobileAddButton").addEventListener("click", () => openAddDialog());
document.querySelector("#closeDialog").addEventListener("click", closeRecordDialog);
document.querySelector("#cancelButton").addEventListener("click", closeRecordDialog);
document.querySelector("#deleteButton").addEventListener("click", deleteCurrentRecord);
document.querySelector("#clearDemoButton").addEventListener("click", clearDemoRecords);
document.querySelector("#exportButton").addEventListener("click", exportRecords);
document.querySelector("#closeNotice").addEventListener("click", () => {
  elements.localNotice.hidden = true;
});

document.querySelector("#navDevices").addEventListener("click", () => openInfoDialog("devices"));
document.querySelector("#navSettings").addEventListener("click", () => openProfileDialog(activeProfile, false));
document.querySelector("#closeInfoDialog").addEventListener("click", () => safeCloseDialog(elements.infoDialog));
document.querySelector("#confirmInfoDialog").addEventListener("click", () => safeCloseDialog(elements.infoDialog));
document.querySelector("#closeAlertsDialog").addEventListener("click", () => safeCloseDialog(elements.alertsDialog));
document.querySelector("#remindLaterButton").addEventListener("click", () => safeCloseDialog(elements.alertsDialog));
document.querySelector("#markAlertsReadButton").addEventListener("click", markUnreadAlertsRead);
elements.mascotButton.addEventListener("click", openMascotNotifications);
elements.mobileMascotButton.addEventListener("click", openMascotNotifications);
elements.refreshButton.addEventListener("click", refreshAllProgress);
elements.mobileRefreshButton.addEventListener("click", refreshAllProgress);
elements.profileForm.addEventListener("submit", saveProfile);
elements.closeProfileDialog.addEventListener("click", () => safeCloseDialog(elements.profileDialog));
elements.addEmailButton.addEventListener("click", () => {
  const values = currentEmailValues();
  if (values.length < 5) renderEmailFields([...values, ""]);
});
elements.emailFields.addEventListener("input", (event) => {
  if (!event.target.matches('input[type="email"]')) return;
  const row = event.target.closest("[data-email-row]");
  row.querySelector(".email-provider").textContent = event.target.value
    ? emailProvider(event.target.value).name
    : "自动识别类型";
});
elements.emailFields.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-email]");
  if (!button) return;
  const values = currentEmailValues();
  const index = Array.from(elements.emailFields.children).indexOf(button.closest("[data-email-row]"));
  values.splice(index, 1);
  renderEmailFields(values);
});
elements.addScheduleTime.addEventListener("click", () => {
  const values = currentScheduleTimes();
  if (values.length >= 5) return;
  const next = ["09:00", "12:00", "15:00", "18:00", "21:00"].find((time) => !values.includes(time)) || "16:00";
  renderScheduleTimes([...values, next]);
});
elements.scheduleTimes.addEventListener("click", (event) => {
  const button = event.target.closest(".schedule-remove");
  if (!button) return;
  const rows = Array.from(elements.scheduleTimes.querySelectorAll(".schedule-time-row"));
  const index = rows.indexOf(button.closest(".schedule-time-row"));
  const values = currentScheduleTimes();
  values.splice(index, 1);
  renderScheduleTimes(values);
});
elements.saveScheduleButton.addEventListener("click", saveSchedule);
elements.selectAllEmails.addEventListener("change", () => {
  const accepted = emailHistory.filter((item) => item.matchStatus !== "pending");
  selectedEmailKeys = elements.selectAllEmails.checked
    ? new Set(accepted.map(emailSelectionKey))
    : new Set();
  renderEmailHistory(emailHistory);
});
elements.deleteSelectedEmails.addEventListener("click", deleteSelectedHistoryEmails);
document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-email-key]");
  if (!checkbox) return;
  const key = checkbox.dataset.selectEmailKey;
  if (checkbox.checked) selectedEmailKeys.add(key);
  else selectedEmailKeys.delete(key);
  renderEmailHistory(emailHistory);
});

elements.recordForm.addEventListener("submit", upsertRecord);
elements.enterpriseName.addEventListener("input", () => elements.enterpriseName.setCustomValidity(""));
elements.searchInput.addEventListener("input", render);
elements.progressFilter.addEventListener("change", render);

document.addEventListener("click", (event) => {
  const deleteEmailButton = event.target.closest("[data-delete-email-id], [data-delete-email-signature]");
  if (deleteEmailButton) {
    deleteHistoryEmail(deleteEmailButton);
    return;
  }
  const mailDecisionButton = event.target.closest("[data-mail-decision]");
  if (mailDecisionButton) {
    decidePendingEmail(mailDecisionButton);
    return;
  }
  const button = event.target.closest("[data-edit]");
  if (button) openEditDialog(button.dataset.edit);
});

async function initialize() {
  records = await loadRecords();
  activeProfile = await loadProfile();
  pendingManualDraft = IS_EXTENSION ? readManualDraftFromUrl() : null;
  if (IS_EXTENSION && !pendingManualDraft) {
    const captureDrafts = await readPendingCaptureDrafts();
    pendingManualDraft = captureDrafts.shift() || null;
    pendingCaptureQueue = captureDrafts;
  }
  if (activeProfile) updateProfileDisplay(activeProfile);

  if (IS_EXTENSION) {
    document.querySelector("#securityTitle").textContent = "Edge 扩展本机保护";
    document.querySelector("#securityText").textContent = "投递数据保存在当前 Edge 配置中，不会发送到第三方服务器。";
    document.querySelector("#deviceStatusText").textContent = "Edge 扩展已连接";
    document.querySelector("#noticeTitle").textContent = "每日自动检查已开启，可在下方修改时间";
    document.querySelector("#noticeText").textContent = "保持 Edge 运行即可复查招聘网站和已登记邮箱；登录失效或出现验证码时会标记为需要你处理。";

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[STORAGE_KEY]) {
        records = sanitizeRecords(changes[STORAGE_KEY].newValue);
        render();
      }
      if (changes[ALERTS_KEY]) renderUnreadAlerts(changes[ALERTS_KEY].newValue, true);
      if (changes[PROFILE_KEY]) {
        activeProfile = changes[PROFILE_KEY].newValue || null;
        if (activeProfile) updateProfileDisplay(activeProfile);
      }
      if (changes[EMAIL_SIGNALS_KEY]) {
        emailSignals = changes[EMAIL_SIGNALS_KEY].newValue || [];
        renderPendingEmails(emailHistory, emailSignals);
      }
      if (changes[EMAIL_HISTORY_KEY]) renderEmailHistory(changes[EMAIL_HISTORY_KEY].newValue || []);
      if (changes[SCHEDULE_KEY]) {
        setTimeout(refreshAutomationDashboard, 120);
      }
    });

    if (activeProfile) {
      if (!pendingManualDraft) refreshUnreadAlerts(true);
    } else openProfileDialog(null, true);
  }

  render();
  refreshAutomationDashboard();
  if (IS_EXTENSION && activeProfile && pendingManualDraft) {
    const draft = pendingManualDraft;
    pendingManualDraft = null;
    setTimeout(() => openAddDialog(draft), 80);
  }
}

initialize();
