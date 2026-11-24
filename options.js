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

function setPermissionMessage(message, text, state) {
  message.textContent = text;
  message.dataset.state = state;
}

function originsFor(domain) {
  return [`http://*.${domain}/*`, `https://*.${domain}/*`];
}

function originsForAll(domains) {
  return domains.flatMap(originsFor);
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
  void updatePermissionStatus();
}

async function updatePermissionStatus() {
  const message = document.querySelector("#permission-message");
  if (!message) return;
  if (!settings?.enabled_sites?.length) {
    setPermissionMessage(message, "", "");
    return;
  }

  const origins = originsForAll(settings.enabled_sites);
  try {
    const hasAll = await chrome.permissions.contains({ origins });
    setPermissionMessage(
      message,
      hasAll ? copy.settings.permissionGranted : copy.settings.permissionNeeded,
      hasAll ? "success" : "error"
    );
  } catch (_) {}
}

function renderSites(text) {
  const list = document.querySelector("#site-list");
  list.replaceChildren();

  for (const domain of settings.sites) {
    const row = document.createElement("li");
    row.className = "site-row";

    const label = document.createElement("label");
    label.className = "site-name";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = settings.enabled_sites.includes(domain);
    toggle.setAttribute("aria-label", `${text.toggleSite} ${domain}`);
    toggle.addEventListener("change", async () => {
      const message = document.querySelector("#permission-message");

      if (toggle.checked) {
        // Ask for this site's access while the click is still a user gesture.
        let granted = false;
        try {
          granted = await chrome.permissions.request({ origins: originsFor(domain) });
        } catch (error) {
          console.error("Focus Friend permission request failed:", error);
        }

        if (!granted) {
          toggle.checked = false;
          setPermissionMessage(message, text.permissionToggleDenied, "error");
          return;
        }

        settings.enabled_sites = [...new Set([...settings.enabled_sites, domain])];
        await FocusStorage.saveSettings(settings);
        setPermissionMessage(message, text.permissionGranted, "success");
        return;
      }

      // Turning a site off also gives back its host access.
      settings.enabled_sites = settings.enabled_sites.filter((site) => site !== domain);
      await FocusStorage.saveSettings(settings);
      try {
        await chrome.permissions.remove({ origins: originsFor(domain) });
      } catch (error) {
        console.error("Focus Friend could not revoke site access:", error);
      }
      setPermissionMessage(message, text.permissionRevoked, "success");
    });

    const name = document.createElement("span");
    name.textContent = domain;
    label.append(toggle, name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = text.removeButton;
    remove.addEventListener("click", async () => {
      settings.sites = settings.sites.filter((site) => site !== domain);
      settings.enabled_sites = settings.enabled_sites.filter((site) => site !== domain);
      await FocusStorage.saveSettings(settings);
      try {
        await chrome.permissions.remove({ origins: originsFor(domain) });
      } catch (error) {
        console.error("Focus Friend could not revoke site access:", error);
      }
      await render();
    });

    row.append(label, remove);
    list.append(row);
  }
}

document.querySelector("#add-site-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#site-input");
  const message = document.querySelector("#form-message");
  const domain = FocusStorage.normalizeDomain(input.value);

  if (!domain) {
    message.textContent = copy.settings.invalidDomain;
    return;
  }
  if (settings.sites.includes(domain)) {
    message.textContent = copy.settings.duplicateDomain;
    return;
  }

  settings.sites = [...settings.sites, domain];
  settings.enabled_sites = [...settings.enabled_sites, domain];
  await FocusStorage.saveSettings(settings);
  input.value = "";
  message.textContent = copy.settings.siteAddedAccessNeeded;
  await render();
});

document.querySelector("#grant-access-button").addEventListener("click", async () => {
  const message = document.querySelector("#permission-message");
  const origins = originsForAll(settings.enabled_sites);

  if (!origins.length) {
    setPermissionMessage(message, copy.settings.noEnabledSites, "error");
    return;
  }

  try {
    const granted = await chrome.permissions.request({ origins });
    setPermissionMessage(
      message,
      granted ? copy.settings.permissionGranted : copy.settings.permissionDenied,
      granted ? "success" : "error"
    );
  } catch (error) {
    console.error("Focus Friend permission request failed:", error);
    setPermissionMessage(message, copy.settings.permissionRequestError, "error");
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
  if (["sites", "enabled_sites", "language", "enabled", "debounce_minutes", "continue_checkin_enabled", "time_checkin_enabled", "time_checkin_minutes"].some((key) => key in changes)) {
    settings = await FocusStorage.getSettings();
    await render();
  }
});

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
