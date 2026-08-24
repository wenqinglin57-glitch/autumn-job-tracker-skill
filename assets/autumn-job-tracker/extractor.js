(function registerExtractor(global) {
  "use strict";

  const MAIL_PROVIDERS = [
    { pattern: /(^|\.)mail\.qq\.com$/i, name: "QQ邮箱" },
    { pattern: /(^|\.)exmail\.qq\.com$/i, name: "腾讯企业邮箱" },
    { pattern: /(^|\.)mail\.163\.com$/i, name: "网易163邮箱" },
    { pattern: /(^|\.)mail\.126\.com$/i, name: "网易126邮箱" },
    { pattern: /(^|\.)mail\.yeah\.net$/i, name: "网易Yeah邮箱" },
    { pattern: /(^|\.)qiye\.163\.com$/i, name: "网易企业邮箱" },
    { pattern: /(^|\.)mail\.google\.com$/i, name: "Gmail" },
    { pattern: /(^|\.)outlook\.live\.com$/i, name: "Outlook" },
    { pattern: /(^|\.)outlook\.office\.com$/i, name: "Microsoft 365 邮箱" },
    { pattern: /(^|\.)outlook\.office365\.com$/i, name: "Microsoft 365 邮箱" },
    { pattern: /(^|\.)mail\.sina\.com\.cn$/i, name: "新浪邮箱" },
    { pattern: /(^|\.)mail\.aliyun\.com$/i, name: "阿里邮箱" },
    { pattern: /(^|\.)mail\.sohu\.com$/i, name: "搜狐邮箱" },
    { pattern: /(^|\.)mail\.139\.com$/i, name: "139邮箱" },
  ];

  const APPLICATION_MARKERS = [
    "申请记录",
    "投递记录",
    "应聘记录",
    "应聘进展",
    "我的申请",
    "我的投递",
    "申请进度",
    "投递进度",
    "候选人中心",
    "招聘个人中心",
    "申请成功",
    "投递成功",
  ];

  const RECRUITMENT_WORDS = [
    "招聘",
    "应聘",
    "网申",
    "校招",
    "秋招",
    "测评",
    "笔试",
    "面试",
    "offer",
    "录用",
    "申请进度",
    "投递进度",
  ];

  function cleanText(value) {
    return String(value || "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function firstNonEmpty(...values) {
    return values.map(cleanText).find(Boolean) || "";
  }

  function textContainsAny(text, words) {
    const lower = String(text || "").toLocaleLowerCase("zh-CN");
    return words.some((word) => lower.includes(word.toLocaleLowerCase("zh-CN")));
  }

  function normalizeProgress(text, fallback = "") {
    const value = cleanText(text).toLocaleLowerCase("zh-CN");
    if (!value) return fallback;
    if (/已撤回|撤销申请|申请撤销|withdrawn/.test(value)) return "已撤回";
    if (/未通过|不合适|流程终止|淘汰|拒绝|遗憾|unsuccessful|rejected|declined/.test(value)) return "未通过";
    // 招聘网站常把“投递—测评—面试—Offer”作为完整流程同时展示。
    // 当页面同时明确说明仍在评估/筛选中时，后续未激活的 Offer 标签不能覆盖实际状态。
    if (/简历评估中|简历筛选|筛选中|审核中|处理中|under review|screening/.test(value)) return "简历筛选";
    if (/已成功投递|投递成功|已投递|投递简历|申请成功|已申请|submitted|application received/.test(value)) return "已投递";
    if (/offer|录用|拟录取|意向书|签约通知/.test(value)) return "Offer";
    if (/hr\s*面|人力面|终面|final interview/.test(value)) return "HR面";
    if (/二面|第二轮面试|复试|second interview/.test(value)) return "二面";
    if (/一面|第一轮面试|初面|面试邀请|interview/.test(value)) return "一面";
    if (/笔试|机考|线上考试|written test/.test(value)) return "笔试";
    if (/测评|在线测试|人才评估|assessment/.test(value)) return "测评";
    return fallback;
  }

  function todayLocal() {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function normalizeDate(value) {
    const text = cleanText(value);
    let match = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    match = text.match(/(?:^|\D)(\d{1,2})[月./-](\d{1,2})日?(?:\D|$)/);
    if (match) return `${new Date().getFullYear()}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    return "";
  }

  function normalizeDateTime(value) {
    const text = cleanText(value);
    let match = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?(?:\s*(?:周[一二三四五六日天])?)?(?:\s*(\d{1,2})[:：](\d{2}))?/);
    if (match) {
      const hour = String(match[4] || (/截止|完成/i.test(text) ? "23" : "09")).padStart(2, "0");
      const minute = String(match[5] || (/截止|完成/i.test(text) ? "59" : "00")).padStart(2, "0");
      return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T${hour}:${minute}`;
    }
    match = text.match(/(?:^|\D)(\d{1,2})月(\d{1,2})日?(?:\s*(?:周[一二三四五六日天])?)?(?:\s*(\d{1,2})[:：](\d{2}))?/);
    if (match) {
      const hour = String(match[3] || (/截止|完成/i.test(text) ? "23" : "09")).padStart(2, "0");
      const minute = String(match[4] || (/截止|完成/i.test(text) ? "59" : "00")).padStart(2, "0");
      return `${new Date().getFullYear()}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}T${hour}:${minute}`;
    }
    return "";
  }

  function extractDeadline(bodyText) {
    const labelled = matchLabel(
      bodyText,
      ["截止时间", "完成时间", "完成截止", "测评时间", "笔试时间", "考试时间", "面试时间", "面试日期", "报到时间", "请于"],
      100,
    );
    if (labelled) {
      const deadlineHint = /截止时间|完成截止|请于/.test(String(bodyText || "")) ? "截止 " : "";
      const normalized = normalizeDateTime(`${deadlineHint}${labelled}`);
      if (normalized) return normalized;
    }
    const sentence = String(bodyText || "").match(/(?:截止时间|完成时间|测评时间|笔试时间|考试时间|面试时间|面试日期|请于)[：:\s]*([^\n。；;]{4,100})/i);
    return normalizeDateTime(sentence?.[0] || "");
  }

  function matchLabel(text, labels, maxLength = 80) {
    const labelPattern = labels.join("|");
    const expression = new RegExp(`(?:${labelPattern})\\s*[：:]?\\s*([^\\n|｜]{1,${maxLength}})`, "i");
    const match = String(text || "").match(expression);
    return cleanText(match?.[1] || "")
      .replace(/\s{2,}.*/, "")
      .split(/\s+(?=(?:公司名称|岗位名称|职位名称|当前状态|申请状态|投递状态|工作地点|投递日期|申请日期|恭喜|邀请|进入|20\d{2}[年./-]))/i)[0];
  }

  function readMeta(doc, names) {
    for (const name of names) {
      const node = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      if (node?.content) return cleanText(node.content);
    }
    return "";
  }

  function flattenJsonLd(value, output = []) {
    if (!value) return output;
    if (Array.isArray(value)) {
      value.forEach((item) => flattenJsonLd(item, output));
      return output;
    }
    if (typeof value === "object") {
      output.push(value);
      if (value["@graph"]) flattenJsonLd(value["@graph"], output);
    }
    return output;
  }

  function findJobPosting(doc) {
    const entries = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        flattenJsonLd(JSON.parse(script.textContent), entries);
      } catch {
        // Invalid structured data on third-party pages is ignored.
      }
    });
    return entries.find((entry) => {
      const types = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
      return types.some((type) => String(type).toLowerCase() === "jobposting");
    });
  }

  function jobLocationFromJson(job) {
    const locations = Array.isArray(job?.jobLocation) ? job.jobLocation : [job?.jobLocation];
    return locations
      .filter(Boolean)
      .map((location) => {
        const address = location.address || location;
        return firstNonEmpty(address.addressLocality, address.addressRegion, address.addressCountry?.name, address.addressCountry);
      })
      .filter(Boolean)
      .join(" / ");
  }

  function guessJobTitle(doc, bodyText, job) {
    const labelled = matchLabel(bodyText, ["岗位名称", "职位名称", "应聘职位", "申请职位", "投递岗位", "职位"], 80);
    const heading = cleanText(doc.querySelector("h1")?.textContent);
    return firstNonEmpty(job?.title, labelled, heading, readMeta(doc, ["og:title"]));
  }

  function guessLocation(doc, bodyText, job) {
    const labelled = matchLabel(bodyText, ["工作地点", "工作城市", "职位地点", "办公地点", "地点", "Location"], 60);
    return firstNonEmpty(jobLocationFromJson(job), labelled);
  }

  function guessAppliedDate(bodyText) {
    const labelled = matchLabel(bodyText, ["投递日期", "申请日期", "投递时间", "申请时间", "提交时间"], 40);
    return normalizeDate(labelled || bodyText.slice(0, 5000)) || todayLocal();
  }

  function currentPageUrl(locationLike) {
    try {
      return new URL(locationLike?.href || "").href;
    } catch {
      return cleanText(locationLike?.href);
    }
  }

  function detectMailboxProvider(hostname, bodyText = "") {
    const host = String(hostname || "").toLowerCase().replace(/:\d+$/, "");
    const known = MAIL_PROVIDERS.find((provider) => provider.pattern.test(host));
    if (known) return { name: known.name, hostname: host, generic: false };
    if (/(^|\.)(mail|webmail)[.-]/i.test(host) || /(^|\.)(mail|webmail)$/i.test(host)) {
      return { name: "企业或自建邮箱", hostname: host, generic: true };
    }
    if (textContainsAny(bodyText.slice(0, 2000), ["收件箱", "inbox", "写邮件", "compose"]) && /mail/i.test(host)) {
      return { name: "网页邮箱", hostname: host, generic: true };
    }
    return null;
  }

  function detectEmailProviderFromAddress(address) {
    const domain = cleanText(address).toLowerCase().split("@").at(-1) || "";
    const providers = [
      { pattern: /^(qq|foxmail)\.com$/, name: "QQ邮箱", webmailUrl: "https://mail.qq.com/" },
      { pattern: /^163\.com$/, name: "网易163邮箱", webmailUrl: "https://mail.163.com/" },
      { pattern: /^126\.com$/, name: "网易126邮箱", webmailUrl: "https://mail.126.com/" },
      { pattern: /^yeah\.net$/, name: "网易Yeah邮箱", webmailUrl: "https://mail.yeah.net/" },
      { pattern: /^gmail\.com$/, name: "Gmail", webmailUrl: "https://mail.google.com/" },
      { pattern: /^(outlook|hotmail|live)\.(com|cn)$/, name: "Outlook", webmailUrl: "https://outlook.live.com/mail/" },
      { pattern: /^sina\.(com|cn)$/, name: "新浪邮箱", webmailUrl: "https://mail.sina.com.cn/" },
      { pattern: /^(aliyun|alibaba-inc)\.com$/, name: "阿里邮箱", webmailUrl: "https://mail.aliyun.com/" },
      { pattern: /^sohu\.com$/, name: "搜狐邮箱", webmailUrl: "https://mail.sohu.com/" },
      { pattern: /^139\.com$/, name: "139邮箱", webmailUrl: "https://mail.10086.cn/" },
    ];
    const provider = providers.find((item) => item.pattern.test(domain));
    return provider
      ? { name: provider.name, domain, webmailUrl: provider.webmailUrl, generic: false }
      : { name: domain ? "企业或其他邮箱" : "未知邮箱", domain, webmailUrl: "", generic: true };
  }

  function detectAuthState(bodyText) {
    const sample = cleanText(bodyText).slice(0, 12000);
    const needsLogin = /请先登录|登录后查看|账号登录|扫码登录|sign in to continue|log in to continue/i.test(sample);
    const hasStandaloneLogin = /(?:^|\n)\s*(?:登录|立即登录)\s*(?=\n|$)/im.test(sample);
    return {
      needsLogin,
      loginDetected: needsLogin || hasStandaloneLogin,
      needsVerification: /短信验证码|手机验证码|安全验证|身份验证|滑块验证|captcha|verification code/i.test(sample),
    };
  }

  function parseCombinedApplicationTitle(rawTitle) {
    const original = cleanText(rawTitle);
    const applicationKey = cleanText(original.match(/[（(]([A-Za-z]{0,4}\d{3,})[）)]/)?.[1]);
    const cleaned = original
      .replace(/^第\s*\d+\s*志愿\s*/i, "")
      .replace(/[（(][A-Za-z]{0,4}\d{3,}[）)]\s*$/, "")
      .replace(/[-—–]?20\d{2}届?[^-—–\n]*(?:校招|校园招聘|应届招聘)[^-—–\n]*$/i, "")
      .trim();
    const parts = cleaned.split(/\s*[-—–]\s*/).map(cleanText).filter(Boolean);
    parts.shift();
    let locationText = "";

    if (parts[0] && /(分公司|支公司|子公司|区域中心|地区中心|省分|市分)$/.test(parts[0])) {
      locationText = parts
        .shift()
        .replace(/(分公司|支公司|子公司|区域中心|地区中心|省分|市分)$/, "")
        .replace(/^(中国|全国)/, "");
    }

    const jobTitle = parts.join("-") || cleaned;
    return { jobTitle, location: locationText, applicationKey, rawTitle: original };
  }

  function applicationCardText(element) {
    return cleanText(element?.innerText || element?.textContent);
  }

  function isApplicationCard(element) {
    const text = applicationCardText(element);
    const hasStandardProgress = /当前进度\s*[：:]/.test(text);
    const hasSubmittedDate = /20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}[^\n]{0,20}投递/.test(text);
    const hasSimpleSubmission = /投递简历|已投递|投递成功|申请成功/.test(text) && /20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}/.test(text);
    return (
      text.length >= 20 &&
      text.length <= 2500 &&
      ((hasStandardProgress && hasSubmittedDate) || hasSimpleSubmission)
    );
  }

  function findApplicationCards(doc) {
    const candidates = Array.from(doc.querySelectorAll("article, li, tr, section, div")).filter(isApplicationCard);
    return candidates
      .filter((element) => !Array.from(element.children).some(isApplicationCard))
      .slice(0, 60);
  }

  function extractApplicationCards(doc = document, locationLike = location) {
    const pageUrl = currentPageUrl(locationLike);
    const auth = detectAuthState(doc.body?.innerText || "");
    const seen = new Set();
    const applications = [];

    for (const card of findApplicationCards(doc)) {
      const text = applicationCardText(card);
      const titleMatch = text.match(/第\s*\d+\s*志愿\s*([\s\S]*?)(?=\s*当前进度\s*[：:])/);
      const lines = text.split("\n").map(cleanText).filter(Boolean);
      const fallbackTitle = lines.find(
        (line) =>
          !/当前进度|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}|校园招聘|查看|打印|撤销/.test(line) &&
          line.length >= 5,
      );
      const rawTitle = cleanText(titleMatch?.[1] || fallbackTitle || "");
      if (!rawTitle) continue;

      const parsed = parseCombinedApplicationTitle(rawTitle);
      const appliedMatch = text.match(/(20\d{2}[年./-]\d{1,2}[月./-]\d{1,2})(?:\s+\d{1,2}[:：]\d{2})?\s*投递/) || text.match(/(20\d{2}[年./-]\d{1,2}[月./-]\d{1,2})/);
      const progressLine = text.match(/当前进度\s*[：:]\s*([^\n]{1,80})/i)?.[1] || text;
      const signature = parsed.applicationKey || parsed.rawTitle;
      if (!parsed.jobTitle || seen.has(signature)) continue;
      seen.add(signature);

      applications.push({
        jobTitle: parsed.jobTitle,
        location: parsed.location || matchLabel(text, ["工作地点", "工作城市", "职位地点", "意向城市"], 60).replace(/^[①②③④⑤⑥⑦⑧⑨⑩\s]+/, "") || "待确认",
        appliedDate: normalizeDate(appliedMatch?.[1]) || todayLocal(),
        progress: normalizeProgress(progressLine, "已投递"),
        deadline: extractDeadline(text),
        queryUrl: pageUrl,
        sourceDomain: locationLike?.hostname || "",
        pageTitle: cleanText(doc.title),
        applicationKey: parsed.applicationKey,
        rawTitle: parsed.rawTitle,
        confidence: 96,
        confirmedApplicationPage: true,
        evidence: ["投递记录卡片", "当前进度", "投递时间"],
        ...auth,
      });
    }

    return applications;
  }

  function extractApplication(doc = document, locationLike = location) {
    const bodyText = cleanText(doc.body?.innerText).slice(0, 300000);
    const job = findJobPosting(doc);
    const url = currentPageUrl(locationLike);
    const jobTitle = guessJobTitle(doc, bodyText, job);
    const locationText = guessLocation(doc, bodyText, job);
    const progress = normalizeProgress(bodyText, "已投递");
    const markers = APPLICATION_MARKERS.filter((marker) => bodyText.includes(marker));
    const urlLooksRelevant = /\/(apply|application|applications|candidate|career|careers|job|jobs|recruit|resume)(\/|\?|$)/i.test(url);
    const auth = detectAuthState(bodyText);

    let confidence = 0;
    if (job) confidence += 24;
    if (markers.length) confidence += Math.min(38, 22 + markers.length * 6);
    if (jobTitle) confidence += 22;
    if (locationText) confidence += 8;
    if (normalizeProgress(bodyText)) confidence += 14;
    if (urlLooksRelevant) confidence += 8;
    if (auth.needsLogin) confidence -= 30;

    return {
      jobTitle,
      location: locationText,
      appliedDate: guessAppliedDate(bodyText),
      progress,
      deadline: extractDeadline(bodyText),
      queryUrl: url,
      sourceDomain: locationLike?.hostname || "",
      pageTitle: cleanText(doc.title),
      confidence: Math.max(0, Math.min(100, confidence)),
      confirmedApplicationPage: markers.length > 0,
      evidence: markers.slice(0, 4),
      ...auth,
    };
  }

  function candidateMailNodes(doc, enterpriseName = "") {
    const selector = [
      "tr",
      "li",
      "article",
      "[role='row']",
      "[role='option']",
      "[role='listitem']",
      "[data-thread-id]",
      "[data-message-id]",
      "[data-convid]",
      "[class*='subject']",
      "[class*='mail']",
      "[class*='message']",
    ].join(",");
    const candidates = Array.from(doc.querySelectorAll(selector)).slice(0, 1200);
    const expectedEnterprise = cleanText(enterpriseName).toLocaleLowerCase("zh-CN");
    if (!expectedEnterprise) return candidates;

    const broadMatches = Array.from(doc.querySelectorAll(
      "div, a, button, section, [role='link'], [role='button'], [role='gridcell'], [role='cell']",
    ))
      .slice(0, 6000)
      .filter((element) => {
        if (element.getAttribute("aria-hidden") === "true" || element.closest("form, [role='search']")) return false;
        const text = cleanText(element.innerText || element.textContent);
        return text.length >= expectedEnterprise.length + 2 && text.length <= 1200 && text.toLocaleLowerCase("zh-CN").includes(expectedEnterprise);
      })
      .map((element) => element.closest(
        "tr, li, article, [role='row'], [role='option'], [role='listitem'], [data-thread-id], [data-message-id], [data-convid]",
      ) || element);

    return [...new Set([...candidates, ...broadMatches])].slice(0, 1800);
  }

  function extractRecruitmentUpdates(doc = document, provider = null, options = {}) {
    const seen = new Set();
    const updates = [];
    const enterpriseName = cleanText(options.enterpriseName).toLocaleLowerCase("zh-CN");

    for (const node of candidateMailNodes(doc, enterpriseName)) {
      const text = cleanText(node.innerText || node.textContent);
      const textLower = text.toLocaleLowerCase("zh-CN");
      const matchesEnterprise = Boolean(enterpriseName && textLower.includes(enterpriseName));
      if (text.length < 4 || text.length > 1200) continue;
      if (enterpriseName ? !matchesEnterprise : !textContainsAny(text, RECRUITMENT_WORDS)) continue;
      const signature = text.replace(/\s/g, "").slice(0, 180);
      if (seen.has(signature)) continue;
      seen.add(signature);

      const progress = normalizeProgress(text, "");
      const jobTitle = matchLabel(text, ["岗位名称", "职位名称", "应聘职位", "申请职位", "投递岗位", "岗位"], 80);
      updates.push({
        provider: provider?.name || "网页邮箱",
        jobTitle,
        progress,
        deadline: extractDeadline(text),
        date: normalizeDate(text) || todayLocal(),
        subject: cleanText(text.split("\n")[0]).slice(0, 140),
        snippet: text.slice(0, 320),
      });

      if (updates.length >= 30) break;
    }

    return updates;
  }

  function detectContext(doc = document, locationLike = location) {
    const mailbox = detectMailboxProvider(locationLike?.hostname, "");
    if (mailbox) return { type: "mailbox", mailbox };

    const bodyText = cleanText(doc.body?.innerText).slice(0, 12000);
    const genericMailbox = detectMailboxProvider(locationLike?.hostname, bodyText);
    if (genericMailbox) return { type: "mailbox", mailbox: genericMailbox };
    const applications = extractApplicationCards(doc, locationLike);
    if (applications.length) {
      return { type: "recruitment", applications, application: applications[0] };
    }

    const application = extractApplication(doc, locationLike);
    if (application.confirmedApplicationPage || application.confidence >= 58) {
      return { type: "recruitment", application };
    }
    const labelledJobTitle = matchLabel(bodyText, ["岗位名称", "职位名称", "应聘职位", "申请职位", "投递岗位"], 80);
    if (labelledJobTitle) {
      return {
        type: "recruitment",
        application: { ...application, jobTitle: labelledJobTitle, evidence: ["岗位名称"], confidence: Math.max(application.confidence, 40) },
      };
    }
    return { type: "other" };
  }

  global.AutumnRecruitExtractor = {
    cleanText,
    detectAuthState,
    detectContext,
    detectEmailProviderFromAddress,
    detectMailboxProvider,
    extractApplication,
    extractApplicationCards,
    extractDeadline,
    extractRecruitmentUpdates,
    normalizeDate,
    normalizeDateTime,
    normalizeProgress,
    todayLocal,
  };
})(globalThis);
