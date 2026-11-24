// These are the settings Focus Friend uses when someone installs it for the first time.
// Wrapped in a function so the file can safely run more than once in the same page
// (the service worker re-injects it when the extension is switched back on).
(() => {
  // New installs follow the browser's UI language. Bangla is used when the
  // browser reports a Bangla locale; everything else falls back to English.
  // Existing saved settings are never overwritten by this detection.
  function detectDefaultLanguage() {
    try {
      const language = String(globalThis.navigator?.language || "").toLowerCase();
      return language.startsWith("bn") ? "bn" : "en";
    } catch {
      return "en";
    }
  }

  const DEFAULT_SETTINGS = {
    sites: [
      "instagram.com",
      "facebook.com",
      "tiktok.com",
      "x.com",
      "reddit.com",
      "discord.com"
    ],
    enabled_sites: [
      "instagram.com",
      "facebook.com",
      "tiktok.com",
      "x.com",
      "reddit.com",
      "discord.com"
    ],
    language: detectDefaultLanguage(),
    enabled: true,
    debounce_minutes: 20,
    continue_checkin_enabled: true,
    time_checkin_enabled: false,
    time_checkin_minutes: 20
  };

  const VALID_LANGUAGES = ["bn", "en"];

  function sameList(first, second) {
    return Array.isArray(first)
      && Array.isArray(second)
      && first.length === second.length
      && first.every((value, index) => value === second[index]);
  }

  // Returns null when the value is not a list at all, so callers can tell
  // "missing" apart from "present but empty".
  function cleanDomainList(value) {
    if (!Array.isArray(value)) return null;
    const cleaned = [];
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const domain = entry.trim().toLowerCase();
      if (domain && !cleaned.includes(domain)) cleaned.push(domain);
    }
    return cleaned;
  }

  function clampInteger(value, min, max, fallback) {
    const number = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  // Combine saved values with the defaults and report only the keys that had to change.
  // Every reader (popup, options, content script, service worker) goes through this,
  // so a repaired value is saved once instead of living only in memory.
  function normalizeSettings(saved) {
    const source = saved && typeof saved === "object" ? saved : {};
    const settings = { ...DEFAULT_SETTINGS, ...source };
    const repairs = {};

    const sites = cleanDomainList(source.sites) ?? [...DEFAULT_SETTINGS.sites];
    if (!sameList(source.sites, sites)) repairs.sites = sites;
    settings.sites = sites;

    // Older builds only stored "sites". When "enabled_sites" is missing, the
    // visible list is the safest thing to pause, and the result is persisted.
    const enabledSites = Array.isArray(source.enabled_sites)
      ? (cleanDomainList(source.enabled_sites) ?? [])
      : [...sites];
    if (!sameList(source.enabled_sites, enabledSites)) repairs.enabled_sites = enabledSites;
    settings.enabled_sites = enabledSites;

    if (!VALID_LANGUAGES.includes(settings.language)) {
      settings.language = DEFAULT_SETTINGS.language;
    }
    if (settings.language !== source.language) repairs.language = settings.language;

    for (const key of ["enabled", "continue_checkin_enabled", "time_checkin_enabled"]) {
      if (typeof settings[key] !== "boolean") {
        settings[key] = DEFAULT_SETTINGS[key];
      }
      if (settings[key] !== source[key]) repairs[key] = settings[key];
    }

    settings.debounce_minutes = clampInteger(
      settings.debounce_minutes,
      1,
      240,
      DEFAULT_SETTINGS.debounce_minutes
    );
    if (settings.debounce_minutes !== source.debounce_minutes) {
      repairs.debounce_minutes = settings.debounce_minutes;
    }

    settings.time_checkin_minutes = clampInteger(
      settings.time_checkin_minutes,
      1,
      180,
      DEFAULT_SETTINGS.time_checkin_minutes
    );
    if (settings.time_checkin_minutes !== source.time_checkin_minutes) {
      repairs.time_checkin_minutes = settings.time_checkin_minutes;
    }

    return { settings, repairs };
  }

  // Read saved choices. If this is the first run (or a value is unusable),
  // save the repaired values so every reader sees the same thing.
  async function getSettings() {
    const saved = await chrome.storage.sync.get(null);
    const { settings, repairs } = normalizeSettings(saved);

    if (Object.keys(repairs).length > 0) {
      try {
        await chrome.storage.sync.set(repairs);
      } catch (error) {
        // A failed repair should never stop the extension from reading settings.
        console.warn("Focus Friend could not save repaired settings:", error);
      }
    }

    return settings;
  }

  // Save only the settings this version of Focus Friend understands.
  async function saveSettings(settings) {
    const { settings: normalized } = normalizeSettings(settings);
    await chrome.storage.sync.set({
      sites: normalized.sites,
      enabled_sites: normalized.enabled_sites,
      language: normalized.language,
      enabled: normalized.enabled,
      debounce_minutes: normalized.debounce_minutes,
      continue_checkin_enabled: normalized.continue_checkin_enabled,
      time_checkin_enabled: normalized.time_checkin_enabled,
      time_checkin_minutes: normalized.time_checkin_minutes
    });
  }

  // Turn entries like "https://www.reddit.com/some-page" into "reddit.com".
  function normalizeDomain(input) {
    const value = input.trim();
    if (!value) return null;

    let url;
    try {
      // Prepends https:// if a protocol is missing, then validates the URL
      url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const domain = url.hostname.toLowerCase().replace(/^www\./, "");
    const validDomain = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
    return validDomain.test(domain) ? domain : null;
  }

  globalThis.FocusStorage = { getSettings, saveSettings, normalizeDomain };
})();
