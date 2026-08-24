(function startAutumnRecruitScanner() {
  "use strict";

  const extractor = globalThis.AutumnRecruitExtractor;
  if (!extractor) return;

  let lastApplicationSignature = "";
  let lastMailSignature = "";
  let lastMailboxUrl = "";
  let lastOpenedMail = null;
  let lastReadablePageUrl = "";

  function send(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch {
      // The extension may have been reloaded while this page was open.
    }
  }

  function hasCompleteRequiredFields(application) {
    return Boolean(
      application?.jobTitle &&
      application?.location &&
      application.location !== "待确认" &&
      application?.appliedDate &&
      application?.progress,
    );
  }

  function pageContainsExpectedJobTitle(expectedJobTitles = []) {
    const pageText = extractor.cleanText(document.body?.innerText || "").toLocaleLowerCase("zh-CN");
    if (!pageText) return false;
    return (Array.isArray(expectedJobTitles) ? expectedJobTitles : [])
      .map((title) => extractor.cleanText(title).toLocaleLowerCase("zh-CN"))
      .filter((title) => title.length >= 3)
      .some((title) => pageText.includes(title));
  }

  function scanPage({ automatic = true, forceMailbox = false, enterpriseName = "", mailboxSource = null, expectedJobTitles = [] } = {}) {
    const detectedContext = extractor.detectContext(document, location);
    const forcedMailbox = forceMailbox
      ? {
          name: mailboxSource?.provider || detectedContext.mailbox?.name || "网页邮箱",
          hostname: mailboxSource?.hostname || location.hostname,
        }
      : null;
    const hasExpectedJobTitle = pageContainsExpectedJobTitle(expectedJobTitles);
    const context = forcedMailbox
      ? { type: "mailbox", mailbox: forcedMailbox }
      : detectedContext.type === "other" && hasExpectedJobTitle
        ? { type: "recruitment", application: extractor.extractApplication(document, location), evidence: ["已保存岗位名称"] }
        : detectedContext;

    if (context.type === "mailbox") {
      const source = {
        provider: context.mailbox.name,
        hostname: context.mailbox.hostname,
        url: mailboxSource?.url || location.href,
        detectedAt: new Date().toISOString(),
      };
      const updates = extractor.extractRecruitmentUpdates(document, context.mailbox, { enterpriseName });
      const signature = JSON.stringify(
        updates.map((item) => [item.subject, item.progress, item.deadline, item.date]),
      );

      if (automatic && source.url !== lastMailboxUrl) {
        lastMailboxUrl = source.url;
        send({ type: "MAILBOX_DISCOVERED", source });
      }
      if (automatic && updates.length && signature !== lastMailSignature) {
        lastMailSignature = signature;
        send({ type: "EMAIL_UPDATES", updates, source });
      }
      return {
        context,
        updates,
        source,
        auth: extractor.detectAuthState(document.body?.innerText || ""),
      };
    }

    const application = context.application || extractor.extractApplication(document, location);
    const applications = context.applications?.length ? context.applications : [application];
    const signature = JSON.stringify(
      applications.map((item) => [item.applicationKey, item.jobTitle, item.progress, item.queryUrl]),
    );
    const capturable = applications.filter(
      (item) =>
        item.confirmedApplicationPage &&
        item.confidence >= 72 &&
        !item.needsLogin &&
        !item.needsVerification &&
        hasCompleteRequiredFields(item),
    );

    const auth = extractor.detectAuthState(document.body?.innerText || "");
    if (
      automatic &&
      context.type === "recruitment" &&
      !auth.needsLogin &&
      !auth.needsVerification &&
      location.href !== lastReadablePageUrl
    ) {
      lastReadablePageUrl = location.href;
      send({ type: "PAGE_READABLE", queryUrl: location.href });
    }

    if (
      automatic &&
      document.visibilityState === "visible" &&
      capturable.length &&
      signature !== lastApplicationSignature
    ) {
      lastApplicationSignature = signature;
      send({ type: "AUTO_CAPTURE_APPLICATIONS", applications: capturable });
    }

    return {
      context: { type: context.type, application, applications },
      application,
      applications,
      auth,
    };
  }

  function mailboxSearchQuery(enterpriseName, scope) {
    const quoted = `"${enterpriseName.replaceAll('"', "").trim()}"`;
    if (/mail\.google\.com$/i.test(location.hostname)) {
      if (scope === "inbox") return `in:inbox ${quoted}`;
      if (scope === "spam") return `in:spam ${quoted}`;
      if (scope === "promotions") return `category:promotions ${quoted}`;
      return `in:inbox ${quoted}`;
    }
    return enterpriseName;
  }

  function openMailboxFolder(scope) {
    if (scope === "all") return { opened: true, scope };
    const patterns = {
      inbox: /^(收件箱|收信|Inbox)$/i,
      spam: /^(垃圾邮件|垃圾箱|垃圾邮件箱|Spam|Junk|Junk Email)$/i,
      promotions: /^(广告邮件|推广邮件|推广|促销|Promotions|Advertising|订阅邮件)$/i,
    };
    const pattern = patterns[scope];
    if (!pattern) return { opened: false, scope, reason: "unknown-scope" };
    const candidates = Array.from(document.querySelectorAll(
      "a, button, [role='link'], [role='button'], [role='treeitem'], [role='tab']",
    ));
    const target = candidates.find((element) => {
      const label = String(element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();
      const labelWithoutCount = label.replace(/\s*[（(]?\d+[）)]?\s*$/, "").trim();
      return pattern.test(labelWithoutCount);
    });
    if (!target && scope === "inbox") return { opened: true, scope, reason: "already-or-default-inbox" };
    if (!target) return { opened: false, scope, reason: "folder-not-found" };
    target.click();
    return { opened: true, scope };
  }

  function searchMailbox(query, scope = "all") {
    const enterpriseName = String(query || "").trim();
    if (!enterpriseName) return { searched: false, reason: "missing-enterprise" };
    const searchQuery = mailboxSearchQuery(enterpriseName, scope);

    const candidates = Array.from(document.querySelectorAll(
      "input[type='search'], input[placeholder], input[aria-label], input[name], input[id], [role='searchbox'], [contenteditable='true'][role='combobox'], [contenteditable='true'][aria-label]",
    ));
    const negativePattern = /\bai\b|assistant|chat|contact|people|\u667a\u80fd|\u8054\u7cfb\u4eba|\u901a\u8baf\u5f55|\u804a\u5929|\u95ee\u4e00\u95ee/i;
    const fullTextPattern = /full[\s-]*text|search\s+(mail|messages|inbox)|\u5168\u6587\u641c\u7d22|\u641c\u7d22\u90ae\u4ef6|\u641c\u90ae\u4ef6|\u90ae\u4ef6\u641c\u7d22|\u641c\u7d22\u6536\u4ef6\u7bb1|\u5728\u90ae\u4ef6\u4e2d\u641c\u7d22/i;
    const genericPattern = /^(search|\u641c\u7d22)$/i;
    const scored = candidates
      .filter((element) => !element.disabled && element.getAttribute("aria-hidden") !== "true")
      .map((element) => {
        const metadata = [
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("name"),
          element.getAttribute("id"),
          element.getAttribute("data-placeholder"),
        ].filter(Boolean).join(" ").trim();
        if (negativePattern.test(metadata)) return { element, score: -1 };
        let score = fullTextPattern.test(metadata) ? 100 : 0;
        if (genericPattern.test(metadata)) score = Math.max(score, 60);
        if (element.getAttribute("role") === "searchbox") score += 15;
        if (element instanceof HTMLInputElement && element.type === "search") score += 10;
        return { element, score };
      })
      .filter((candidate) => candidate.score >= 60)
      .sort((left, right) => right.score - left.score);
    const input = scored[0]?.element;
    if (!input) return { searched: false, reason: "full-text-search-box-not-found" };

    input.focus();
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (valueSetter) valueSetter.call(input, searchQuery);
      else input.value = searchQuery;
    } else {
      input.textContent = searchQuery;
    }
    input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: searchQuery }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: searchQuery }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const searchContainers = [];
    let ancestor = input.parentElement;
    for (let depth = 0; ancestor && depth < 9; depth += 1, ancestor = ancestor.parentElement) {
      searchContainers.push(ancestor);
    }
    if (input.form && !searchContainers.includes(input.form)) searchContainers.unshift(input.form);
    const buttonDepth = new Map();
    searchContainers.forEach((container, depth) => {
      Array.from(container.querySelectorAll("button, a, [role='button'], [onclick], [class*='search' i], [data-testid*='search' i]")).forEach((button) => {
        if (!buttonDepth.has(button)) buttonDepth.set(button, depth);
      });
    });
    let searchButton = [...buttonDepth.entries()]
      .map(([button, depth]) => ({ button, depth }))
      .filter(({ button }) => {
      const metadata = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.getAttribute("class"),
        button.innerText,
        button.textContent,
      ].filter(Boolean).join(" ").trim();
      if (negativePattern.test(metadata)) return false;
      const isIconSearchControl = /search|\u641c\u7d22/i.test(metadata) && !button.matches("input, textarea, select");
      return button.getAttribute("type") === "submit" || fullTextPattern.test(metadata) || genericPattern.test(metadata) || isIconSearchControl;
      })
      .sort((left, right) => {
        const leftLabel = [left.button.getAttribute("aria-label"), left.button.getAttribute("title"), left.button.getAttribute("data-testid"), left.button.getAttribute("class"), left.button.innerText, left.button.textContent].filter(Boolean).join(" ");
        const rightLabel = [right.button.getAttribute("aria-label"), right.button.getAttribute("title"), right.button.getAttribute("data-testid"), right.button.getAttribute("class"), right.button.innerText, right.button.textContent].filter(Boolean).join(" ");
        const leftScore = (fullTextPattern.test(leftLabel) ? 100 : 0) + (left.button.getAttribute("type") === "submit" ? 30 : 0) + (/search|\u641c\u7d22/i.test(leftLabel) ? 20 : 0) - left.depth;
        const rightScore = (fullTextPattern.test(rightLabel) ? 100 : 0) + (right.button.getAttribute("type") === "submit" ? 30 : 0) + (/search|\u641c\u7d22/i.test(rightLabel) ? 20 : 0) - right.depth;
        return rightScore - leftScore;
      })[0]?.button;
    if (!searchButton) {
      searchButton = Array.from(document.querySelectorAll("button, a, [role='button'], [onclick], [class*='search' i], [data-testid*='search' i]"))
        .filter((button) => {
          if (button.closest("nav, aside, header")) return false;
          const metadata = [
            button.getAttribute("aria-label"),
            button.getAttribute("title"),
            button.getAttribute("data-testid"),
            button.getAttribute("class"),
            button.innerText,
            button.textContent,
          ].filter(Boolean).join(" ").trim();
          return !negativePattern.test(metadata) && /search|\u641c\u7d22/i.test(metadata);
        })[0];
    }
    let submittedBy = "enter";
    if (searchButton) {
      searchButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      searchButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      searchButton.click();
      submittedBy = "button";
    } else if (input.form?.requestSubmit) {
      input.form.requestSubmit();
      submittedBy = "form";
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }

    return { searched: true, enterpriseName, scope, searchQuery, submittedBy };
  }

  function mailCandidateKey(element, text) {
    const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute("href") || "";
    const source = `${href}|${text.slice(0, 360)}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${(hash >>> 0).toString(36)}-${text.replace(/\s+/g, "").slice(0, 36)}`;
  }

  function matchingMailCandidates(enterpriseName) {
    const expected = String(enterpriseName || "").trim().toLocaleLowerCase("zh-CN");
    if (!expected) return [];
    const rowSelector = "tr, li, article, [role='row'], [role='option'], [role='listitem'], [data-thread-id], [data-message-id], [data-convid], div, [role='listbox'] [tabindex='0'], [role='grid'] [tabindex='0']";
    const detailSelector = "[data-thread-id], [data-message-id], [data-convid], a[href*='message' i], a[href*='thread' i], a[href*='read' i], a[href*='mail' i]";
    const rows = Array.from(document.querySelectorAll(rowSelector));
    const directDetails = Array.from(document.querySelectorAll(detailSelector));
    return [...new Set([...rows, ...directDetails])]
      .filter((element) => {
        if (
          element.getAttribute("aria-hidden") === "true" ||
          element.closest("form, [role='search'], nav, aside, header") ||
          element.matches("input, button")
        ) return false;
        const text = String(element.innerText || element.textContent || "").trim();
        if (
          element.tagName === "DIV" &&
          Array.from(element.querySelectorAll("div")).some((child) => {
            const childText = String(child.innerText || child.textContent || "").trim();
            return childText.length < text.length && childText.toLocaleLowerCase("zh-CN").includes(expected);
          })
        ) return false;
        return text.length >= expected.length + 2 && text.length <= 1600 && text.toLocaleLowerCase("zh-CN").includes(expected);
      })
      .map((element) => {
        const text = String(element.innerText || element.textContent || "").trim();
        const explicitDetail = element.matches(detailSelector)
          ? element
          : element.querySelector?.(detailSelector);
        const target = explicitDetail || element;
        return { element: target, text, key: mailCandidateKey(target, text) };
      })
      .filter((item, index, array) => array.findIndex((candidate) => candidate.key === item.key) === index)
      .slice(0, 80);
  }

  function openMatchingMail(enterpriseName, excludeKeys = []) {
    const excluded = new Set(Array.isArray(excludeKeys) ? excludeKeys : []);
    const candidate = matchingMailCandidates(enterpriseName).find((item) => !excluded.has(item.key));
    if (!candidate) return { opened: false, reason: "no-more-matches" };
    lastOpenedMail = { key: candidate.key, preview: candidate.text, beforeUrl: location.href };
    candidate.element.scrollIntoView?.({ block: "center" });
    candidate.element.click();
    return {
      opened: true,
      key: candidate.key,
      preview: candidate.text.slice(0, 500),
      beforeUrl: lastOpenedMail.beforeUrl,
    };
  }

  function scanMailboxDetail(enterpriseName, mailboxSource) {
    const expected = String(enterpriseName || "").trim().toLocaleLowerCase("zh-CN");
    const text = String(document.body?.innerText || "").trim();
    const lower = text.toLocaleLowerCase("zh-CN");
    const hasSender = /(发件人|寄件人|from\s*:|from\s+)/i.test(text);
    const hasRecipient = /(收件人|收件者|to\s*:|to\s+)/i.test(text);
    const hasReplyActions = /(回复|转发|reply|forward|查看往来邮件)/i.test(text);
    const navigated = Boolean(lastOpenedMail?.beforeUrl && location.href !== lastOpenedMail.beforeUrl);
    const detailUrl = /(message|thread|read|detail|view|mail)/i.test(location.href);
    const hasDetailEvidence = (hasSender && hasRecipient) || (hasReplyActions && (navigated || detailUrl));
    if (!expected || !lower.includes(expected) || !hasDetailEvidence) {
      return { isDetail: false, updates: [] };
    }
    const result = scanPage({
      automatic: false,
      forceMailbox: true,
      enterpriseName,
      mailboxSource: mailboxSource || null,
    });
    const mailDetailUrl = location.href;
    return {
      ...result,
      isDetail: true,
      openedMailKey: lastOpenedMail?.key || "",
      mailDetailUrl,
      updates: (result.updates || []).map((update) => ({ ...update, mailDetailUrl })),
    };
  }

  function returnToMailSearch() {
    if (lastOpenedMail?.beforeUrl && location.href === lastOpenedMail.beforeUrl) {
      lastOpenedMail = null;
      return { returned: true, method: "unchanged" };
    }
    const patterns = /^(返回|返回列表|返回搜索结果|返回邮件列表|Back|Back to results|Back to inbox)$/i;
    const controls = Array.from(document.querySelectorAll(
      "button, a, [role='button'], [role='link'], [title], [aria-label]",
    ));
    const backControl = controls.find((element) => {
      const label = String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || "").trim();
      return patterns.test(label);
    });
    if (backControl) {
      backControl.click();
      lastOpenedMail = null;
      return { returned: true, method: "button" };
    }
    if (history.length > 1) {
      history.back();
      lastOpenedMail = null;
      return { returned: true, method: "history" };
    }
    return { returned: false, reason: "back-control-not-found" };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_MAILBOX_FOLDER") {
      sendResponse(openMailboxFolder(message.scope));
      return;
    }
    if (message?.type === "SEARCH_MAILBOX") {
      sendResponse(searchMailbox(message.enterpriseName, message.scope));
      return;
    }
    if (message?.type === "SCAN_MAILBOX_RESULTS") {
      sendResponse(scanPage({
        automatic: false,
        forceMailbox: true,
        enterpriseName: message.enterpriseName,
        mailboxSource: message.source || null,
      }));
      return;
    }
    if (message?.type === "OPEN_MATCHING_MAIL") {
      sendResponse(openMatchingMail(message.enterpriseName, message.excludeKeys));
      return;
    }
    if (message?.type === "SCAN_MAILBOX_DETAIL") {
      sendResponse(scanMailboxDetail(message.enterpriseName, message.source || null));
      return;
    }
    if (message?.type === "RETURN_TO_MAIL_SEARCH") {
      sendResponse(returnToMailSearch());
      return;
    }
    if (message?.type === "SCAN_PAGE" || message?.type === "CAPTURE_PAGE") {
      sendResponse(scanPage({ automatic: message.type !== "CAPTURE_PAGE", expectedJobTitles: message.expectedJobTitles }));
    }
  });

  // 页面加载和内容变化时保持静默。只有用户点击扩展，或工作台明确发起检查时才扫描。
})();
