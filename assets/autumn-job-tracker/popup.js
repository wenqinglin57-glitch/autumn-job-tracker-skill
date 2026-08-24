"use strict";

const PENDING_CAPTURE_KEY = "autumn-job-tracker-pending-capture-v1";

const elements = {
  contextIcon: document.querySelector("#contextIcon"),
  contextTitle: document.querySelector("#contextTitle"),
  contextText: document.querySelector("#contextText"),
  captureButton: document.querySelector("#captureButton"),
  runNowButton: document.querySelector("#runNowButton"),
  openDashboardButton: document.querySelector("#openDashboardButton"),
  recordCount: document.querySelector("#recordCount"),
  mailCount: document.querySelector("#mailCount"),
  signalCount: document.querySelector("#signalCount"),
  lastCheckText: document.querySelector("#lastCheckText"),
  updatesCard: document.querySelector("#updatesCard"),
  popupUpdates: document.querySelector("#popupUpdates"),
  markAlertsRead: document.querySelector("#markPopupAlertsRead"),
  toast: document.querySelector("#popupToast"),
};

let activeTab = null;
let activeContext = null;
let toastTimer = null;

function runtimeMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function tabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function extensionSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2000);
}

function formatTime(value) {
  if (!value) return "尚未执行自动检查";
  const date = new Date(value);
  return `${date.toLocaleString("zh-CN", { hour12: false })} 完成检查`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function missingScrapedFields(application = {}) {
  const missing = [];
  if (!application.jobTitle) missing.push("岗位名称");
  if (!application.location || application.location === "待确认") missing.push("工作地点");
  if (!application.appliedDate) missing.push("投递日期");
  if (!application.progress) missing.push("当前进度");
  return missing;
}

function renderUpdates(alerts) {
  const unread = (alerts || []).filter((alert) => !alert.read);
  elements.updatesCard.hidden = unread.length === 0;
  elements.popupUpdates.innerHTML = unread
    .slice(0, 4)
    .map((alert) => {
      const created = new Date(alert.createdAt);
      const time = Number.isNaN(created.getTime()) ? "刚刚" : created.toLocaleString("zh-CN", { hour12: false });
      const alertClass = alert.type === "process-ended" ? "negative" : alert.type === "login-failed" ? "auth" : "";
      return `<article class="popup-update ${alertClass}">
        <strong>${escapeHtml(alert.title)}</strong>
        <span>${escapeHtml(alert.message)}</span>
        <time>新增于 ${escapeHtml(time)}</time>
      </article>`;
    })
    .join("");
}

function displayContext(response) {
  activeContext = response;
  if (!response) {
    elements.contextIcon.textContent = "!";
    elements.contextTitle.textContent = "此页面无法自动识别";
    elements.contextText.textContent = "可以先保存当前网页链接，再手动填写投递信息";
    elements.captureButton.textContent = "保存链接并手动填写";
    elements.captureButton.disabled = !/^https:\/\//i.test(activeTab?.url || "");
    return;
  }

  elements.captureButton.disabled = false;

  if (response.context?.type === "mailbox") {
    elements.contextIcon.textContent = "✉";
    elements.contextTitle.textContent = response.context.mailbox.name;
    elements.contextText.textContent = `识别到 ${response.updates?.length || 0} 封秋招相关邮件，将按企业名字和岗位名称匹配投递记录`;
    elements.captureButton.textContent = "抓取当前邮箱招聘邮件";
    return;
  }

  const applications = response.applications || (response.application ? [response.application] : []);
  const application = applications[0];
  if (response.context?.type === "recruitment" || application?.confidence >= 42) {
    const incomplete = applications.filter((item) => missingScrapedFields(item).length);
    elements.contextIcon.textContent = "职";
    elements.contextTitle.textContent = applications.length > 1
      ? `识别到 ${applications.length} 条投递记录`
      : application?.jobTitle || application?.pageTitle || "招聘页面";
    elements.contextText.textContent = incomplete.length
      ? `还有信息未识别：${missingScrapedFields(incomplete[0]).join("、")}；请在表单中补充并手动填写企业名字`
      : application?.jobTitle
        ? `${application.jobTitle} · 信息已预填，企业名字需要你手动填写`
        : "已识别投递记录";
    elements.captureButton.textContent = incomplete.length
      ? "打开表单并手动填写"
      : applications.length > 1
        ? `逐条填写 ${applications.length} 个企业名字`
        : "填写企业名字并保存";
    return;
  }

  elements.contextIcon.textContent = "⌕";
  elements.contextTitle.textContent = "没有识别到完整投递信息";
  elements.contextText.textContent = "可以打开手动表单补充，当前网页地址会自动填写";
  elements.captureButton.textContent = "手动填写当前投递";
}

function openManualEntry() {
  const params = new URLSearchParams({
    new: "1",
    manualOnly: "1",
    queryUrl: activeTab?.url || "",
  });
  chrome.tabs.create({ url: `${chrome.runtime.getURL("index.html")}?${params.toString()}` });
  window.close();
}

async function openCapturedApplications(applications) {
  const safeApplications = applications.map((application) => {
    const {
      company: _company,
      companySource: _companySource,
      enterpriseName: _enterpriseName,
      enterpriseNameSource: _enterpriseNameSource,
      ...safeApplication
    } = application;
    return {
      ...safeApplication,
      queryUrl: activeTab?.url || application.queryUrl || "",
    };
  });
  await extensionSet({
    [PENDING_CAPTURE_KEY]: {
      createdAt: new Date().toISOString(),
      applications: safeApplications,
    },
  });
  chrome.tabs.create({ url: `${chrome.runtime.getURL("index.html")}?capture=1` });
  window.close();
}

async function refreshStatus() {
  const status = await runtimeMessage({ type: "GET_AUTOMATION_STATUS" });
  if (!status) return;
  elements.recordCount.textContent = (status.records || []).filter((record) => !record.demo).length;
  elements.mailCount.textContent = status.profile?.emails?.length || 0;
  elements.signalCount.textContent = (status.emailSignals || []).length;
  renderUpdates(status.alerts || []);
  elements.lastCheckText.textContent = status.meta?.lastSummary
    ? `${formatTime(status.meta.lastCheckAt)}：${status.meta.lastSummary}`
    : formatTime(status.meta?.lastCheckAt);
}

async function inspectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  if (!activeTab?.id || !/^https:\/\//i.test(activeTab.url || "")) {
    displayContext(null);
    return;
  }
  const response = await tabMessage(activeTab.id, { type: "CAPTURE_PAGE" });
  displayContext(response);
}

elements.captureButton.addEventListener("click", async () => {
  if (!activeTab?.id) return;
  elements.captureButton.disabled = true;
  const response = await tabMessage(activeTab.id, { type: "CAPTURE_PAGE" });

  if (response?.context?.type === "mailbox") {
    const result = await runtimeMessage({
      type: "EMAIL_UPDATES",
      updates: response.updates || [],
      source: response.source,
    });
    showToast(`已匹配 ${result?.matched || 0} 封，待确认 ${result?.queued || 0} 封`);
    elements.captureButton.disabled = false;
    await refreshStatus();
    return;
  }

  if (!response || response.context?.type === "other") {
    openManualEntry();
    return;
  }
  const applications = response.applications || (response.application ? [response.application] : []);
  if (!applications.length) {
    openManualEntry();
    return;
  }
  await openCapturedApplications(applications);
});

elements.runNowButton.addEventListener("click", async () => {
  elements.runNowButton.disabled = true;
  const result = await runtimeMessage({ type: "RUN_CHECK_NOW" });
  showToast(result?.reason === "already-running"
    ? "已有一次检查正在运行"
    : `检查完成：邮箱搜索 ${result?.emailSearches || 0} 次，发现 ${result?.changed || 0} 条新状态`);
  elements.runNowButton.disabled = false;
  refreshStatus();
});

elements.openDashboardButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

elements.markAlertsRead.addEventListener("click", async () => {
  await runtimeMessage({ type: "MARK_ALERTS_READ" });
  showToast("新动态已标为已读");
  await refreshStatus();
});

Promise.all([refreshStatus(), inspectActiveTab()]);
