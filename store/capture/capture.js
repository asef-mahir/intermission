// Captures Chrome Web Store screenshots, tile, and marquee from the real UI.
// Run from the repository root: node store/capture/capture.js
// Output: store/screenshots/*.png and store/assets/*.png

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const TMP = path.join(__dirname, ".tmp");
const EXT = path.join(TMP, "ext");
const PROFILE = path.join(TMP, "profile");
const SHOTS = path.join(ROOT, "store", "screenshots");
const ASSETS = path.join(ROOT, "store", "assets");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9240;
const PAGE_PORT = 8130;

const RUNTIME_FILES = [
  "manifest.json",
  "background.js",
  "storage.js",
  "interceptor.js",
  "interceptor.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "content/en.json",
  "content/bn.json",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

function prepareExtension() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(EXT, { recursive: true });
  for (const rel of RUNTIME_FILES) {
    const destination = path.join(EXT, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), destination);
  }
  const manifestPath = path.join(EXT, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [
    "http://*.focus.test/*",
    "https://*.focus.test/*",
    "http://*.instagram.com/*",
    "https://*.instagram.com/*",
    "http://*.reddit.com/*",
    "https://*.reddit.com/*",
    "http://*.x.com/*",
    "https://*.x.com/*",
    "http://*.youtube.com/*",
    "https://*.youtube.com/*"
  ];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>drift</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #26322b; background: #f2f1ea; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 18px 32px; border-bottom: 1px solid #e2e3da; background: #fff; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: -.04em; color: #365943; }
  nav { display: flex; gap: 22px; color: #6a756c; }
  .avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #b9d3b4, #7d9d80); }
  main { width: min(680px, calc(100% - 40px)); margin: 30px auto; display: grid; gap: 16px; }
  article { padding: 20px; border: 1px solid #e4e5dc; border-radius: 16px; background: #fff; }
  .meta { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; color: #6a756c; font-size: 13px; }
  .meta .avatar { width: 24px; height: 24px; }
  article p { margin: 0 0 14px; }
  .media { height: 170px; border-radius: 12px; background: linear-gradient(135deg, #dcead8, #f0ead8 55%, #d9e9e6); }
</style></head>
<body>
  <header><div class="brand">drift</div><nav><span>Home</span><span>Explore</span><span>Saved</span></nav><div class="avatar"></div></header>
  <main>
    <article><div class="meta"><span class="avatar"></span><strong>Mira</strong><span>2h</span></div><p>Finally tried that tiny park behind the library. Three benches, one very serious duck.</p><div class="media"></div></article>
    <article><div class="meta"><span class="avatar"></span><strong>Theo</strong><span>4h</span></div><p>Made a list of things to do instead of opening this app. The list is now four pages long.</p></article>
  </main>
</body></html>`;

class CDP {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const key = `${message.sessionId || ""}:${message.method}`;
      const handlers = this.handlers.get(key) || [];
      for (const handler of handlers) handler(message.params);
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(method, handler, sessionId = undefined) {
    const key = `${sessionId || ""}:${method}`;
    const handlers = this.handlers.get(key) || [];
    handlers.push(handler);
    this.handlers.set(key, handlers);
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeout = 15000, interval = 100) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for condition${lastError ? `: ${lastError.message}` : ""}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });
  prepareExtension();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise((resolve) => server.listen(PAGE_PORT, "127.0.0.1", resolve));

  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=" + DEBUG_PORT,
    "--user-data-dir=" + PROFILE,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-component-update",
    "--no-proxy-server",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--host-resolver-rules=MAP focus.test 127.0.0.1",
    "--window-size=1280,800",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (data) => {
    const text = String(data);
    if (/ERROR|Extension/.test(text) && !/DevTools listening/.test(text)) process.stderr.write(text);
  });

  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return response.ok ? response.json() : null;
    }, 20000);
    const cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.open();

    const loaded = await cdp.send("Extensions.loadUnpacked", { path: EXT });
    const extensionId = loaded.id;
    const extensionTarget = await waitFor(async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      return targetInfos.find((target) => target.type === "service_worker" && target.url.includes(`chrome-extension://${extensionId}/background.js`));
    }, 15000);
    const { sessionId: swSession } = await cdp.send("Target.attachToTarget", { targetId: extensionTarget.targetId, flatten: true });
    await cdp.send("Runtime.enable", {}, swSession);
    const swEval = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, swSession);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };

    const settings = {
      sites: ["focus.test"],
      enabled_sites: ["focus.test"],
      language: "en",
      enabled: true,
      debounce_minutes: 20,
      continue_checkin_enabled: true,
      time_checkin_enabled: false,
      time_checkin_minutes: 20
    };
    await swEval(`refreshQueue`);
    await swEval(`chrome.storage.local.clear()`);
    await swEval(`chrome.storage.sync.set(${JSON.stringify(settings)})`);
    await swEval(`scheduleInterceptorSync()`);
    await waitFor(async () => {
      const scripts = await swEval(`chrome.scripting.getRegisteredContentScripts()`);
      return scripts.some((script) => script.id === "focus-friend-interceptor");
    }, 10000);

    const attach = async (targetId) => {
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Accessibility.enable", {}, sessionId);
      return sessionId;
    };
    const evalIn = async (sessionId, expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const axButtons = async (sessionId) => {
      const { nodes } = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
      return nodes.filter((node) => node.role?.value === "button" && node.name?.value);
    };
    const clickButton = async (sessionId, label) => {
      const buttons = await axButtons(sessionId);
      const node = buttons.find((entry) => entry.name.value.includes(label));
      if (!node) throw new Error(`Button not found: ${label}. Have: ${buttons.map((entry) => entry.name.value).join(" | ")}`);
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId }, sessionId);
      const quad = model.content;
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
      await sleep(800);
    };
    const capture = async (sessionId, name) => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
      const file = path.join(SHOTS, name);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log("wrote", path.relative(ROOT, file));
    };

    const page = await cdp.send("Target.createTarget", { url: "http://focus.test:8130/" });
    const pageSession = await attach(page.targetId);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false
    }, pageSession);
    await waitFor(async () => (await evalIn(pageSession, "document.readyState")) === "complete", 15000);
    await sleep(1400);

    await capture(pageSession, "01-greeting.png");

    await clickButton(pageSession, "Let's go");
    await sleep(600);
    await capture(pageSession, "02-breathing-ready.png");

    await clickButton(pageSession, "Start when ready");
    await sleep(4200);
    await capture(pageSession, "03-breathing.png");

    // Let three six-second cycles finish so the fact is tied to 3, not 0.
    // The breathing flow itself is unchanged; this only picks a better
    // marketing fact for the screenshot.
    await sleep(14000);

    await clickButton(pageSession, "Stop when ready");
    await sleep(1400);
    await capture(pageSession, "04-fact.png");

    // Seed five prior "Not now" choices so the next one shows the real check-in.
    await swEval(`(async () => {
      const now = new Date();
      const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      await chrome.storage.local.set({ not_now_daily_counts: { day, counts: { 'focus.test': 5 }, shown: [] } });
      await chrome.storage.local.remove('last_site_hit');
    })()`);
    const checkinPage = await cdp.send("Target.createTarget", { url: "http://focus.test:8130/?checkin=1" });
    const checkinSession = await attach(checkinPage.targetId);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false
    }, checkinSession);
    await waitFor(async () => (await evalIn(checkinSession, "document.readyState")) === "complete", 15000);
    await sleep(1400);
    await clickButton(checkinSession, "Not now");
    await sleep(1200);
    await capture(checkinSession, "05-checkin.png");

    // First-run disclosure and settings page. Use realistic sites and a clean
    // device-local state so the screenshots show a configured product.
    await swEval(`chrome.storage.sync.set(${JSON.stringify({
      sites: ["instagram.com", "reddit.com", "x.com", "youtube.com"],
      enabled_sites: ["instagram.com", "reddit.com", "x.com", "youtube.com"],
      language: "en",
      enabled: true,
      debounce_minutes: 20,
      continue_checkin_enabled: true,
      time_checkin_enabled: true,
      time_checkin_minutes: 45
    })})`);
    await swEval(`chrome.storage.local.clear()`);
    const firstRun = await cdp.send("Target.createTarget", { url: `chrome-extension://${extensionId}/options.html` });
    const firstRunSession = await attach(firstRun.targetId);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false
    }, firstRunSession);
    await sleep(1600);
    await capture(firstRunSession, "06-first-run.png");

    await evalIn(firstRunSession, `chrome.storage.local.set({onboarding_consent_version: 1, onboarding_consent_at: new Date().toISOString()})`);
    await cdp.send("Page.reload", {}, firstRunSession);
    await sleep(1800);
    await capture(firstRunSession, "07-settings.png");

    // Tile and marquee are branded compositions rendered in Chrome at exact sizes.
    const icon = fs.readFileSync(path.join(ROOT, "icons", "icon128.png")).toString("base64");
    const tileHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 440px; height: 280px; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif; color: #284b39; background:
        radial-gradient(ellipse at 20% 0%, #ffffff 0%, transparent 55%),
        linear-gradient(145deg, #e5f4e9, #f7f5e9 58%, #deefea); }
      .wrap { display: flex; height: 100%; padding: 30px 32px; flex-direction: column; justify-content: space-between; }
      img { width: 64px; height: 64px; }
      h1 { margin: 14px 0 6px; font-size: 34px; line-height: 1; letter-spacing: -.04em; }
      p { margin: 0; max-width: 330px; font-size: 15px; line-height: 1.45; color: #587461; }
      .pill { align-self: flex-start; padding: 5px 10px; border-radius: 999px; background: rgb(255 255 255 / 70%); font-size: 11px; font-weight: 700; letter-spacing: .08em; color: #46765a; }
    </style></head><body><div class="wrap">
      <div><img src="data:image/png;base64,${icon}" alt=""><h1>Intermission</h1><p>A short pause before the sites you choose.</p></div>
      <div class="pill">CHROME EXTENSION</div>
    </div></body></html>`;
    const marqueeHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1400px; height: 560px; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif; color: #284b39; background:
        radial-gradient(ellipse at 18% 8%, #ffffff 0%, transparent 52%),
        linear-gradient(145deg, #e5f4e9, #f7f5e9 58%, #deefea); }
      .wrap { display: grid; grid-template-columns: 1.2fr .8fr; align-items: center; height: 100%; padding: 64px 84px; gap: 60px; }
      img { width: 92px; height: 92px; }
      h1 { margin: 20px 0 12px; font-size: 76px; line-height: .98; letter-spacing: -.05em; }
      p { margin: 0; max-width: 620px; font-size: 25px; line-height: 1.4; color: #587461; }
      .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
      .chip { padding: 9px 14px; border-radius: 999px; background: rgb(255 255 255 / 72%); font-size: 14px; font-weight: 650; color: #365943; }
      .card { padding: 34px; border: 1px solid rgb(255 255 255 / 90%); border-radius: 32px; background: rgb(255 255 255 / 72%); box-shadow: 0 24px 70px rgb(46 83 58 / 14%); backdrop-filter: blur(16px); }
      .card .dot { width: 10px; height: 10px; border-radius: 50%; background: #9dbb9a; margin-bottom: 18px; }
      .card h2 { margin: 0 0 10px; font-size: 30px; line-height: 1.15; letter-spacing: -.03em; }
      .card p { font-size: 16px; }
      .bar { display: grid; place-items: center; height: 44px; margin-top: 22px; border-radius: 999px; background: #46765a; color: #fff; font-size: 14px; font-weight: 650; }
    </style></head><body><div class="wrap">
      <div><img src="data:image/png;base64,${icon}" alt=""><h1>Intermission</h1><p>A short pause before the sites you choose. Breathe, read something odd, and get back to what you meant to do.</p>
        <div class="chips"><span class="chip">5-minute breathing</span><span class="chip">Full-screen pause</span><span class="chip">No accounts or analytics</span></div>
      </div>
      <div class="card"><div class="dot"></div><h2>Before you drift off.</h2><p>One small pause, then a way back.</p><div class="bar">Let's go</div></div>
    </div></body></html>`;

    const renderHtml = async (html, width, height, file) => {
      const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
      const target = await cdp.send("Target.createTarget", { url: dataUrl });
      const session = await attach(target.targetId);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, session);
      await sleep(900);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, session);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log("wrote", path.relative(ROOT, file));
    };
    await renderHtml(tileHtml, 440, 280, path.join(ASSETS, "tile-440x280.png"));
    await renderHtml(marqueeHtml, 1400, 560, path.join(ASSETS, "marquee-1400x560.png"));

    cdp.close();
  } catch (error) {
    console.error("CAPTURE ERROR:", error.stack || error.message);
    process.exitCode = 1;
  } finally {
    server.close();
    spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    setTimeout(() => process.exit(process.exitCode || 0), 1000);
  }
}

main();
