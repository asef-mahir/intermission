importScripts("storage.js");

const INTERCEPTOR_SCRIPT_ID = "focus-friend-interceptor";
const INTERCEPTOR_FILES = ["storage.js", "interceptor.js"];
const INTERCEPTOR_CSS = "interceptor.css";
let refreshQueue = Promise.resolve();

function matchPatterns(domain) {
  return [`http://*.${domain}/*`, `https://*.${domain}/*`];
}

async function syncInterceptor() {
  const settings = await FocusStorage.getSettings();

  const matches = [];
  const enabledSites = Array.isArray(settings.enabled_sites) ? settings.enabled_sites : [];
  if (settings.enabled) {
    for (const domain of enabledSites) {
      const patterns = matchPatterns(domain);
      const hasPermission = await chrome.permissions.contains({ origins: patterns });
      if (hasPermission) matches.push(...patterns);
    }
  }

  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [INTERCEPTOR_SCRIPT_ID]
  });
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [INTERCEPTOR_SCRIPT_ID] });
  }

  if (matches.length) {
    await chrome.scripting.registerContentScripts([{
      id: INTERCEPTOR_SCRIPT_ID,
      matches,
      css: ["interceptor.css"],
      js: INTERCEPTOR_FILES,
      runAt: "document_start",
      persistAcrossSessions: true
    }]);
  }
}

function matchesDomain(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function domainsFromOrigins(origins) {
  if (!Array.isArray(origins)) return [];
  const domains = [];
  for (const origin of origins) {
    const match = /^[a-z]+:\/\/(?:\*\.)?([^/]+)\//i.exec(origin);
    if (match?.[1] && match[1] !== "*") domains.push(match[1].toLowerCase());
  }
  return [...new Set(domains)];
}

// Registration only affects future page loads. When the user turns the extension
// back on (or grants access to a new site), put the pause into tabs that are
// already open. interceptor.js guards against stacking two overlays.
async function injectIntoOpenTabs(domains) {
  let allowedDomains = domains;
  if (!allowedDomains) {
    const settings = await FocusStorage.getSettings();
    if (!settings.enabled) return;
    allowedDomains = settings.enabled_sites;
  }
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    console.warn("Focus Friend could not list open tabs:", error);
    return;
  }

  for (const tab of tabs) {
    if (typeof tab.id !== "number" || typeof tab.url !== "string") continue;

    let hostname;
    try {
      hostname = new URL(tab.url).hostname.toLowerCase();
    } catch {
      continue;
    }

    if (!matchesDomain(hostname, allowedDomains)) continue;

    let cssInserted = false;
    try {
      // Remove first so repeated enable/add-site events cannot stack copies.
      await chrome.scripting.removeCSS({
        target: { tabId: tab.id },
        files: [INTERCEPTOR_CSS]
      }).catch(() => {});
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: [INTERCEPTOR_CSS]
      });
      cssInserted = true;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: INTERCEPTOR_FILES
      });
    } catch {
      // Tabs without host access, chrome:// pages, and the Web Store reject injection.
      // If the CSS landed but the script did not, remove it so the page is not left hidden.
      if (cssInserted) {
        await chrome.scripting.removeCSS({
          target: { tabId: tab.id },
          files: [INTERCEPTOR_CSS]
        }).catch(() => {});
      }
    }
  }
}

async function removeCssFromOpenTabs(domains) {
  if (!Array.isArray(domains) || domains.length === 0) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  for (const tab of tabs) {
    if (typeof tab.id !== "number" || typeof tab.url !== "string") continue;
    let hostname;
    try {
      hostname = new URL(tab.url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!matchesDomain(hostname, domains)) continue;

    await chrome.scripting.removeCSS({
      target: { tabId: tab.id },
      files: [INTERCEPTOR_CSS]
    }).catch(() => {});
  }
}

async function revealOpenTabs(domains) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  for (const tab of tabs) {
    if (typeof tab.id !== "number" || typeof tab.url !== "string") continue;
    let hostname;
    try {
      hostname = new URL(tab.url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (Array.isArray(domains) && domains.length > 0 && !matchesDomain(hostname, domains)) continue;

    await chrome.tabs.sendMessage(tab.id, { type: "focusFriendReveal" }).catch(() => {});
  }
}

// Serialize refreshes so quick setting changes do not race each other.
function scheduleInterceptorSync({
  inject = false,
  domains = null,
  cleanupDomains = null,
  reveal = false
} = {}) {
  refreshQueue = refreshQueue
    .then(syncInterceptor)
    .then(() => (inject ? injectIntoOpenTabs(domains) : undefined))
    .then(() => (cleanupDomains ? removeCssFromOpenTabs(cleanupDomains) : undefined))
    .then(() => (reveal ? revealOpenTabs(cleanupDomains) : undefined))
    .catch((error) => console.error("Could not update Focus Friend site access:", error));
  return refreshQueue;
}

// Show the welcome/settings page once, when Focus Friend is first installed.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
  void scheduleInterceptorSync();
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleInterceptorSync();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "sync" && changes.continue_checkin_enabled?.newValue === false) {
    void chrome.storage.local.remove("not_now_daily_counts");
  }

  if (areaName === "sync" && ["enabled", "enabled_sites"].some((key) => key in changes)) {
    const justEnabled = changes.enabled?.oldValue === false && changes.enabled?.newValue === true;
    const justDisabled = changes.enabled?.oldValue === true && changes.enabled?.newValue === false;
    const previousSites = Array.isArray(changes.enabled_sites?.oldValue)
      ? changes.enabled_sites.oldValue
      : [];
    const nextSites = Array.isArray(changes.enabled_sites?.newValue)
      ? changes.enabled_sites.newValue
      : [];
    const addedSites = nextSites.filter((site) => !previousSites.includes(site));
    const removedSites = previousSites.filter((site) => !nextSites.includes(site));

    let cleanupDomains = justDisabled ? previousSites : removedSites;
    if (justDisabled && cleanupDomains.length === 0) {
      try {
        const settings = await FocusStorage.getSettings();
        cleanupDomains = settings.enabled_sites;
      } catch (error) {
        console.warn("Focus Friend could not read sites for cleanup:", error);
      }
    }

    // Removals only need a re-register for future loads; additions also deserve
    // a pause in the tabs that are already open. A disable or removal also needs
    // the injected CSS taken back out so no page is left hidden.
    void scheduleInterceptorSync({
      inject: justEnabled || addedSites.length > 0,
      domains: justEnabled ? null : addedSites,
      cleanupDomains,
      reveal: justDisabled || removedSites.length > 0
    });
  }
});

chrome.permissions.onAdded.addListener(() => {
  void scheduleInterceptorSync({ inject: true });
});

chrome.permissions.onRemoved.addListener((permissions) => {
  const domains = domainsFromOrigins(permissions.origins);
  void scheduleInterceptorSync({
    cleanupDomains: domains,
    reveal: true
  });
});

// Content scripts ask the service worker for packaged language text.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (message?.type === "returnToNewTab") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ error: "The current tab was unavailable." });
      return;
    }

    chrome.tabs.update(tabId, { url: "chrome://newtab/" })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Could not return to a new tab:", error);
        sendResponse({ error: "Chrome could not open a new tab." });
      });
    return true;
  }

  if (message?.type !== "getCopy") return;

  // Always answer, even for a damaged stored value, so the page is never left waiting.
  const language = message.language === "bn" ? "bn" : "en";

  fetch(chrome.runtime.getURL(`content/${language}.json`))
    .then((response) => response.json())
    .then(sendResponse)
    .catch((error) => {
      console.error("Could not load Focus Friend language copy:", error);
      sendResponse({ error: "Could not load language copy." });
    });
  return true;
});

void scheduleInterceptorSync();
