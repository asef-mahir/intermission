const copyByLanguage = {
  bn: "bn",
  en: "en"
};

const CONSENT_VERSION = 1;
const CONSENT_KEY = "onboarding_consent_version";
const PRIVACY_URL = "https://asef-mahir.github.io/intermission/privacy.html";

let settings;
let copy;
let firstRunVisible = false;
let permissionStatusByDomain = new Map();
let grantAccessBusy = false;
let addSiteBusy = false;
let formMessageState = null;
const pendingSiteOperations = new Map();

function setPermissionMessage(message, text, state) {
  message.textContent = text;
  message.dataset.state = state;
}

function renderFormMessage() {
  const message = document.querySelector("#form-message");
  if (!message) return;
  if (!formMessageState || !copy?.settings) {
    message.textContent = "";
    message.dataset.state = "";
    return;
  }
  const template = copy.settings[formMessageState.key] || "";
  message.textContent = formMessageState.site
    ? template.replace("{site}", formMessageState.site)
    : template;
  message.dataset.state = formMessageState.state;
}

function setFormMessage(key, site, state) {
  formMessageState = { key, site, state };
  renderFormMessage();
}

function sameSettingValue(first, second) {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
  }
  return first === second;
}

function originsFor(domain) {
  return [`http://*.${domain}/*`, `https://*.${domain}/*`];
}

function originsForAll(domains) {
  return domains.flatMap(originsFor);
}

async function revokeSiteAccess(domain) {
  try {
    await chrome.permissions.remove({ origins: originsFor(domain) });
    // Chrome can resolve without removing (for example when a broader grant
    // still covers the site), so verify before telling the user it is gone.
    return !(await chrome.permissions.contains({ origins: originsFor(domain) }));
  } catch (error) {
    console.error("Focus Friend could not revoke site access:", error);
    return false;
  }
}

function syncSiteRow(domain) {
  const row = [...document.querySelectorAll("#site-list .site-row")]
    .find((candidate) => candidate.dataset.domain === domain);
  if (!row) return;
  const toggle = row.querySelector(".site-name input");
  if (toggle) toggle.checked = settings.enabled_sites.includes(domain);
}

async function loadCopy(language) {
  const response = await fetch(chrome.runtime.getURL(`content/${copyByLanguage[language]}.json`));
  return response.json();
}

async function render() {
  copy = await loadCopy(settings.language);
  const text = copy.settings;
  document.documentElement.lang = settings.language;
  document.title = text.pageTitle;

  document.querySelector("#first-run-eyebrow").textContent = text.firstRunEyebrow;
  document.querySelector("#first-run-title").textContent = text.firstRunTitle;
  document.querySelector("#first-run-summary").textContent = text.firstRunSummary;
  document.querySelector("#first-run-storage").textContent = text.firstRunStorage;
  document.querySelector("#first-run-browsing").textContent = text.firstRunBrowsing;
  document.querySelector("#first-run-sharing").textContent = text.firstRunSharing;
  document.querySelector("#first-run-language-label").textContent = text.firstRunLanguage;
  document.querySelector("#first-run-policy-link").textContent = text.firstRunPolicy;
  document.querySelector("#first-run-policy-link").href = PRIVACY_URL;
  document.querySelector("#first-run-accept").textContent = text.firstRunAccept;
  document.querySelector("#first-run").hidden = !firstRunVisible;
  document.querySelector("#settings-content").hidden = firstRunVisible;

  document.querySelector("#onboarding").textContent = copy.onboarding;
  document.querySelector("#intro-copy").textContent = text.intro;
  document.querySelector("#sites-heading").textContent = text.sitesHeading;
  document.querySelector("#sites-description").textContent = text.sitesDescription;
  document.querySelector("#site-input-label").textContent = text.siteInputLabel;
  document.querySelector("#site-input").placeholder = text.sitePlaceholder;
  document.querySelector("#add-button").textContent = text.addButton;
  document.querySelector("#youtube-warning").textContent = text.youtubeWarning;
  document.querySelector("#grant-access-button").textContent = text.grantAccessButton;
  document.querySelector("#cooldown-label").textContent = text.cooldownLabel;
  document.querySelector("#cooldown-description").textContent = text.cooldownDescription;
  document.querySelector("#minutes-label").textContent = text.minutes;
  document.querySelector("#footer-note").textContent = text.footerNote;
  document.querySelector("#privacy-link").textContent = text.privacyLink;
  document.querySelector("#privacy-link").href = PRIVACY_URL;
  document.querySelector("#debounce-input").value = settings.debounce_minutes;
  document.querySelector("#checkin-label").textContent = text.checkinLabel;
  document.querySelector("#checkin-description").textContent = text.checkinDescription;
  document.querySelector("#checkin-enabled").checked = settings.continue_checkin_enabled;

  document.querySelector("#time-checkin-label").textContent = text.timeCheckinLabel;
  document.querySelector("#time-checkin-description").textContent = text.timeCheckinDescription;
  document.querySelector("#time-checkin-minutes-label").textContent = text.minutes;
  document.querySelector("#time-checkin-enabled").checked = Boolean(settings.time_checkin_enabled);
  document.querySelector("#time-checkin-minutes").value = settings.time_checkin_minutes || 20;
  const timeControl = document.querySelector("#time-checkin-control");
  if (timeControl) {
    timeControl.style.opacity = settings.time_checkin_enabled ? "1" : "0.5";
    timeControl.style.pointerEvents = settings.time_checkin_enabled ? "auto" : "none";
  }

  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === settings.language));
  });

  renderSites(text);
  renderFormMessage();
  void updatePermissionStatus();
}

async function updatePermissionStatus() {
  const message = document.querySelector("#permission-message");
  if (!settings || !copy) return null;
  try {
    const enabledSites = [...(settings?.enabled_sites || [])];
    const permissionStates = await Promise.all(enabledSites.map(async (domain) => ({
      domain,
      granted: await chrome.permissions.contains({ origins: originsFor(domain) })
    })));
    const permissionByDomain = new Map(permissionStates.map((site) => [site.domain, site.granted]));
    permissionStatusByDomain = permissionByDomain;
    const missing = permissionStates.some((site) => !site.granted);

    document.querySelectorAll("#site-list .site-row").forEach((row) => {
      const domain = row.dataset.domain;
      const isSelected = enabledSites.includes(domain);
      const needsAccess = isSelected && !permissionByDomain.get(domain);
      const status = row.querySelector(".site-access-status");
      const toggle = row.querySelector(".site-name input");
      status.hidden = !needsAccess;
      row.classList.toggle("has-access-status", needsAccess);
      if (needsAccess) toggle.setAttribute("aria-describedby", status.id);
      else toggle.removeAttribute("aria-describedby");
    });

    if (message) {
      setPermissionMessage(
        message,
        missing ? copy.settings.permissionNeeded : "",
        missing ? "error" : ""
      );
    }
    return missing;
  } catch (_) {
    return null;
  }
}

function renderSites(text) {
  const list = document.querySelector("#site-list");
  list.replaceChildren();

  for (const domain of settings.sites) {
    const row = document.createElement("li");
    row.className = "site-row";
    row.dataset.domain = domain;

    const siteDetails = document.createElement("div");
    siteDetails.className = "site-details";

    const label = document.createElement("label");
    label.className = "site-name";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = settings.enabled_sites.includes(domain);
    toggle.setAttribute("aria-label", `${text.toggleSite} ${domain}`);
    toggle.addEventListener("change", async () => {
      if (pendingSiteOperations.has(domain)) {
        // A click during an in-flight change should not start a second
        // operation. Put the box back to the state that operation is applying.
        toggle.checked = pendingSiteOperations.get(domain);
        return;
      }

      const targetEnabled = toggle.checked;
      pendingSiteOperations.set(domain, targetEnabled);
      const row = toggle.closest(".site-row");
      row?.setAttribute("aria-busy", "true");

      try {
        if (targetEnabled) {
          // Ask for this site's access while the click is still a user gesture.
          let granted = false;
          let requestFailed = false;
          try {
            granted = await chrome.permissions.request({ origins: originsFor(domain) });
          } catch (error) {
            requestFailed = true;
            console.error("Focus Friend permission request failed:", error);
          }

          if (!granted) {
            toggle.checked = false;
            syncSiteRow(domain);
            setFormMessage(
              requestFailed ? "permissionRequestError" : "permissionToggleDenied",
              null,
              "error"
            );
            return;
          }

          settings.enabled_sites = [...new Set([...settings.enabled_sites, domain])];
          syncSiteRow(domain);
          await FocusStorage.saveSettings(settings);
          await updatePermissionStatus();
          setFormMessage("siteAccessGranted", domain, "success");
          return;
        }

        // Save the off state first so the pause stops immediately, then verify
        // that Chrome really released the host access.
        settings.enabled_sites = settings.enabled_sites.filter((site) => site !== domain);
        syncSiteRow(domain);
        await FocusStorage.saveSettings(settings);
        const removed = await revokeSiteAccess(domain);
        await updatePermissionStatus();
        setFormMessage(
          removed ? "siteAccessRemoved" : "siteAccessRemovePartial",
          domain,
          removed ? "success" : "error"
        );
      } finally {
        pendingSiteOperations.delete(domain);
        row?.removeAttribute("aria-busy");
      }
    });

    const domainName = document.createElement("span");
    domainName.className = "site-domain";
    domainName.textContent = domain;

    const accessStatus = document.createElement("span");
    accessStatus.className = "site-access-status";
    accessStatus.id = `site-access-status-${settings.sites.indexOf(domain)}`;
    accessStatus.hidden = true;

    accessStatus.textContent = text.sitePermissionMissing;

    label.append(toggle, domainName);
    siteDetails.append(label);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = text.removeButton;
    remove.addEventListener("click", async () => {
      if (pendingSiteOperations.has(domain)) return;
      pendingSiteOperations.set(domain, settings.enabled_sites.includes(domain));
      const row = remove.closest(".site-row");
      row?.setAttribute("aria-busy", "true");

      try {
        // Only delete the row after Chrome confirms the access is gone.
        const removed = await revokeSiteAccess(domain);
        if (!removed) {
          setFormMessage("siteRemoveFailed", domain, "error");
          return;
        }

        settings.sites = settings.sites.filter((site) => site !== domain);
        settings.enabled_sites = settings.enabled_sites.filter((site) => site !== domain);
        await FocusStorage.saveSettings(settings);
        formMessageState = null;
        await render();
      } finally {
        pendingSiteOperations.delete(domain);
        row?.removeAttribute("aria-busy");
      }
    });

    row.append(siteDetails, accessStatus, remove);
    list.append(row);
  }
}

document.querySelector("#add-site-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (addSiteBusy) return;
  const input = document.querySelector("#site-input");
  const domain = FocusStorage.normalizeDomain(input.value);

  if (!domain) {
    setFormMessage("invalidDomain", null, "error");
    return;
  }
  if (settings.sites.includes(domain)) {
    setFormMessage("duplicateDomain", null, "error");
    return;
  }

  addSiteBusy = true;
  const button = document.querySelector("#add-button");
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-disabled", "true");

  try {
    // Request access directly from the Add action so Chrome recognizes the
    // request as a user gesture. Only mark the new site on if access is granted.
    let accessGranted = false;
    let accessRequestFailed = false;
    try {
      accessGranted = await chrome.permissions.request({ origins: originsFor(domain) });
    } catch (error) {
      accessRequestFailed = true;
      console.error("Focus Friend permission request failed:", error);
    }

    // Another tab may have added the domain while Chrome's prompt was open.
    if (settings.sites.includes(domain)) {
      setFormMessage("duplicateDomain", null, "error");
      return;
    }

    settings.sites = [...settings.sites, domain];
    settings.enabled_sites = accessGranted
      ? [...new Set([...settings.enabled_sites, domain])]
      : settings.enabled_sites.filter((site) => site !== domain);
    await FocusStorage.saveSettings(settings);
    input.value = "";
    await render();
    setFormMessage(
      accessGranted
        ? "siteAddedAccessGranted"
        : accessRequestFailed
          ? "siteAddedAccessError"
          : "siteAddedAccessDenied",
      domain,
      accessGranted ? "success" : "error"
    );
  } finally {
    addSiteBusy = false;
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-disabled");
  }
});

document.querySelector("#grant-access-button").addEventListener("click", async () => {
  if (grantAccessBusy) return;
  const message = document.querySelector("#permission-message");
  const button = document.querySelector("#grant-access-button");
  const selectedSites = [...settings.enabled_sites];

  if (!selectedSites.length) {
    setPermissionMessage(message, copy.settings.noEnabledSites, "error");
    return;
  }

  const sitesNeedingAccess = selectedSites.filter((domain) => permissionStatusByDomain.get(domain) !== true);
  if (!sitesNeedingAccess.length) {
    setPermissionMessage(message, copy.settings.permissionAlreadyGranted, "success");
    return;
  }

  grantAccessBusy = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-disabled", "true");
  try {
    // Keep the permission request directly in the click handler so Chrome
    // recognizes the user gesture. Only request sites currently missing access.
    const origins = originsForAll(sitesNeedingAccess);
    const granted = await chrome.permissions.request({ origins });
    await updatePermissionStatus();
    setPermissionMessage(
      message,
      granted ? copy.settings.permissionGranted : copy.settings.permissionDenied,
      granted ? "success" : "error"
    );
  } catch (error) {
    console.error("Focus Friend permission request failed:", error);
    setPermissionMessage(message, copy.settings.permissionRequestError, "error");
  } finally {
    grantAccessBusy = false;
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-disabled");
  }
});

document.querySelector("#first-run-accept").addEventListener("click", async () => {
  try {
    await chrome.storage.local.set({
      [CONSENT_KEY]: CONSENT_VERSION,
      onboarding_consent_at: new Date().toISOString()
    });
  } catch (error) {
    // A storage failure should not trap the user on the disclosure screen.
    console.error("Focus Friend could not save onboarding consent:", error);
  }

  firstRunVisible = false;
  await render();
  document.querySelector("#site-input").focus();
});

document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", async () => {
    settings.language = button.dataset.language;
    await FocusStorage.saveSettings(settings);
    await render();
  });
});

document.querySelector("#debounce-input").addEventListener("change", async (event) => {
  const value = Number.parseInt(event.target.value, 10);
  settings.debounce_minutes = Math.min(240, Math.max(1, Number.isFinite(value) ? value : 20));
  await FocusStorage.saveSettings(settings);
  event.target.value = settings.debounce_minutes;
});

document.querySelector("#checkin-enabled").addEventListener("change", async (event) => {
  settings.continue_checkin_enabled = event.target.checked;
  await FocusStorage.saveSettings(settings);
  if (!settings.continue_checkin_enabled) {
    await chrome.storage.local.remove("not_now_daily_counts");
  }
});

document.querySelector("#time-checkin-enabled").addEventListener("change", async (event) => {
  settings.time_checkin_enabled = event.target.checked;
  const timeControl = document.querySelector("#time-checkin-control");
  if (timeControl) {
    timeControl.style.opacity = settings.time_checkin_enabled ? "1" : "0.5";
    timeControl.style.pointerEvents = settings.time_checkin_enabled ? "auto" : "none";
  }
  await FocusStorage.saveSettings(settings);
  if (!settings.time_checkin_enabled) {
    await chrome.storage.local.remove("daily_active_time");
  }
});

document.querySelector("#time-checkin-minutes").addEventListener("change", async (event) => {
  const value = Number.parseInt(event.target.value, 10);
  settings.time_checkin_minutes = Math.min(180, Math.max(1, Number.isFinite(value) ? value : 20));
  await FocusStorage.saveSettings(settings);
  event.target.value = settings.time_checkin_minutes;
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync" || !settings) return;
  const keys = ["sites", "enabled_sites", "language", "enabled", "debounce_minutes", "continue_checkin_enabled", "time_checkin_enabled", "time_checkin_minutes"];
  const changedKeys = keys.filter((key) => key in changes);
  if (!changedKeys.length) return;

  // Saves made on this page echo back here. Rebuilding the list for those
  // would steal keyboard focus from the checkbox the user just changed.
  const isLocalEcho = changedKeys.every((key) =>
    sameSettingValue(changes[key].newValue, settings[key])
  );

  settings = await FocusStorage.getSettings();
  if (isLocalEcho) {
    await updatePermissionStatus();
    return;
  }
  await render();
});

chrome.permissions.onAdded.addListener(() => void updatePermissionStatus());
chrome.permissions.onRemoved.addListener(() => void updatePermissionStatus());

(async function start() {
  let stored = {};
  try {
    stored = await chrome.storage.local.get(CONSENT_KEY);
  } catch (error) {
    console.warn("Focus Friend could not read onboarding consent:", error);
  }
  firstRunVisible = !(Number(stored?.[CONSENT_KEY]) >= CONSENT_VERSION);

  settings = await FocusStorage.getSettings();
  await render();
})();
