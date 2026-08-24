"use strict";

const STORAGE_KEY = "autumn-job-tracker-records-v1";
const MAIL_SOURCES_KEY = "autumn-job-tracker-mail-sources-v1";
const EMAIL_SIGNALS_KEY = "autumn-job-tracker-email-signals-v1";
const EMAIL_HISTORY_KEY = "autumn-job-tracker-email-history-v1";
const EMAIL_IGNORED_KEY = "autumn-job-tracker-email-ignored-v1";
const AUTOMATION_META_KEY = "autumn-job-tracker-automation-v1";
const ALERTS_KEY = "autumn-job-tracker-alerts-v1";
const PROFILE_KEY = "autumn-job-tracker-profile-v1";
const SCHEDULE_KEY = "autumn-job-tracker-schedule-v1";
const DEFAULT_CHECK_TIMES = ["12:00", "18:00"];
const ALARM_PREFIX = "autumn-check-daily-";
const LEGACY_ALARMS = new Set(["autumn-check-noon", "autumn-check-evening"]);

let checkInProgress = false;
let alarmSetupQueue = Promise.resolve();
let applicationWriteQueue = Promise.resolve();

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextOccurrence(hour, minute) {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function ensureAlarms(timesOverride = null) {
  const requestedTimes = Array.isArray(timesOverride) ? normalizeScheduleTimes(timesOverride) : null;
  alarmSetupQueue = alarmSetupQueue.catch(() => {}).then(async () => {
    const stored = requestedTimes ? {} : await storageGet([SCHEDULE_KEY]);
    const times = requestedTimes || normalizeScheduleTimes(stored[SCHEDULE_KEY]);
    const existing = await chrome.alarms.getAll();
    for (const alarm of existing) {
      if (isManagedAlarm(alarm.name)) await chrome.alarms.clear(alarm.name);
    }
    for (const [index, time] of times.entries()) {
      const [hour, minute] = time.split(":").map(Number);
      await chrome.alarms.create(`${ALARM_PREFIX}${index}`, {
        when: nextOccurrence(hour, minute),
        periodInMinutes: 24 * 60,
      });
    }
    await storageSet({ [SCHEDULE_KEY]: times });
    return times;
  });
  return alarmSetupQueue;
}

function normalizeScheduleTimes(values) {
  const valid = (Array.isArray(values) ? values : DEFAULT_CHECK_TIMES)
    .map((value) => String(value || "").trim())
    .filter((value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
  const unique = [...new Set(valid)].sort();
  return (unique.length ? unique : DEFAULT_CHECK_TIMES).slice(0, 5);
}

function isManagedAlarm(name) {
  return String(name || "").startsWith(ALARM_PREFIX) || LEGACY_ALARMS.has(name);
}

async function saveScheduleTimes(values) {
  const requested = (Array.isArray(values) ? values : []).map((value) => String(value || "").trim());
  const times = normalizeScheduleTimes(requested);
  const valid =
    requested.length >= 1 &&
    requested.length <= 5 &&
    requested.every((value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) &&
    new Set(requested).size === requested.length;
  if (!valid) {
    return { saved: false, reason: "invalid-times", times };
  }
  await storageSet({ [SCHEDULE_KEY]: times });
  await ensureAlarms(times);
  const alarms = (await chrome.alarms.getAll()).filter((alarm) => isManagedAlarm(alarm.name));
  const nextRunAt = alarms
    .map((alarm) => Number(alarm.scheduledTime || alarm.when || 0))
    .filter((value) => value > Date.now())
    .sort((a, b) => a - b)[0] || 0;
  return { saved: true, times, alarms, nextRunAt };
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return url.href;
  } catch {
    return "";
  }
}

function identityText(value) {
  return String(value || "").replace(/[\s（）()·._-]/g, "").toLocaleLowerCase("zh-CN");
}

function pageIdentity(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

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

function sanitizeRecords(value) {
  if (!Array.isArray(value)) return [];
  const deduplicated = [];
  for (const sourceRecord of value.map(normalizeManualEnterprise)) {
    const duplicateIndex = deduplicated.findIndex((record) => recordsMatch(record, sourceRecord));
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
      progress: shouldAcceptProgress(previous.progress, sourceRecord.progress) ? sourceRecord.progress : previous.progress,
      deadline: previous.deadline || sourceRecord.deadline || "",
      archived: Boolean(previous.archived || sourceRecord.archived || previous.progress === "未通过" || sourceRecord.progress === "未通过"),
      archivedAt: previous.archivedAt || sourceRecord.archivedAt || "",
    };
  }
  return deduplicated;
}

async function migrateEnterpriseNameStorage() {
  const stored = await storageGet([STORAGE_KEY]);
  const sourceRecords = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const cleanRecords = sanitizeRecords(sourceRecords);
  if (JSON.stringify(sourceRecords) !== JSON.stringify(cleanRecords)) {
    await storageSet({ [STORAGE_KEY]: cleanRecords });
  }
}

function validCapturedApplication(application, manual = false) {
  if (!application || application.needsLogin || application.needsVerification) return false;
  if (!application.jobTitle || !application.queryUrl) return false;
  return manual ? application.confidence >= 42 : application.confirmedApplicationPage && application.confidence >= 72;
}

function recordsMatch(record, application) {
  const recordKey = identityText(record.applicationKey);
  const applicationKey = identityText(application.applicationKey);
  if (recordKey && applicationKey && recordKey !== applicationKey) return false;
  const sameKey = Boolean(
    recordKey && applicationKey && recordKey === applicationKey,
  );
  const recordRole = identityText(record.jobTitle);
  const applicationRole = identityText(application.jobTitle);
  const recordPage = pageIdentity(record.queryUrl);
  const applicationPage = pageIdentity(application.queryUrl);
  const sameRole = Boolean(recordRole && recordPage && recordRole === applicationRole && recordPage === applicationPage);
  return sameKey || sameRole;
}

function findMatchingRecordIndex(records, application, allowUrlFallback = true) {
  const directIndex = records.findIndex((record) => !record.demo && recordsMatch(record, application));
  if (directIndex >= 0) return directIndex;
  if (!allowUrlFallback || application?.applicationKey) return -1;

  const queryUrl = normalizeUrl(application?.queryUrl);
  const queryPage = pageIdentity(queryUrl);
  if (!queryUrl || !queryPage) return -1;
  const urlMatches = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !record.demo && pageIdentity(record.queryUrl) === queryPage);
  return urlMatches.length === 1 ? urlMatches[0].index : -1;
}

function progressRank(progress) {
  return {
    已投递: 1,
    简历筛选: 2,
    测评: 3,
    笔试: 4,
    一面: 5,
    二面: 6,
    HR面: 7,
    Offer: 8,
  }[progress] || 0;
}

function shouldAcceptProgress(oldProgress, newProgress) {
  if (!newProgress || oldProgress === newProgress) return false;
  if (["未通过", "已撤回"].includes(oldProgress)) return false;
  if (["未通过", "已撤回"].includes(newProgress)) return true;
  return progressRank(newProgress) > progressRank(oldProgress);
}

function buildStatusAlert(record, oldProgress, newProgress, source = "website") {
  if (!newProgress || oldProgress === newProgress) return null;
  const base = {
    recordId: record.id,
    jobTitle: record.jobTitle,
    oldProgress,
    newProgress,
    source,
  };

  if (newProgress === "未通过") {
    return {
      ...base,
      type: "process-ended",
      title: record.jobTitle,
      message: "很遗憾这个不是你最好的选择。",
    };
  }

  if (progressRank(newProgress) > progressRank(oldProgress)) {
    return {
      ...base,
      type: "next-stage",
      title: record.jobTitle,
      message: `恭喜您进入下一个阶段，目前进行到${newProgress}阶段。`,
    };
  }

  return {
    ...base,
    type: "status-changed",
    title: record.jobTitle,
    message: `申请状态已由“${oldProgress || "未知"}”更新为“${newProgress}”。`,
  };
}

async function refreshUnreadBadge() {
  const stored = await storageGet([ALERTS_KEY]);
  const rawAlerts = Array.isArray(stored[ALERTS_KEY]) ? stored[ALERTS_KEY] : [];
  const terminalSeen = new Set();
  const alerts = rawAlerts.filter((alert) => {
    if (alert.type !== "process-ended" || !alert.recordId) return true;
    if (terminalSeen.has(alert.recordId)) return false;
    terminalSeen.add(alert.recordId);
    return true;
  });
  if (alerts.length !== rawAlerts.length) await storageSet({ [ALERTS_KEY]: alerts });
  const unread = alerts.filter((alert) => !alert.read);
  await chrome.action.setBadgeBackgroundColor({ color: unread.length ? "#A23D3D" : "#2F6F4E" });
  await chrome.action.setBadgeText({ text: unread.length ? String(Math.min(unread.length, 99)) : "" });
  const latest = unread[0];
  await chrome.action.setTitle({
    title: latest
      ? `秋招进度台：${latest.message}（${new Date(latest.createdAt).toLocaleString("zh-CN", { hour12: false })}）`
      : "秋招进度台",
  });
  return unread.length;
}

async function queueAlert(alert) {
  if (!alert) return null;
  const stored = await storageGet([ALERTS_KEY]);
  const alerts = Array.isArray(stored[ALERTS_KEY]) ? stored[ALERTS_KEY] : [];
  if (alert.type === "process-ended") {
    const existing = alerts.find((item) => item.type === "process-ended" && item.recordId === alert.recordId);
    if (existing) return existing;
  }
  const createdAt = new Date().toISOString();
  const nextAlert = {
    id: crypto.randomUUID(),
    ...alert,
    createdAt,
    read: false,
  };
  alerts.unshift(nextAlert);
  await storageSet({ [ALERTS_KEY]: alerts.slice(0, 100) });
  await refreshUnreadBadge();
  await notify(nextAlert.title, `${nextAlert.message}\n更新时间：${new Date(createdAt).toLocaleString("zh-CN", { hour12: false })}`);
  return nextAlert;
}

async function markAlertsRead(ids = null) {
  const stored = await storageGet([ALERTS_KEY]);
  const idSet = Array.isArray(ids) ? new Set(ids) : null;
  const alerts = (Array.isArray(stored[ALERTS_KEY]) ? stored[ALERTS_KEY] : []).map((alert) =>
    !idSet || idSet.has(alert.id) ? { ...alert, read: true } : alert,
  );
  await storageSet({ [ALERTS_KEY]: alerts });
  await refreshUnreadBadge();
  return { read: idSet ? idSet.size : alerts.length };
}

async function clearRecoveredLoginAlerts(recordId) {
  if (!recordId) return;
  const stored = await storageGet([ALERTS_KEY]);
  const alerts = Array.isArray(stored[ALERTS_KEY]) ? stored[ALERTS_KEY] : [];
  const nextAlerts = alerts.filter((alert) => !(alert.type === "login-failed" && alert.recordId === recordId));
  if (nextAlerts.length === alerts.length) return;
  await storageSet({ [ALERTS_KEY]: nextAlerts });
  await refreshUnreadBadge();
}

async function markPageReadable(queryUrl) {
  const normalizedUrl = normalizeUrl(queryUrl);
  if (!normalizedUrl) return { recovered: 0 };
  const pageIdentity = (value) => {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`.toLowerCase();
    } catch {
      return "";
    }
  };
  const normalizedIdentity = pageIdentity(normalizedUrl);
  const stored = await storageGet([STORAGE_KEY]);
  const records = sanitizeRecords(stored[STORAGE_KEY]);
  const now = new Date().toISOString();
  const recoveredIds = [];
  const nextRecords = records.map((record) => {
    const recordUrl = normalizeUrl(record.queryUrl);
    const samePage = recordUrl === normalizedUrl || (normalizedIdentity && pageIdentity(recordUrl) === normalizedIdentity);
    if (record.demo || !samePage) return record;
    if (record.automationStatus === "needs-login") recoveredIds.push(record.id);
    return {
      ...record,
      automationStatus: "checked",
      lastCheckedAt: now,
      lastCheckMessage: "已在打开的网页中确认可正常读取",
    };
  });
  if (!recoveredIds.length && !nextRecords.some((record, index) => record !== records[index])) return { recovered: 0 };
  await storageSet({ [STORAGE_KEY]: nextRecords });
  for (const recordId of recoveredIds) await clearRecoveredLoginAlerts(recordId);
  return { recovered: recoveredIds.length };
}

async function upsertApplication(application, { manual = false, source = "page", allowUrlFallback = true } = {}) {
  if (!validCapturedApplication(application, manual)) {
    return { saved: false, reason: "insufficient-confidence", confidence: application?.confidence || 0 };
  }

  const stored = await storageGet([STORAGE_KEY]);
  const records = sanitizeRecords(stored[STORAGE_KEY]);
  const index = findMatchingRecordIndex(records, application, allowUrlFallback);
  const previous = index >= 0 ? records[index] : null;
  const now = new Date().toISOString();
  const nextProgress = previous
    ? shouldAcceptProgress(previous.progress, application.progress) ? application.progress : previous.progress
    : application.progress || "已投递";
  const changedProgress = Boolean(previous && nextProgress !== previous.progress);
  const nextRecord = {
    id: index >= 0 ? records[index].id : crypto.randomUUID(),
    enterpriseName: previous?.enterpriseName || "",
    enterpriseNameSource: previous?.enterpriseNameSource === "manual" ? "manual" : "",
    jobTitle: previous?.jobTitle || application.jobTitle,
    location: previous?.location || application.location || "待确认",
    appliedDate: previous?.appliedDate || application.appliedDate || localDateKey(),
    progress: nextProgress,
    archived: nextProgress === "未通过" ? true : Boolean(previous?.archived),
    archivedAt: nextProgress === "未通过" ? previous?.archivedAt || now : previous?.archivedAt || "",
    deadline: application.deadline || (index >= 0 ? records[index].deadline || "" : ""),
    queryUrl: previous?.queryUrl || normalizeUrl(application.queryUrl),
    applicationKey: application.applicationKey || previous?.applicationKey || "",
    rawTitle: application.rawTitle || previous?.rawTitle || "",
    sourceDomain: application.sourceDomain || "",
    autoCaptured: true,
    automationStatus: "checked",
    lastCheckedAt: now,
    statusUpdatedAt: changedProgress ? now : previous?.statusUpdatedAt || now,
    captureConfidence: application.confidence,
    captureSource: source,
    identityLocked: true,
    identityLockedAt: previous?.identityLockedAt || now,
    demo: false,
  };

  if (index >= 0) records[index] = { ...records[index], ...nextRecord };
  else records.push(nextRecord);
  await storageSet({ [STORAGE_KEY]: records });
  if (previous?.automationStatus === "needs-login") {
    await clearRecoveredLoginAlerts(nextRecord.id);
  }
  if (changedProgress) {
    await queueAlert(buildStatusAlert(nextRecord, previous.progress, nextRecord.progress, source));
  }
  return { saved: true, created: index < 0, record: index >= 0 ? records[index] : nextRecord };
}

async function upsertApplications(applications, options = {}) {
  const safeApplications = Array.isArray(applications) ? applications : [];
  const results = [];
  for (const application of safeApplications) {
    results.push(await upsertApplication(application, {
      ...options,
      allowUrlFallback: safeApplications.length === 1,
    }));
  }
  return {
    saved: results.filter((result) => result.saved).length,
    created: results.filter((result) => result.created).length,
    failed: results.filter((result) => !result.saved).length,
    results,
  };
}

async function updateRecordCheck(recordId, result) {
  const stored = await storageGet([STORAGE_KEY]);
  const records = sanitizeRecords(stored[STORAGE_KEY]);
  const index = records.findIndex((record) => record.id === recordId);
  if (index < 0) return { changed: false };

  const current = records[index];
  const extractedApplications = Array.isArray(result?.applications)
    ? result.applications
    : result?.application
      ? [result.application]
      : [];
  const application = extractedApplications.find((item) => recordsMatch(current, item)) || null;
  const auth = result?.auth || application || {};
  const loginUncertain = Boolean(auth.loginDetected || auth.needsLogin) && !auth.needsVerification;
  const loginProblem = Boolean(auth.needsVerification);
  const readablePage = Boolean(result && result.context?.type === "recruitment" && !loginProblem && !loginUncertain);
  const readableApplication = Boolean(readablePage && application);
  const nextAutomationStatus = loginProblem
    ? "needs-login"
    : loginUncertain
      ? "unchecked"
    : readablePage
      ? "checked"
      : current.automationStatus === "checked"
        ? "checked"
        : "unavailable";
  const needsAttention = ["needs-login", "unavailable"].includes(nextAutomationStatus);
  const loginRecovered = current.automationStatus === "needs-login" && nextAutomationStatus !== "needs-login";
  const reliableProgress = readableApplication && application.confidence >= 42 ? application.progress : "";
  const changedProgress = shouldAcceptProgress(current.progress, reliableProgress);
  const loginBecameUnavailable = nextAutomationStatus === "needs-login" && current.automationStatus !== "needs-login";
  const now = new Date().toISOString();
  records[index] = {
    ...current,
    ...(application?.deadline ? { deadline: application.deadline } : {}),
    ...(changedProgress ? { progress: reliableProgress, statusUpdatedAt: now } : {}),
    ...(changedProgress && reliableProgress === "未通过" ? { archived: true, archivedAt: current.archivedAt || now } : {}),
    automationStatus: nextAutomationStatus,
    lastCheckedAt: now,
    lastCheckMessage: loginUncertain
      ? "页面出现登录入口，本次状态记为未检查"
      : loginProblem
      ? auth.needsVerification
        ? "网站要求验证码或安全验证"
        : "网站登录状态已失效"
      : readablePage
        ? "自动检查完成"
        : nextAutomationStatus === "checked"
          ? "暂未读到投递信息，保留上次正常状态并将在下次检查重试"
          : "查询页面暂时无法读取",
  };
  await storageSet({ [STORAGE_KEY]: records });
  if (loginRecovered) await clearRecoveredLoginAlerts(current.id);

  if (changedProgress) {
    await queueAlert(buildStatusAlert(records[index], current.progress, reliableProgress, "website"));
  }
  if (loginBecameUnavailable) {
    await queueAlert({
      type: "login-failed",
      recordId: current.id,
      jobTitle: current.jobTitle,
      title: `${current.jobTitle} 查询页面无法登录`,
      message: "当前无法正常读取你的网申信息，请重新登录或完成手机验证码。",
      source: "website",
    });
  }
  return { changed: Boolean(changedProgress), needsAttention };
}

async function saveMailboxSource(source) {
  if (!source?.hostname || !source?.url) return;
  const stored = await storageGet([MAIL_SOURCES_KEY]);
  const sources = Array.isArray(stored[MAIL_SOURCES_KEY]) ? stored[MAIL_SOURCES_KEY] : [];
  const normalized = {
    provider: source.provider || "网页邮箱",
    hostname: source.hostname,
    url: normalizeUrl(source.url),
    detectedAt: source.detectedAt || new Date().toISOString(),
  };
  const index = sources.findIndex((item) => item.hostname === normalized.hostname);
  if (index >= 0) sources[index] = { ...sources[index], ...normalized };
  else sources.push(normalized);
  await storageSet({ [MAIL_SOURCES_KEY]: sources.slice(-12) });
}

function webmailUrlForAddress(address) {
  const domain = String(address || "").trim().toLowerCase().split("@").at(-1) || "";
  if (["gmail.com", "googlemail.com"].includes(domain)) return "https://mail.google.com/mail/u/0/#inbox";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return "https://outlook.live.com/mail/0/";
  if (["qq.com", "foxmail.com"].includes(domain)) return "https://mail.qq.com/";
  if (domain === "163.com") return "https://mail.163.com/";
  if (domain === "126.com") return "https://mail.126.com/";
  if (domain === "yeah.net") return "https://mail.yeah.net/";
  if (domain === "sina.com" || domain === "sina.cn") return "https://mail.sina.com.cn/";
  if (domain === "sohu.com") return "https://mail.sohu.com/";
  if (domain === "aliyun.com" || domain === "alibaba-inc.com") return "https://mail.aliyun.com/";
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return "https://www.icloud.com/mail/";
  if (domain === "189.cn") return "https://webmail30.189.cn/w2/";
  if (domain === "139.com") return "https://mail.10086.cn/";
  return "";
}

function mailboxSourcesFromProfile(profile) {
  const sources = [];
  for (const email of Array.isArray(profile?.emails) ? profile.emails : []) {
    const mailboxUrl = normalizeUrl(email?.webmailUrl || webmailUrlForAddress(email?.address));
    if (!/^https:\/\//i.test(mailboxUrl)) continue;
    const url = new URL(mailboxUrl);
    sources.push({
      provider: email.name || "网页邮箱",
      hostname: url.hostname,
      url: url.href,
      profileAddress: String(email.address || "").trim(),
      detectedAt: email.updatedAt || profile.updatedAt || new Date().toISOString(),
    });
  }
  return sources;
}

function mergeMailboxSources(...groups) {
  const merged = new Map();
  for (const source of groups.flat()) {
    const url = normalizeUrl(source?.url || "");
    if (!source?.hostname || !/^https:\/\//i.test(url)) continue;
    const key = String(source.hostname).toLowerCase();
    merged.set(key, { ...(merged.get(key) || {}), ...source, url });
  }
  return [...merged.values()];
}

async function saveProfile(profile) {
  if (
    !profile?.name ||
    !profile?.phone ||
    !Array.isArray(profile.emails) ||
    !profile.emails.length ||
    profile.emails.length > 5
  ) {
    return { saved: false, reason: "invalid-profile" };
  }
  await storageSet({ [PROFILE_KEY]: profile });
  const stored = await storageGet([MAIL_SOURCES_KEY]);
  const sources = mergeMailboxSources(
    mailboxSourcesFromProfile(profile),
    Array.isArray(stored[MAIL_SOURCES_KEY]) ? stored[MAIL_SOURCES_KEY] : [],
  );
  if (sources.length) {
    await storageSet({ [MAIL_SOURCES_KEY]: sources.slice(-12) });
  }
  return { saved: true, emailCount: profile.emails.length, automaticMailboxCount: sources.length };
}

function signalMatchesRecord(signal, record) {
  const text = identityText(`${signal.jobTitle} ${signal.subject} ${signal.snippet}`);
  const jobTitle = identityText(record.jobTitle);
  const enterpriseName = identityText(signal.enterpriseName);
  const recordEnterprise = identityText(record.enterpriseName);
  const enterpriseMatches = Boolean(
    recordEnterprise &&
    ((enterpriseName && enterpriseName === recordEnterprise) || (recordEnterprise.length >= 2 && text.includes(recordEnterprise))),
  );
  const jobMatches = jobTitle.length >= 4 && text.includes(jobTitle);
  return enterpriseMatches || jobMatches;
}

function matchingRecordIndex(signal, records) {
  const eligible = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !record.demo && !record.archived && signalMatchesRecord(signal, record));
  const signalText = identityText(`${signal.jobTitle} ${signal.subject} ${signal.snippet}`);
  const enterpriseName = identityText(signal.enterpriseName);
  const enterpriseMatches = eligible.filter(({ record }) => {
    const recordEnterprise = identityText(record.enterpriseName);
    return recordEnterprise && (
      (enterpriseName && enterpriseName === recordEnterprise) ||
      (recordEnterprise.length >= 2 && signalText.includes(recordEnterprise))
    );
  });
  const enterprisePool = enterpriseMatches.length ? enterpriseMatches : eligible;
  const roleMatches = enterprisePool.filter(({ record }) => {
    const role = identityText(record.jobTitle);
    return role.length >= 4 && signalText.includes(role);
  });
  if (roleMatches.length === 1) return roleMatches[0].index;
  if (enterpriseMatches.length === 1) return enterpriseMatches[0].index;

  return -1;
}

function emailSignalSignature(signal, sourceHost = "") {
  if (signal?.signature) return String(signal.signature);
  if (signal?.mailResultKey) return identityText(`${sourceHost || signal.sourceHost}|mail-result|${signal.mailResultKey}`);
  return identityText(`${sourceHost || signal.sourceHost}|${signal.subject}|${signal.date}|${String(signal.snippet || "").slice(0, 120)}`);
}

function findEquivalentEmailIndex(items, signal, sourceHost = "") {
  const signature = emailSignalSignature(signal, sourceHost);
  const exact = items.findIndex((item) => emailSignalSignature(item) === signature);
  if (exact >= 0) return exact;
  const expectedSubject = identityText(signal.subject);
  const expectedDate = String(signal.date || signal.messageDate || "").slice(0, 10);
  if (!expectedSubject) return -1;
  return items.findIndex((item) => {
    const sameHost = !sourceHost || !item.sourceHost || String(item.sourceHost).toLowerCase() === String(sourceHost).toLowerCase();
    const sameSubject = identityText(item.subject) === expectedSubject;
    const itemDate = String(item.messageDate || item.date || "").slice(0, 10);
    return sameHost && sameSubject && (!expectedDate || !itemDate || expectedDate === itemDate);
  });
}

async function processEmailUpdates(updates, source) {
  if (!Array.isArray(updates) || !updates.length) return { matched: 0, queued: 0 };
  if (source) await saveMailboxSource(source);

  const stored = await storageGet([STORAGE_KEY, EMAIL_SIGNALS_KEY, EMAIL_HISTORY_KEY, EMAIL_IGNORED_KEY]);
  const records = sanitizeRecords(stored[STORAGE_KEY]);
  const oldSignals = Array.isArray(stored[EMAIL_SIGNALS_KEY]) ? stored[EMAIL_SIGNALS_KEY] : [];
  const emailHistory = Array.isArray(stored[EMAIL_HISTORY_KEY]) ? stored[EMAIL_HISTORY_KEY] : [];
  const ignored = Array.isArray(stored[EMAIL_IGNORED_KEY]) ? stored[EMAIL_IGNORED_KEY] : [];
  const ignoredSignatures = new Set(ignored.map((item) => typeof item === "string" ? item : item.signature).filter(Boolean));
  const unmatched = [];
  const statusAlerts = [];
  const matchedSignatures = new Set();
  let matched = 0;
  let changed = 0;
  let processed = 0;
  let newlyRecorded = 0;
  let newlyQueued = 0;

  for (const signal of updates) {
    const now = new Date().toISOString();
    const signature = emailSignalSignature(signal, source?.hostname || "");
    if (!signature || ignoredSignatures.has(signature)) continue;
    processed += 1;
    const index = matchingRecordIndex(signal, records);
    let matchedRecord = null;
    if (index >= 0) {
      const current = records[index];
      const changedProgress = shouldAcceptProgress(current.progress, signal.progress);
      records[index] = {
        ...current,
        ...(changedProgress ? { progress: signal.progress, statusUpdatedAt: now } : {}),
        ...(changedProgress && signal.progress === "未通过" ? { archived: true, archivedAt: current.archivedAt || now } : {}),
        ...(signal.deadline ? { deadline: signal.deadline } : {}),
        lastEmailSignal: signal.subject,
        lastCheckedAt: now,
      };
      matchedRecord = records[index];
      matchedSignatures.add(signature);
      matched += 1;
      if (changedProgress) {
        changed += 1;
        statusAlerts.push(buildStatusAlert(records[index], current.progress, signal.progress, "email"));
      }
    } else {
      const oldSignalIndex = findEquivalentEmailIndex(oldSignals, signal, source?.hostname || "");
      const oldSignal = oldSignalIndex >= 0 ? oldSignals[oldSignalIndex] : null;
      if (!oldSignal) {
        newlyRecorded += 1;
        newlyQueued += 1;
      }
      unmatched.push({
        ...signal,
        id: oldSignal?.id || crypto.randomUUID(),
        signature,
        provider: signal.provider || source?.provider || oldSignal?.provider || "网页邮箱",
        sourceHost: source?.hostname || oldSignal?.sourceHost || "",
        mailboxUrl: normalizeUrl(source?.url || oldSignal?.mailboxUrl || ""),
        mailDetailUrl: normalizeUrl(signal.mailDetailUrl || oldSignal?.mailDetailUrl || ""),
        mailScope: signal.mailScope || source?.mailScope || oldSignal?.mailScope || "all",
        enterpriseName: signal.enterpriseName || source?.enterpriseName || oldSignal?.enterpriseName || "",
        firstDetectedAt: oldSignal?.firstDetectedAt || oldSignal?.detectedAt || now,
        detectedAt: now,
      });
    }

    if (matchedRecord) {
      const historyIndex = findEquivalentEmailIndex(emailHistory, signal, source?.hostname || "");
      if (historyIndex < 0) newlyRecorded += 1;
      const historyItem = {
        id: historyIndex >= 0 ? emailHistory[historyIndex].id : crypto.randomUUID(),
        signature,
        mailResultKey: signal.mailResultKey || emailHistory[historyIndex]?.mailResultKey || "",
        provider: signal.provider || source?.provider || "网页邮箱",
        sourceHost: source?.hostname || "",
        mailboxUrl: normalizeUrl(source?.url || ""),
        mailDetailUrl: normalizeUrl(signal.mailDetailUrl || emailHistory[historyIndex]?.mailDetailUrl || ""),
        mailScope: signal.mailScope || source?.mailScope || emailHistory[historyIndex]?.mailScope || "all",
        subject: signal.subject || "招聘通知",
        snippet: signal.snippet || "",
        enterpriseName: matchedRecord.enterpriseName || signal.enterpriseName || "",
        jobTitle: matchedRecord.jobTitle || signal.jobTitle || "",
        progress: signal.progress || "",
        deadline: signal.deadline || "",
        messageDate: signal.date || "",
        matchStatus: "matched",
        matchedRecordId: matchedRecord.id || "",
        firstDetectedAt: historyIndex >= 0 ? emailHistory[historyIndex].firstDetectedAt : now,
        lastDetectedAt: now,
      };
      if (historyIndex >= 0) emailHistory[historyIndex] = historyItem;
      else emailHistory.unshift(historyItem);
    }
  }

  const remainingOldSignals = oldSignals.filter((signal) => !matchedSignatures.has(emailSignalSignature(signal)));
  const uniqueSignals = [...unmatched, ...remainingOldSignals].filter((signal, index, array) => {
    const signature = emailSignalSignature(signal);
    return array.findIndex((item) => emailSignalSignature(item) === signature) === index;
  });

  await storageSet({
    [STORAGE_KEY]: records,
    [EMAIL_SIGNALS_KEY]: uniqueSignals.slice(0, 80),
    [EMAIL_HISTORY_KEY]: emailHistory
      .sort((a, b) => String(b.lastDetectedAt).localeCompare(String(a.lastDetectedAt)))
      .slice(0, 300),
  });
  for (const alert of statusAlerts) await queueAlert(alert);
  return { matched, changed, queued: newlyQueued, recorded: newlyRecorded, found: processed };
}

async function decideEmailSignal(signature, decision) {
  const normalizedSignature = String(signature || "").trim();
  if (!normalizedSignature || !["confirm", "dismiss"].includes(decision)) {
    return { saved: false, reason: "invalid-decision" };
  }
  const stored = await storageGet([EMAIL_SIGNALS_KEY, EMAIL_HISTORY_KEY, EMAIL_IGNORED_KEY]);
  const signals = Array.isArray(stored[EMAIL_SIGNALS_KEY]) ? stored[EMAIL_SIGNALS_KEY] : [];
  const history = Array.isArray(stored[EMAIL_HISTORY_KEY]) ? stored[EMAIL_HISTORY_KEY] : [];
  const ignored = Array.isArray(stored[EMAIL_IGNORED_KEY]) ? stored[EMAIL_IGNORED_KEY] : [];
  const signal = signals.find((item) => emailSignalSignature(item) === normalizedSignature);
  const pendingHistory = history.find((item) => item.signature === normalizedSignature && item.matchStatus === "pending");
  const pending = signal || pendingHistory;
  if (!pending) return { saved: false, reason: "not-found" };

  const nextSignals = signals.filter((item) => emailSignalSignature(item) !== normalizedSignature);
  let nextHistory = history.filter((item) => !(item.signature === normalizedSignature && item.matchStatus === "pending"));
  let nextIgnored = ignored.filter((item) => (typeof item === "string" ? item : item.signature) !== normalizedSignature);
  if (decision === "confirm") {
    const now = new Date().toISOString();
    nextHistory.unshift({
      id: pending.id || crypto.randomUUID(),
      signature: normalizedSignature,
      provider: pending.provider || "网页邮箱",
      sourceHost: pending.sourceHost || "",
      mailboxUrl: normalizeUrl(pending.mailboxUrl || ""),
      mailDetailUrl: normalizeUrl(pending.mailDetailUrl || ""),
      mailScope: pending.mailScope || "all",
      mailResultKey: pending.mailResultKey || "",
      subject: pending.subject || "招聘通知",
      snippet: pending.snippet || "",
      enterpriseName: pending.enterpriseName || "",
      jobTitle: pending.jobTitle && pending.jobTitle !== "待确认" ? pending.jobTitle : "",
      progress: pending.progress || "",
      deadline: pending.deadline || "",
      messageDate: pending.messageDate || pending.date || "",
      matchStatus: "confirmed",
      matchedRecordId: pending.matchedRecordId || "",
      firstDetectedAt: pending.firstDetectedAt || pending.detectedAt || now,
      lastDetectedAt: pending.detectedAt || pending.lastDetectedAt || now,
      confirmedAt: now,
    });
  } else {
    nextIgnored.unshift({ signature: normalizedSignature, mailResultKey: pending.mailResultKey || "", sourceHost: pending.sourceHost || "", dismissedAt: new Date().toISOString() });
  }
  nextHistory = nextHistory
    .sort((a, b) => String(b.lastDetectedAt || "").localeCompare(String(a.lastDetectedAt || "")))
    .slice(0, 300);
  nextIgnored = nextIgnored.slice(0, 300);
  await storageSet({
    [EMAIL_SIGNALS_KEY]: nextSignals,
    [EMAIL_HISTORY_KEY]: nextHistory,
    [EMAIL_IGNORED_KEY]: nextIgnored,
  });
  return { saved: true, decision, emailSignals: nextSignals, emailHistory: nextHistory };
}

async function deleteEmailHistoryItem(id, signature = "") {
  const result = await deleteEmailHistoryItems([{ id, signature }]);
  return { ...result, deleted: result.deletedCount > 0 };
}

function emailHistorySelectionKey(item) {
  const id = String(item?.id ?? "").trim();
  if (id) return `id:${id}`;
  const signature = String(item?.signature ?? "").trim();
  if (signature) return `signature:${signature}`;
  const mailResultKey = String(item?.mailResultKey ?? "").trim();
  const sourceHost = String(item?.sourceHost ?? "").trim().toLowerCase();
  if (mailResultKey) return `result:${sourceHost}|${mailResultKey}`;
  return `fallback:${identityText(`${sourceHost}|${item?.subject || ""}|${item?.messageDate || item?.date || ""}|${item?.lastDetectedAt || ""}`)}`;
}

async function deleteEmailHistoryItems(items) {
  const requested = Array.isArray(items) ? items : [];
  const ids = new Set(requested.map((item) => String(item?.id || "")).filter(Boolean));
  const signatures = new Set(requested.map((item) => String(item?.signature || "")).filter(Boolean));
  const selectionKeys = new Set(requested.map((item) => String(item?.key || emailHistorySelectionKey(item))).filter(Boolean));
  if (!ids.size && !signatures.size && !selectionKeys.size) return { deletedCount: 0, reason: "empty-selection" };
  const stored = await storageGet([EMAIL_HISTORY_KEY, EMAIL_IGNORED_KEY]);
  const history = Array.isArray(stored[EMAIL_HISTORY_KEY]) ? stored[EMAIL_HISTORY_KEY] : [];
  const ignored = Array.isArray(stored[EMAIL_IGNORED_KEY]) ? stored[EMAIL_IGNORED_KEY] : [];
  const deletedItems = history.filter((entry) => (
    ids.has(String(entry.id || "")) ||
    signatures.has(String(entry.signature || "")) ||
    selectionKeys.has(emailHistorySelectionKey(entry))
  ));
  if (!deletedItems.length) return { deletedCount: 0, reason: "not-found" };
  const deletedItemSet = new Set(deletedItems);
  const nextHistory = history.filter((entry) => !deletedItemSet.has(entry));
  const deletedSignatures = new Set(deletedItems.map((item) => item.signature).filter(Boolean));
  const deletedResultKeys = new Set(deletedItems.map((item) => `${String(item.sourceHost || "").toLowerCase()}|${item.mailResultKey || ""}`).filter((key) => !key.endsWith("|")));
  const nextIgnored = ignored.filter((entry) => {
    if (deletedSignatures.has(typeof entry === "string" ? entry : entry.signature)) return false;
    if (typeof entry === "string" || !entry.mailResultKey) return true;
    return !deletedResultKeys.has(`${String(entry.sourceHost || "").toLowerCase()}|${entry.mailResultKey}`);
  });
  const now = new Date().toISOString();
  for (const item of deletedItems) {
    if (item.signature || item.mailResultKey) nextIgnored.unshift({ signature: item.signature || "", mailResultKey: item.mailResultKey || "", sourceHost: item.sourceHost || "", dismissedAt: now, reason: "deleted" });
  }
  await storageSet({
    [EMAIL_HISTORY_KEY]: nextHistory,
    [EMAIL_IGNORED_KEY]: nextIgnored.slice(0, 300),
  });
  return { deleted: true, deletedCount: deletedItems.length, emailHistory: nextHistory };
}

function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(result);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") finish(true);
      else if (changeInfo.url) setTimeout(() => finish(true), 700);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function sendTabMessageToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

async function mailboxFrameIds(tabId) {
  if (!chrome.webNavigation?.getAllFrames) return [0];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const ids = [...new Set((frames || []).map((frame) => Number(frame.frameId)).filter(Number.isInteger))];
    return ids.length ? ids.sort((a, b) => a - b) : [0];
  } catch {
    return [0];
  }
}

async function sendMailboxMessage(tabId, message, acceptResponse) {
  const frameIds = await mailboxFrameIds(tabId);
  for (const frameId of frameIds) {
    const response = await sendTabMessageToFrame(tabId, frameId, message);
    if (response && (!acceptResponse || acceptResponse(response))) return { ...response, frameId };
  }
  return null;
}

async function scanMailboxFrames(tabId, target) {
  const frameIds = await mailboxFrameIds(tabId);
  const updates = [];
  let auth = null;
  for (const frameId of frameIds) {
    const response = await sendTabMessageToFrame(tabId, frameId, {
      type: "SCAN_MAILBOX_RESULTS",
      enterpriseName: target.enterpriseName,
      source: target.source,
    });
    if (!response) continue;
    if (!auth && response.auth) auth = response.auth;
    if (Array.isArray(response.updates)) updates.push(...response.updates);
  }
  const unique = updates.filter((item, index, array) => {
    const signature = identityText(`${item.subject}|${item.date}|${String(item.snippet || "").slice(0, 120)}`);
    return array.findIndex((candidate) => identityText(`${candidate.subject}|${candidate.date}|${String(candidate.snippet || "").slice(0, 120)}`) === signature) === index;
  });
  return { updates: unique, auth };
}

async function scanMailboxDetailFrames(tabId, target) {
  const frameIds = await mailboxFrameIds(tabId);
  const updates = [];
  let isDetail = false;
  for (const frameId of frameIds) {
    const response = await sendTabMessageToFrame(tabId, frameId, {
      type: "SCAN_MAILBOX_DETAIL",
      enterpriseName: target.enterpriseName,
      source: target.source,
    });
    if (response?.isDetail) {
      isDetail = true;
      if (Array.isArray(response.updates)) updates.push(...response.updates);
    }
  }
  const unique = updates.filter((item, index, array) => {
    const signature = identityText(`${item.subject}|${item.date}|${String(item.snippet || "").slice(0, 180)}`);
    return array.findIndex((candidate) => identityText(`${candidate.subject}|${candidate.date}|${String(candidate.snippet || "").slice(0, 180)}`) === signature) === index;
  });
  return { updates: unique, isDetail };
}

async function scanMailboxUntilSettled(tabId, target) {
  let result = { updates: [] };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await scanMailboxFrames(tabId, target);
    if (result.updates.length) return result;
    await delay(attempt === 0 ? 1800 : 1200);
  }
  return result;
}

async function scanApplicationUntilSettled(tabId, target, mode) {
  let result = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = await sendTabMessage(tabId, {
      type: "SCAN_PAGE",
      mode,
      expectedJobTitles: target.jobTitles || [],
    });
    const auth = result?.auth || result?.application || {};
    if (auth.loginDetected || auth.needsLogin || auth.needsVerification || result?.context?.type === "recruitment") return result;
    await delay(attempt === 0 ? 1800 : 1400);
  }
  return result;
}

async function collectMailboxDetails(tabId, target, initialExcludeKeys = [], limit = 12) {
  const openedKeys = [...new Set(Array.isArray(initialExcludeKeys) ? initialExcludeKeys : [])];
  const newlyOpenedKeys = [];
  const updates = [];
  for (let index = 0; index < limit; index += 1) {
    const opened = await sendMailboxMessage(tabId, {
      type: "OPEN_MATCHING_MAIL",
      enterpriseName: target.enterpriseName,
      excludeKeys: openedKeys,
    }, (response) => response.opened);
    if (!opened?.opened || !opened.key) break;
    openedKeys.push(opened.key);
    await delay(1800);

    let detailResult = { updates: [], isDetail: false };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      detailResult = await scanMailboxDetailFrames(tabId, target);
      if (detailResult.isDetail) break;
      await delay(attempt === 0 ? 1400 : 900);
    }

    let returned = await sendTabMessageToFrame(tabId, opened.frameId, { type: "RETURN_TO_MAIL_SEARCH" });
    if (!returned?.returned && chrome.tabs.goBack) {
      try {
        await chrome.tabs.goBack(tabId);
        returned = { returned: true };
      } catch {
        returned = null;
      }
    }
    if (!returned?.returned) break;
    await delay(1400);
    if (!detailResult.isDetail) continue;
    newlyOpenedKeys.push(opened.key);
    updates.push(...detailResult.updates.map((update) => ({ ...update, mailResultKey: opened.key })));
  }
  const unique = updates.filter((item, index, array) => {
    const signature = identityText(`${item.subject}|${item.date}|${String(item.snippet || "").slice(0, 180)}`);
    return array.findIndex((candidate) => identityText(`${candidate.subject}|${candidate.date}|${String(candidate.snippet || "").slice(0, 180)}`) === signature) === index;
  });
  return { updates: unique, openedCount: newlyOpenedKeys.length, openedKeys: newlyOpenedKeys };
}

async function collectMailboxDetailsWhenReady(tabId, target, initialExcludeKeys = []) {
  let result = { updates: [], openedCount: 0, openedKeys: [] };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await collectMailboxDetails(tabId, target, initialExcludeKeys);
    if (result.openedCount || result.updates.length || attempt === 3) return result;
    await delay(attempt === 0 ? 2200 : 1400);
  }
  return result;
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title,
      message,
      priority: 1,
    });
  } catch {
    // Badge remains available when the operating system blocks notifications.
  }
}

async function runScheduledCheck(reason = "scheduled") {
  if (checkInProgress) return { started: false, reason: "already-running" };
  checkInProgress = true;

  let tabId = null;
  let changed = 0;
  let attention = 0;
  let checked = 0;
  let emailMatched = 0;
  let emailSearches = 0;
  let emailsRecorded = 0;
  let emailsQueued = 0;
  let emailsMatchedToRecords = 0;
  let emailsOpened = 0;

  try {
    const stored = await storageGet([STORAGE_KEY, MAIL_SOURCES_KEY, PROFILE_KEY, AUTOMATION_META_KEY, EMAIL_HISTORY_KEY, EMAIL_SIGNALS_KEY, EMAIL_IGNORED_KEY]);
    const allRecords = sanitizeRecords(stored[STORAGE_KEY]).filter((record) => !record.demo);
    const records = allRecords.filter(
      (record) => !record.archived && /^https:\/\//i.test(record.queryUrl || ""),
    );
    const applicationTargetMap = new Map();
    for (const record of records) {
      const url = normalizeUrl(record.queryUrl);
      if (!applicationTargetMap.has(url)) applicationTargetMap.set(url, { type: "application", ids: [], jobTitles: [], url });
      const target = applicationTargetMap.get(url);
      target.ids.push(record.id);
      if (record.jobTitle) target.jobTitles.push(record.jobTitle);
    }
    const enterprises = [...new Set(allRecords.filter((record) => !record.archived).map((record) => cleanManualEnterpriseName(record.enterpriseName)).filter(Boolean))];
    const knownMailKeysByHost = new Map();
    const rememberMailKey = (item) => {
      if (!item?.mailResultKey) return;
      const host = String(item.sourceHost || "").toLowerCase();
      if (!knownMailKeysByHost.has(host)) knownMailKeysByHost.set(host, new Set());
      knownMailKeysByHost.get(host).add(item.mailResultKey);
    };
    [stored[EMAIL_HISTORY_KEY], stored[EMAIL_SIGNALS_KEY], stored[EMAIL_IGNORED_KEY]]
      .flatMap((items) => Array.isArray(items) ? items : [])
      .forEach(rememberMailKey);
    const mailSources = mergeMailboxSources(
      mailboxSourcesFromProfile(stored[PROFILE_KEY]),
      Array.isArray(stored[MAIL_SOURCES_KEY]) ? stored[MAIL_SOURCES_KEY] : [],
    );
    if (mailSources.length) await storageSet({ [MAIL_SOURCES_KEY]: mailSources.slice(-12) });
    const mailScopes = ["inbox"];
    const mailTargets = enterprises.length
      ? mailScopes.flatMap((mailScope) => mailSources.flatMap((source) => enterprises.map((enterpriseName) => ({
          type: "mailbox-search",
          url: normalizeUrl(source.url),
          source,
          enterpriseName,
          mailScope,
        }))))
      : mailSources.map((source) => ({ type: "mailbox", url: normalizeUrl(source.url), source }));
    const targets = [
      ...Array.from(applicationTargetMap.values()).slice(0, 30),
      ...mailTargets.slice(0, 30),
    ];

    if (!targets.length) {
      await storageSet({
        [AUTOMATION_META_KEY]: {
          ...(stored[AUTOMATION_META_KEY] || {}),
          lastCheckAt: new Date().toISOString(),
          lastReason: reason,
          lastSummary: "暂无可检查的网站",
        },
      });
      return { started: true, checked: 0, changed: 0, attention: 0 };
    }

    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    tabId = tab.id;
    let loadedUrl = "about:blank";
    let mailboxShownForManualRefresh = false;

    for (const target of targets) {
      try {
        if (target.url !== loadedUrl) {
          const loading = waitForTabComplete(tabId);
          const shouldShowMailbox = reason === "manual" && target.type === "mailbox-search" && !mailboxShownForManualRefresh;
          await chrome.tabs.update(tabId, { url: target.url, active: shouldShowMailbox });
          if (shouldShowMailbox) mailboxShownForManualRefresh = true;
          await loading;
          loadedUrl = target.url;
          await delay(target.type === "application" ? 1800 : 2600);
        } else {
          await delay(500);
        }
        let searchedEnterprise = "";
        if (target.type === "mailbox-search") {
          const folderResult = await sendMailboxMessage(tabId, {
            type: "OPEN_MAILBOX_FOLDER",
            scope: target.mailScope,
          }, (response) => response.opened);
          if (!folderResult?.opened) {
            checked += 1;
            continue;
          }
          await delay(1000);
          const searchResult = await sendMailboxMessage(tabId, {
            type: "SEARCH_MAILBOX",
            enterpriseName: target.enterpriseName,
            scope: target.mailScope,
          }, (response) => response.searched);
          if (searchResult?.searched) {
            searchedEnterprise = target.enterpriseName;
            emailSearches += 1;
            await delay(1800);
          } else {
            checked += 1;
            continue;
          }
        }
        let result;
        if (searchedEnterprise) {
          const sourceHost = String(target.source?.hostname || "").toLowerCase();
          const knownKeys = [
            ...(knownMailKeysByHost.get("") || []),
            ...(knownMailKeysByHost.get(sourceHost) || []),
          ];
          const detailResult = await collectMailboxDetailsWhenReady(tabId, target, knownKeys);
          if (!knownMailKeysByHost.has(sourceHost)) knownMailKeysByHost.set(sourceHost, new Set());
          detailResult.openedKeys.forEach((key) => knownMailKeysByHost.get(sourceHost).add(key));
          emailsOpened += detailResult.openedCount || 0;
          result = detailResult;
        } else {
          result = await scanApplicationUntilSettled(tabId, target, reason);
        }
        checked += 1;

        if (target.type === "application") {
          for (const recordId of target.ids) {
            const update = await updateRecordCheck(recordId, result);
            if (update.changed) changed += 1;
            if (update.needsAttention) attention += 1;
          }
        } else if (result?.updates) {
          const updates = result.updates.map((update) => ({
            ...update,
            ...(searchedEnterprise ? { enterpriseName: searchedEnterprise } : {}),
            ...(searchedEnterprise ? { mailScope: target.mailScope || "all" } : {}),
          }));
          const emailResult = await processEmailUpdates(updates, {
            ...target.source,
            ...(searchedEnterprise ? { enterpriseName: searchedEnterprise } : {}),
            ...(searchedEnterprise ? { mailScope: target.mailScope || "all" } : {}),
          });
          emailMatched += emailResult.changed || 0;
          emailsRecorded += emailResult.recorded || 0;
          emailsQueued += emailResult.queued || 0;
          emailsMatchedToRecords += emailResult.matched || 0;
        }
      } catch {
        if (target.type === "application") {
          for (const recordId of target.ids) {
            await updateRecordCheck(recordId, null);
            attention += 1;
          }
        }
      }
    }

    const summary = `已检查 ${checked} 个页面，按企业名字搜索邮箱 ${emailSearches} 次，打开 ${emailsOpened} 封邮件详情，收录 ${emailsRecorded} 封，${emailsQueued} 封待确认。`;
    await storageSet({
      [AUTOMATION_META_KEY]: {
        lastCheckAt: new Date().toISOString(),
        lastReason: reason,
        lastSummary: summary,
        checked,
        changed: changed + emailMatched,
        attention,
        emailSearches,
        emailsRecorded,
        emailsQueued,
        emailsMatchedToRecords,
        emailsOpened,
      },
    });
    await refreshUnreadBadge();
    return {
      started: true,
      checked,
      changed: changed + emailMatched,
      attention,
      emailSearches,
      emailsRecorded,
      emailsQueued,
      emailsMatchedToRecords,
      emailsOpened,
    };
  } finally {
    if (tabId !== null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // The user may have closed the temporary tab.
      }
    }
    checkInProgress = false;
  }
}

async function runCatchUpIfNeeded() {
  const stored = await storageGet([AUTOMATION_META_KEY, SCHEDULE_KEY]);
  const lastCheck = stored[AUTOMATION_META_KEY]?.lastCheckAt
    ? new Date(stored[AUTOMATION_META_KEY].lastCheckAt)
    : null;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dueTimes = normalizeScheduleTimes(stored[SCHEDULE_KEY]).filter((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute <= currentMinutes;
  });
  if (!dueTimes.length) return;
  const [hour, minute] = dueTimes.at(-1).split(":").map(Number);
  const latestDue = new Date(now);
  latestDue.setHours(hour, minute, 0, 0);

  if (!lastCheck || lastCheck.getTime() < latestDue.getTime()) {
    await runScheduledCheck("startup-catchup");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateEnterpriseNameStorage();
  await ensureAlarms();
  const stored = await storageGet([PROFILE_KEY]);
  if (stored[PROFILE_KEY]) await saveProfile(stored[PROFILE_KEY]);
  await refreshUnreadBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateEnterpriseNameStorage();
  await ensureAlarms();
  await runCatchUpIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (isManagedAlarm(alarm.name)) {
    runScheduledCheck(alarm.name);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

function queueApplicationWrite(task) {
  const result = applicationWriteQueue.then(task, task);
  applicationWriteQueue = result.catch(() => {});
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "AUTO_CAPTURE_APPLICATION":
        if (checkInProgress) return { saved: false, reason: "refresh-in-progress" };
        return queueApplicationWrite(() => upsertApplication(message.application, { source: "automatic" }));
      case "AUTO_CAPTURE_APPLICATIONS":
        if (checkInProgress) return { saved: 0, created: 0, failed: message.applications?.length || 0, reason: "refresh-in-progress" };
        return queueApplicationWrite(() => upsertApplications(message.applications, { source: "automatic" }));
      case "PAGE_READABLE":
        if (checkInProgress) return { recovered: 0, reason: "refresh-in-progress" };
        return markPageReadable(message.queryUrl);
      case "SAVE_CAPTURED_APPLICATION":
        return queueApplicationWrite(() => upsertApplication(message.application, { manual: true, source: "manual" }));
      case "SAVE_CAPTURED_APPLICATIONS":
        return queueApplicationWrite(() => upsertApplications(message.applications, { manual: true, source: "manual" }));
      case "MAILBOX_DISCOVERED":
        if (checkInProgress) return { saved: false, reason: "refresh-in-progress" };
        await saveMailboxSource(message.source);
        return { saved: true };
      case "EMAIL_UPDATES":
        if (checkInProgress) return { matched: 0, queued: 0, reason: "refresh-in-progress" };
        return processEmailUpdates(message.updates, message.source);
      case "CONFIRM_EMAIL_SIGNAL":
        return decideEmailSignal(message.signature, "confirm");
      case "DISMISS_EMAIL_SIGNAL":
        return decideEmailSignal(message.signature, "dismiss");
      case "DELETE_EMAIL_HISTORY":
        return deleteEmailHistoryItem(message.id, message.signature);
      case "DELETE_EMAIL_HISTORY_BULK":
        return deleteEmailHistoryItems(message.items);
      case "RUN_CHECK_NOW":
        return runScheduledCheck("manual");
      case "SAVE_SCHEDULE":
        return saveScheduleTimes(message.times);
      case "SAVE_PROFILE":
        return saveProfile(message.profile);
      case "MARK_ALERTS_READ":
        return markAlertsRead(message.ids || null);
      case "GET_AUTOMATION_STATUS": {
        const stored = await storageGet([AUTOMATION_META_KEY, MAIL_SOURCES_KEY, EMAIL_SIGNALS_KEY, EMAIL_HISTORY_KEY, STORAGE_KEY, ALERTS_KEY, PROFILE_KEY, SCHEDULE_KEY]);
        const alarms = await chrome.alarms.getAll();
        const managedAlarms = alarms.filter((alarm) => isManagedAlarm(alarm.name));
        const mailSources = mergeMailboxSources(
          mailboxSourcesFromProfile(stored[PROFILE_KEY]),
          Array.isArray(stored[MAIL_SOURCES_KEY]) ? stored[MAIL_SOURCES_KEY] : [],
        );
        const nextRunAt = managedAlarms
          .map((alarm) => Number(alarm.scheduledTime || alarm.when || 0))
          .filter((value) => value > Date.now())
          .sort((a, b) => a - b)[0] || 0;
        return {
          meta: stored[AUTOMATION_META_KEY] || {},
          mailSources,
          emailSignals: stored[EMAIL_SIGNALS_KEY] || [],
          emailHistory: stored[EMAIL_HISTORY_KEY] || [],
          records: sanitizeRecords(stored[STORAGE_KEY]),
          alerts: stored[ALERTS_KEY] || [],
          profile: stored[PROFILE_KEY] || null,
          scheduleTimes: normalizeScheduleTimes(stored[SCHEDULE_KEY]),
          checkInProgress,
          alarms: managedAlarms,
          nextRunAt,
        };
      }
      default:
        return { ok: false };
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});

ensureAlarms();
migrateEnterpriseNameStorage();
