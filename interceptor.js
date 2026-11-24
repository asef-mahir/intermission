(() => {
  const HOST_ID = "focus-friend-overlay-host";
  const GENTLE_PILL_HOST_ID = "focus-friend-gentle-pill-host";
  const INSTANCE_TOKEN = { id: `${Date.now()}-${Math.random()}`, cleanup: null };
  const previousInstance = globalThis.__focusFriendInstance;

  // A second copy can be injected when the extension is switched back on in a
  // tab that already has an instance. Replace the old instance instead of
  // letting a stale guard block the fresh one.
  if (previousInstance && previousInstance !== INSTANCE_TOKEN) {
    try {
      previousInstance.cleanup?.();
    } catch (error) {
      console.warn("Intermission could not clean up an older instance:", error);
    }
    document.getElementById(HOST_ID)?.remove();
    document.getElementById(GENTLE_PILL_HOST_ID)?.remove();
  }

  globalThis.__focusFriendInstance = INSTANCE_TOKEN;

  function isCurrentInstance() {
    return globalThis.__focusFriendInstance === INSTANCE_TOKEN;
  }

  const DEFAULT_COOLDOWN_MINUTES = 20;
  const BREATH_CYCLE_MS = 6_000;
  const previousPageUrl = document.referrer;
  const BREATH_MAX_MS = 300_000;

  let host = null;
  let shadow = null;
  let activeDomain = null;
  let settings = null;
  let copy = null;
  let view = "greeting";
  let cycleCount = 0;
  let breathingStartedAt = 0;
  let breathDeadline = 0;
  let cyclePhase = "in";
  let breathTimer = null;
  let transitionTimer = null;
  let factSelection = null;
  let selectedGreetingIndex = null;
  let selectedVentOfferIndex = null;
  let selectedGoodbyeIndex = null;
  let ventDraft = "";
  let ventHits = 0;
  let ventIdleTimer = null;
  let ventResumeView = null;
  let ventWarningKind = "five";
  let ventTapTimer = null;
  let audioContext = null;
  let focusObserver = null;
  let pageInert = false;
  let previousFocus = null;
  let previousBodyInert = false;
  let previousBodyAriaHidden = null;
  let startupWatchdog = null;
  let focusInListenerAttached = false;
  const VENT_HITS_TO_COMPLETE = 30;
  const VENT_ROUNDS_PER_DAY = 20;
  const STUDY_FULL_WORDS = 40; // words that fill the quiet progress line

  function setPageInert(inert) {
    const body = document.body;
    if (!body) return;

    if (inert) {
      if (pageInert) return;
      const active = document.activeElement;
      if (active && active !== body && active !== document.documentElement) {
        previousFocus = active;
      }
      previousBodyInert = body.inert;
      previousBodyAriaHidden = body.getAttribute("aria-hidden");
      body.inert = true;
      body.setAttribute("aria-hidden", "true");
      pageInert = true;
      return;
    }

    if (!pageInert) return;
    body.inert = previousBodyInert;
    if (previousBodyAriaHidden === null) {
      body.removeAttribute("aria-hidden");
    } else {
      body.setAttribute("aria-hidden", previousBodyAriaHidden);
    }
    pageInert = false;

    const target = previousFocus;
    previousFocus = null;
    if (target && target.isConnected && typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch (_) {
        // The site may have removed the element while the pause was open.
      }
    }
  }

  function getFocusableElements() {
    if (!shadow) return [];
    return [...shadow.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length > 0);
  }

  function focusFirstInView() {
    if (!host || !shadow) return;
    const panel = shadow.querySelector(".panel");
    if (!panel) return;

    const active = shadow.activeElement;
    if (active && active !== panel && panel.contains(active)) return;

    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      focusables[0].focus({ preventScroll: true });
    } else {
      panel.focus({ preventScroll: true });
    }
  }

  function watchViewFocus() {
    if (!shadow) return;
    const panel = shadow.querySelector(".panel");
    if (!panel || typeof MutationObserver !== "function") return;

    focusObserver?.disconnect();
    focusObserver = new MutationObserver(() => {
      if (!host || !isCurrentInstance()) return;
      requestAnimationFrame(() => {
        if (host) focusFirstInView();
      });
    });
    focusObserver.observe(panel, { childList: true });
  }

  function applyOverlayLanguage() {
    if (!host) return;
    const language = settings?.language === "bn" ? "bn" : "en";
    host.lang = language;
    host.dir = "ltr";
    shadow?.querySelector(".panel")?.setAttribute("lang", language);
  }

  function handleOverlayKeydown(event) {
    if (!host || !shadow || event.key !== "Tab") return;
    const panel = shadow.querySelector(".panel");
    if (!panel) return;

    const focusables = getFocusableElements();
    if (focusables.length === 0) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = shadow.activeElement;

    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
    } else if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function handleFocusIn(event) {
    if (!host || !pageInert) return;
    if (event.composedPath().includes(host)) return;
    focusFirstInView();
  }

  function revealPage() {
    if (host) {
      host.remove();
      host = null;
      shadow = null;
    }
    focusObserver?.disconnect();
    focusObserver = null;
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    if (breathTimer) {
      clearInterval(breathTimer);
      breathTimer = null;
    }
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    if (ventIdleTimer) {
      clearTimeout(ventIdleTimer);
      ventIdleTimer = null;
    }
    if (ventTapTimer) {
      clearTimeout(ventTapTimer);
      ventTapTimer = null;
    }
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    ventDraft = "";
    ventHits = 0;
    ventResumeView = null;
    factSelection = null;
    selectedGreetingIndex = null;
    selectedVentOfferIndex = null;
    selectedGoodbyeIndex = null;
    // Mark the page as released so the declarative hide rule cannot apply again
    // if the site later clears the inline visibility style.
    document.documentElement?.setAttribute("data-focus-friend-revealed", "");
    document.documentElement?.style.setProperty("visibility", "visible", "important");
    setPageInert(false);
  }

  function prepareAudio() {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return null;
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContextType();
    }
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playHitSound(kind) {
    const context = prepareAudio();
    if (!context) return;

    try {
      const now = context.currentTime;
      const isKick = kind === "kick";
      const noiseDuration = isKick ? 0.16 : 0.09;
      const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * noiseDuration), context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
      }

      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(isKick ? 650 : 1_450, now);
      const noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(isKick ? 0.12 : 0.085, now + 0.004);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDuration);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(context.destination);
      noise.start(now);
      noise.stop(now + noiseDuration);

      const thump = context.createOscillator();
      const thumpGain = context.createGain();
      const thumpDuration = isKick ? 0.22 : 0.14;
      thump.type = "sine";
      thump.frequency.setValueAtTime(isKick ? 82 : 128, now);
      thump.frequency.exponentialRampToValueAtTime(isKick ? 38 : 58, now + thumpDuration);
      thumpGain.gain.setValueAtTime(0.0001, now);
      thumpGain.gain.exponentialRampToValueAtTime(isKick ? 0.16 : 0.11, now + 0.005);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + thumpDuration);
      thump.connect(thumpGain);
      thumpGain.connect(context.destination);
      thump.start(now);
      thump.stop(now + thumpDuration);
    } catch (error) {
      console.warn("Focus Friend could not play the soft impact sound:", error);
    }
  }

  function playBurnSound() {
    const context = prepareAudio();
    if (!context) return;

    try {
      const now = context.currentTime;
      const duration = 0.75;
      const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / samples.length, 1.8);
      }

      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + duration);
      filter.Q.setValueAtTime(1.4, now);

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.065, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      noise.start(now);
      noise.stop(now + duration);
    } catch (error) {
      console.warn("Focus Friend could not play the burn dissipation sound:", error);
    }
  }

  function mountCover() {
    const page = document.documentElement;
    if (!page || host) return Boolean(host);

    host = document.createElement("div");
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .screen {
          box-sizing: border-box;
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(ellipse at 50% 12%, rgb(255 255 255 / 92%), transparent 46%),
            linear-gradient(145deg, #e5f4e9, #f7f5e9 58%, #deefea);
          color: #284b39;
          font: 16px/1.5 system-ui, sans-serif;
          text-align: center;
          pointer-events: auto;
        }
        .screen.fresh {
          background:
            radial-gradient(ellipse at 50% 12%, rgb(255 255 255 / 92%), transparent 46%),
            linear-gradient(145deg, #e5f4e9, #f7f5e9 58%, #deefea);
          color: #284b39;
        }

        .panel { position: relative; width: min(520px, 100%); }
        /* Shown for the moment between mounting the cover and the first panel. */
        .splash { display: grid; place-items: center; min-height: 140px; }
        .splash::before {
          content: "";
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #46765a;
          opacity: 0.3;
          animation: splash-breathe 1.6s ease-in-out infinite;
        }
        @keyframes splash-breathe {
          0%, 100% { transform: scale(0.82); opacity: 0.24; }
          50% { transform: scale(1.08); opacity: 0.46; }
        }
        h1 { margin: 0 0 12px; font-size: clamp(26px, 5vw, 38px); line-height: 1.2; color: #284b39; }
        p { margin: 0 0 22px; color: #587461; }
        .fresh p { color: #587461; }
        .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
        .greeting-panel {
          box-sizing: border-box;
          width: min(560px, 100%);
          padding: clamp(28px, 6vw, 44px);
          border: 1px solid rgb(255 255 255 / 88%);
          border-radius: 28px;
          background: rgb(255 255 255 / 76%);
          box-shadow: 0 20px 60px rgb(46 83 58 / 12%), inset 0 1px rgb(255 255 255 / 90%);
          backdrop-filter: blur(16px);
        }
        .greeting-panel h1 { max-width: 13ch; margin: 0 auto 14px; font-size: clamp(26px, 5vw, 34px); }
        .greeting-actions { flex-direction: column; align-items: center; gap: 14px; }
        .greeting-actions button { width: min(100%, 340px); min-height: 52px; padding: 13px 22px; }
        .greeting-panel .greeting-actions .secondary { border: 1px solid #cbdccd; background: rgb(255 255 255 / 78%); color: #365943; box-shadow: none; }
        button {
          min-height: 46px;
          border: 0;
          border-radius: 999px;
          padding: 11px 20px;
          font: inherit;
          cursor: pointer;
        }
        button:focus-visible { outline: 3px solid #46765a; outline-offset: 3px; }
        .primary { background: #46765a; color: #fff; box-shadow: 0 8px 22px rgb(55 104 69 / 18%); }
        .secondary { background: #e3eee4; color: #365943; }
        .fresh .primary { background: #46765a; color: #fff; box-shadow: 0 8px 22px rgb(55 104 69 / 18%); }
        .fresh .secondary { background: #e3eee4; color: #365943; }
        /* ── Realistic Breathing Lungs Component ────────────── */
        .breath-lungs-wrap {
          position: relative;
          width: 230px;
          height: 195px;
          margin: 10px auto 16px;
          display: grid;
          place-items: center;
          animation: lungs-float 5s ease-in-out infinite;
        }
        @keyframes lungs-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }

        .breath-lungs-wrap.prep-mode {
          animation: lungs-idle 4.5s ease-in-out infinite;
        }
        @keyframes lungs-idle {
          0%, 100% { transform: scale(0.97) translateY(2px); }
          50% { transform: scale(1.02) translateY(-2px); }
        }

        .breath-lungs {
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        /* Anatomical Lobe Expansion */
        .lung-lobe-group {
          transition: transform 3s cubic-bezier(0.37, 0, 0.63, 1);
        }
        .lung-right {
          transform-origin: 106px 72px;
        }
        .lung-left {
          transform-origin: 134px 72px;
        }

        .lung-air-pulse {
          opacity: 0.15;
          transition: opacity 3s cubic-bezier(0.37, 0, 0.63, 1), transform 3s cubic-bezier(0.37, 0, 0.63, 1);
          transform-origin: center;
        }

        .alveoli-nodes {
          opacity: 0.45;
          transition: opacity 3s cubic-bezier(0.37, 0, 0.63, 1);
        }

        .bronchial-tree {
          opacity: 0.7;
          transition: opacity 3s cubic-bezier(0.37, 0, 0.63, 1);
        }

        /* Inhale (Expansion) State */
        .breath-lungs-wrap.expand .lung-right {
          transform: scale(1.18, 1.15) rotate(2.8deg) translate(-4px, 3px);
        }
        .breath-lungs-wrap.expand .lung-left {
          transform: scale(1.18, 1.15) rotate(-2.8deg) translate(4px, 3px);
        }
        .breath-lungs-wrap.expand .lung-air-pulse {
          opacity: 0.85;
          transform: scale(1.14);
        }
        .breath-lungs-wrap.expand .alveoli-nodes {
          opacity: 0.95;
        }
        .breath-lungs-wrap.expand .bronchial-tree {
          opacity: 0.95;
        }
        .breath-cue { margin: 12px 0; color: #365943; font-size: 18px; }
        .cycle-count { display: flex; align-items: baseline; justify-content: center; gap: 8px; }
        .count { color: #284b39; font-size: 36px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .count-label { color: #587461; }
        .timer { margin-bottom: 8px; color: #c7dfb2; font-size: 22px; font-variant-numeric: tabular-nums; }
        .fresh .timer { color: #46765a; }
        .vent-offer-button {
          display: block;
          margin: 14px auto 0;
          min-height: 40px;
          border: 1px solid rgb(70 118 90 / 22%);
          border-radius: 999px;
          padding: 8px 18px;
          background: rgb(255 255 255 / 75%);
          color: #365943;
          font: inherit;
          font-size: 14px;
          cursor: pointer;
          backdrop-filter: blur(8px);
          box-shadow: 0 4px 14px rgb(55 104 69 / 8%);
          transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
        }
        .vent-offer-button:hover {
          background: rgb(255 255 255 / 92%);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgb(55 104 69 / 12%);
        }
        .fact-intro { margin-bottom: 6px; color: #46765a; font-size: 14px; }
        .fact-text { color: #284b39; font-size: 17px; line-height: 1.5; }
        .screen.toast-mode {
          display: block;
          min-height: 0;
          padding: 0;
          background: transparent;
          pointer-events: none;
          text-align: left;
        }
        .toast-mode .panel {
          position: fixed;
          right: 18px;
          bottom: 18px;
          box-sizing: border-box;
          width: min(440px, calc(100vw - 36px));
          padding: 18px;
          border: 1px solid #d8e5d8;
          border-radius: 18px;
          background: #f7f8ef;
          color: #284b39;
          box-shadow: 0 12px 36px rgb(35 62 43 / 20%);
          pointer-events: auto;
          text-align: left;
        }
        .toast-mode h1 { margin-bottom: 14px; font-size: 19px; }
        .toast-mode .actions { justify-content: flex-end; }
        .toast-mode button { min-height: 40px; padding: 9px 14px; font-size: 14px; }

        /* ── The Study: vent writing room ───────────────────── */
        .screen.vent-room {
          --paper: #f3ede0;
          --paper-deep: #e7dcc7;
          --ink: #1c2a23;
          --muted: #6f776d;
          --copper: #a9633c;
          --line: rgb(92 74 48 / 18%);
          --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
          position: relative;
          background:
            radial-gradient(ellipse at 50% -12%, rgb(255 250 235 / 96%), transparent 56%),
            var(--grain),
            linear-gradient(158deg, #f7f1e4 0%, #f0e7d5 56%, #e9ddc8 100%);
          background-size: auto, 160px 160px, auto;
          color: var(--ink);
        }
        .screen.vent-room::after {
          content: "";
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: radial-gradient(ellipse at 50% 38%, transparent 44%, rgb(80 60 35 / 14%) 100%);
        }
        .screen.vent-entry {
          --ink: #284b39;
          --muted: #587461;
          --copper: #46765a;
          --line: rgb(70 118 90 / 18%);
        }
        .screen.vent-entry .panel {
          width: min(680px, 100%);
          text-align: left;
        }
        .screen.vent-entry .vent-study::before {
          background: radial-gradient(ellipse at 50% 0%, rgb(255 255 255 / 92%), transparent 68%);
        }
        .vent-entry .study-index { color: rgb(40 75 57 / 55%); }
        .vent-entry .study-title em { color: #46765a; }
        .vent-entry .study-choice:hover,
        .vent-entry .study-choice:active { background: rgb(70 118 90 / 7%); }

        .screen.vent-room .panel {
          position: relative;
          z-index: 1;
          width: min(680px, 100%);
          text-align: left;
        }
        .vent-room .panel > h1,
        .study-title {
          font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Noto Serif Bengali", "Vrinda", Georgia, serif;
          font-weight: 400;
          letter-spacing: -0.02em;
          color: var(--ink);
        }
        .vent-room .panel > h1 {
          margin: 0 0 14px;
          font-size: clamp(34px, 5.5vw, 48px);
          line-height: 1.06;
        }
        .vent-room .panel > p {
          max-width: 46ch;
          margin: 0 0 26px;
          color: var(--muted);
          font-size: 14px;
        }
        .vent-room .actions { justify-content: flex-start; gap: 14px; }
        .vent-room .actions button {
          min-height: 44px;
          border-radius: 2px;
          padding: 10px 18px;
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .vent-room .actions .primary {
          background: var(--ink);
          color: #f7f1e4;
          box-shadow: none;
        }
        .vent-room .actions .secondary {
          border: 1px solid var(--line);
          background: transparent;
          color: var(--muted);
          box-shadow: none;
        }
        .vent-room button:focus-visible { outline-color: var(--copper); }

        .vent-study {
          position: relative;
          isolation: isolate;
          animation: study-enter 620ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes study-enter {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .vent-study::before {
          content: "";
          position: absolute;
          z-index: 0;
          inset: -22% -12% auto;
          height: 74%;
          background: radial-gradient(ellipse at 50% 0%, rgb(255 246 222 / 92%), transparent 68%);
          filter: blur(18px);
          opacity: 0.55;
          pointer-events: none;
          animation: study-lamp 14s ease-in-out infinite;
        }
        @keyframes study-lamp {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 0.65; transform: scale(1.03); }
        }
        .vent-study > * { position: relative; z-index: 1; }

        .study-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 30px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--line);
        }
        .study-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: var(--copper);
          font: 600 10px/1 system-ui, sans-serif;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .study-eyebrow::before {
          content: "";
          width: 26px;
          height: 1px;
          background: currentColor;
          opacity: 0.6;
        }
        .study-index {
          color: rgb(90 75 55 / 55%);
          font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
          font-size: 12px;
          letter-spacing: 0.12em;
        }

        .study-title {
          max-width: 18ch;
          margin: 0 0 16px;
          font-size: clamp(38px, 6vw, 56px);
          line-height: 1.02;
        }
        .study-title em {
          color: #8a4f30;
          font-style: italic;
        }
        .study-title:lang(bn) em { font-style: normal; }
        .study-note {
          max-width: 46ch;
          margin: 0 0 24px;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.6;
        }
        .vent-room .study-note { color: var(--muted); }

        /* Choice rows */
        .study-choices { border-top: 1px solid var(--line); }
        .study-choice {
          display: grid;
          grid-template-columns: 38px 1fr 24px;
          gap: 16px;
          align-items: center;
          width: 100%;
          min-height: 0;
          padding: 22px 4px;
          border: 0;
          border-bottom: 1px solid var(--line);
          border-radius: 0;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
          transition: background 260ms ease, padding-left 260ms ease;
        }
        .study-choice:hover,
        .study-choice:active {
          padding-left: 12px;
          background: rgb(169 99 60 / 6%);
        }
        .study-choice-num {
          color: var(--copper);
          font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
          font-size: 13px;
          letter-spacing: 0.08em;
        }
        .study-choice-body { display: flex; flex-direction: column; gap: 4px; }
        .study-choice-body strong {
          font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Noto Serif Bengali", "Vrinda", Georgia, serif;
          font-size: 24px;
          font-weight: 400;
          letter-spacing: -0.01em;
        }
        .study-choice-hint {
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
        }
        .study-choice-arrow {
          color: var(--copper);
          font-size: 20px;
          transition: transform 260ms ease;
        }
        .study-choice:hover .study-choice-arrow { transform: translateX(5px); }

        .study-link {
          position: relative;
          display: inline-block;
          margin-top: 26px;
          min-height: 0;
          padding: 0 0 2px;
          border: 0;
          border-bottom: 1px solid transparent;
          border-radius: 0;
          background: none;
          color: var(--muted);
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .study-link::after,
        .study-burn::after {
          content: "";
          position: absolute;
          inset: -10px -8px;
        }
        .study-link:hover {
          color: var(--ink);
          border-bottom-color: currentColor;
        }
        .study-link:disabled {
          opacity: 0.4;
          cursor: default;
          pointer-events: none;
        }

        /* Writing sheet */
        .study-sheet {
          position: relative;
          border: 1px solid rgb(120 95 60 / 22%);
          border-radius: 4px;
          background:
            linear-gradient(180deg, rgb(255 255 255 / 72%), rgb(255 252 244 / 28%)),
            #faf5ea;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 88%),
            0 26px 50px -30px rgb(64 48 28 / 42%),
            0 2px 6px rgb(64 48 28 / 7%);
          overflow: hidden;
          transition: border-color 240ms ease, box-shadow 240ms ease;
        }
        .study-sheet:focus-within {
          border-color: rgb(169 99 60 / 42%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 88%),
            0 28px 56px -30px rgb(64 48 28 / 46%),
            0 0 0 3px rgb(169 99 60 / 10%);
        }
        .study-sheet.burning {
          border-color: rgb(169 99 60 / 50%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 80%),
            0 30px 60px -30px rgb(120 60 25 / 42%),
            0 0 0 3px rgb(169 99 60 / 12%);
        }
        .study-sheet::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 0;
          background-image: var(--grain);
          background-size: 160px 160px;
          opacity: 0.55;
          pointer-events: none;
        }
        .vent-words,
        .vent-textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: clamp(190px, 30vh, 260px);
          padding: 26px 28px;
          margin: 0;
          border: 0;
          border-radius: 0;
          font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Noto Serif Bengali", "Vrinda", Georgia, serif;
          font-size: 18px;
          font-weight: 400;
          line-height: 1.7;
          letter-spacing: normal;
          word-spacing: normal;
          text-align: left;
          white-space: pre-wrap;
          overflow-wrap: break-word;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }
        .vent-words {
          position: absolute;
          inset: 0;
          z-index: 1;
          overflow-y: hidden;
          overflow-x: hidden;
          pointer-events: none;
          color: var(--ink);
        }
        .vent-textarea {
          position: relative;
          z-index: 2;
          display: block;
          background: transparent;
          color: transparent;
          caret-color: var(--copper);
          resize: none;
          outline: none;
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .vent-textarea::-webkit-scrollbar { display: none; }
        .vent-textarea::placeholder {
          color: #9a9c90;
          font-style: italic;
        }
        .vent-textarea::selection {
          background: rgb(169 99 60 / 22%);
          color: transparent;
        }
        .vent-word { display: inline; color: inherit; }
        .study-sheet.burning .vent-textarea {
          opacity: 0;
          pointer-events: none;
          transition: opacity 180ms ease;
        }
        .study-sheet.burning .vent-word {
          display: inline-block;
          animation: word-ash 720ms cubic-bezier(0.22, 1, 0.36, 1) var(--w-delay, 0ms) forwards;
        }
        @keyframes word-ash {
          0% { opacity: 1; filter: blur(0); transform: translateY(0); color: var(--ink); }
          35% { color: #a9633c; }
          100% { opacity: 0; filter: blur(3px); transform: translateY(-12px); color: #7a6b58; }
        }
        .study-sheet.burning::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: none;
          background: radial-gradient(ellipse at 50% 100%, rgb(190 95 45 / 22%), transparent 62%);
          animation: study-scorch 1100ms ease-out forwards;
        }
        @keyframes study-scorch {
          0% { opacity: 0; }
          30% { opacity: 1; }
          100% { opacity: 0; }
        }

        .study-progress {
          height: 1px;
          margin: 18px 0 14px;
          background: rgb(92 74 48 / 16%);
          overflow: hidden;
        }
        .study-progress-fill {
          display: block;
          width: 0%;
          height: 100%;
          background: var(--copper);
          transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .study-foot {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 20px;
        }
        .study-count {
          color: #8a8b7f;
          font: 600 10px/1 system-ui, sans-serif;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .study-burn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 0;
          padding: 4px 0 6px;
          border: 0;
          border-bottom: 1px solid currentColor;
          border-radius: 0;
          background: none;
          color: var(--copper);
          font: 600 12px/1 system-ui, sans-serif;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          cursor: pointer;
          transition: color 200ms ease, gap 200ms ease;
        }
        .study-burn:hover:not(:disabled) {
          gap: 15px;
          color: #7f4528;
        }
        .study-burn:disabled {
          color: #b9b2a3;
          cursor: default;
        }
        .study-burn-arrow { font-size: 16px; }
        .study-back { margin-top: 22px; }

        /* Burned screen */
        .vent-burned-room {
          padding: clamp(30px, 7vh, 70px) 0;
          text-align: center;
        }
        .vent-burned-room .study-title::before {
          content: "";
          display: block;
          width: 6px;
          height: 6px;
          margin: 0 auto 26px;
          border-radius: 50%;
          background: var(--copper);
        }
        .vent-burned-room .study-title {
          max-width: none;
          margin: 0 0 12px;
          font-size: clamp(44px, 8vw, 70px);
        }
        .vent-burned-room .study-note { margin: 0 auto 28px; }
        .vent-burned-room .study-link { margin-top: 0; }

        /* ── Vent punch scene ───────────────────────────────── */
        .vent-scene {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 0px;
          width: min(430px, 100%);
          height: 290px;
          margin: 4px auto 14px;
          overflow: visible;
          position: relative;
        }

        /* Floor shadow */
        .vent-scene::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 85%;
          height: 14px;
          border-radius: 50%;
          background: radial-gradient(ellipse, rgb(40 75 55 / 18%) 0%, transparent 72%);
          pointer-events: none;
        }

        .vent-character {
          width: 160px;
          height: 268px;
          flex: 0 0 auto;
          overflow: visible;
          filter: drop-shadow(2px 6px 10px rgb(40 70 50 / 18%));
        }

        /* Boxer body animations */
        .char-punch-arm  { transform-box: fill-box; transform-origin: 15% 25%; }
        .char-punch-arm2 { transform-box: fill-box; transform-origin: 85% 25%; }
        .char-kick-leg   { transform-box: fill-box; transform-origin: 50% 10%; }
        .char-torso      { transform-box: fill-box; transform-origin: 50% 50%; }

        .vent-character.punching  { animation: body-lean-punch 280ms cubic-bezier(.3,0,.4,1); }
        .vent-character.kicking   { animation: body-lean-kick  360ms cubic-bezier(.3,0,.4,1); }
        .vent-character.punching .char-punch-arm  { animation: boxer-jab     280ms cubic-bezier(.15,0,.35,1); }
        .vent-character.punching .char-punch-arm2 { animation: boxer-guard   280ms cubic-bezier(.15,0,.35,1); }
        .vent-character.kicking  .char-kick-leg   { animation: boxer-kick    360ms cubic-bezier(.15,0,.35,1); }
        .vent-character.punching .char-torso      { animation: boxer-torso-punch 280ms cubic-bezier(.15,0,.35,1); }
        .vent-character.kicking  .char-torso      { animation: boxer-torso-kick  360ms cubic-bezier(.15,0,.35,1); }

        @keyframes body-lean-punch {
          0%   { transform: translateX(0) rotate(0) scaleX(1); }
          28%  { transform: translateX(12px) rotate(4deg) scaleX(1.03); }
          65%  { transform: translateX(6px) rotate(2deg); }
          100% { transform: translateX(0) rotate(0) scaleX(1); }
        }
        @keyframes body-lean-kick {
          0%   { transform: translateX(0) rotate(0); }
          30%  { transform: translateX(10px) rotate(-6deg); }
          65%  { transform: translateX(4px) rotate(-2deg); }
          100% { transform: translateX(0) rotate(0); }
        }
        @keyframes boxer-jab {
          0%   { transform: translate(0, 0) rotate(0) scale(1); }
          30%  { transform: translate(50px, -18px) rotate(-22deg) scale(1.08); }
          58%  { transform: translate(42px, -14px) rotate(-18deg) scale(1.04); }
          100% { transform: translate(0, 0) rotate(0) scale(1); }
        }
        @keyframes boxer-guard {
          0%   { transform: translate(0, 0); }
          30%  { transform: translate(-4px, -6px); }
          100% { transform: translate(0, 0); }
        }
        @keyframes boxer-kick {
          0%   { transform: translate(0, 0) rotate(0); }
          28%  { transform: translate(36px, -32px) rotate(-72deg); }
          58%  { transform: translate(28px, -24px) rotate(-58deg); }
          100% { transform: translate(0, 0) rotate(0); }
        }
        @keyframes boxer-torso-punch {
          0%   { transform: rotate(0) scaleX(1); }
          30%  { transform: rotate(6deg) scaleX(1.04); }
          100% { transform: rotate(0) scaleX(1); }
        }
        @keyframes boxer-torso-kick {
          0%   { transform: rotate(0); }
          30%  { transform: rotate(-8deg); }
          100% { transform: rotate(0); }
        }

        /* bag */
        .vent-bag-wrap {
          position: relative;
          display: flex;
          flex: 0 0 128px;
          flex-direction: column;
          align-items: center;
          height: 272px;
          transform-origin: top center;
          margin-left: -4px;
        }
        .vent-bag-wrap.swinging   { animation: bag-swing      380ms cubic-bezier(.4,0,.2,1); }
        .vent-bag-wrap.kick-swing { animation: bag-kick-swing 460ms cubic-bezier(.4,0,.2,1); }

        /* Chain assembly */
        .bag-mount {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }
        .bag-hook {
          width: 10px;
          height: 14px;
          border: 3.5px solid #6a7570;
          border-bottom: 0;
          border-radius: 6px 6px 0 0;
          background: linear-gradient(90deg, #8a9490, #c8d0cc, #8a9490);
        }
        .bag-chain {
          position: relative;
          width: 10px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .bag-link {
          width: 10px;
          height: 7px;
          border: 2.5px solid #707870;
          border-radius: 4px;
          background: linear-gradient(90deg, #8a9490, #d0d8d2 50%, #8a9490);
          margin-bottom: 1px;
        }
        .bag-swivel {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2.5px solid #5a6560;
          background: radial-gradient(circle at 38% 32%, #c0c8c4, #7a8480);
          margin-bottom: 2px;
        }

        .vent-bag {
          position: relative;
          display: block;
          width: 108px;
          height: 190px;
          margin: 0;
          padding: 0;
          border: 0;
          cursor: pointer;
          touch-action: none;
          overflow: visible;
          background: none;
        }

        /* bag hit animations */
        .vent-bag.hit  { animation: bag-shake 260ms cubic-bezier(.3,0,.5,1); }
        .vent-bag.kick { animation: bag-kick  340ms cubic-bezier(.3,0,.5,1); }
        .vent-bag-wrap.burst .vent-bag svg { animation: bag-burst 720ms cubic-bezier(.4,0,.6,1) forwards; }
        @keyframes bag-shake {
          0%   { transform: rotate(0deg) translateX(0) scaleY(1) scaleX(1); }
          20%  { transform: rotate(-6deg) translateX(-6px) scaleX(1.07) scaleY(.92); }
          48%  { transform: rotate(5deg)  translateX(5px)  scaleX(.96) scaleY(1.05); }
          75%  { transform: rotate(-2deg) translateX(-2px); }
          100% { transform: rotate(0deg) translateX(0) scaleY(1) scaleX(1); }
        }
        @keyframes bag-kick {
          0%   { transform: translateX(0) rotate(0) scaleX(1) scaleY(1); }
          25%  { transform: translateX(32px) rotate(13deg) scaleX(.90) scaleY(1.07); }
          58%  { transform: translateX(-16px) rotate(-7deg) scaleX(1.05) scaleY(.96); }
          80%  { transform: translateX(5px) rotate(2deg); }
          100% { transform: translateX(0) rotate(0) scaleX(1) scaleY(1); }
        }
        @keyframes bag-swing {
          0%   { transform: rotate(0); }
          28%  { transform: rotate(var(--swing-neg)); }
          58%  { transform: rotate(calc(var(--swing-pos) * 0.6)); }
          78%  { transform: rotate(calc(var(--swing-neg) * 0.25)); }
          100% { transform: rotate(0); }
        }
        @keyframes bag-kick-swing {
          0%   { transform: rotate(0); }
          25%  { transform: rotate(var(--swing-pos)); }
          55%  { transform: rotate(calc(var(--swing-neg) * 0.55)); }
          75%  { transform: rotate(calc(var(--swing-pos) * 0.22)); }
          100% { transform: rotate(0); }
        }
        @keyframes bag-burst {
          0%   { transform: scale(1);         opacity: 1;   filter: brightness(1) saturate(1); }
          30%  { transform: scale(1.2, 1.12); opacity: 1;   filter: brightness(1.5) saturate(1.4); }
          100% { transform: scale(.4, .5);    opacity: 0;   filter: brightness(2) saturate(0.5); }
        }

        /* Shockwave ring on hit */
        .impact-ring {
          position: absolute;
          z-index: 6;
          left: var(--px, 50%);
          top: var(--py, 38%);
          width: 8px;
          height: 8px;
          border-radius: 50%;
          pointer-events: none;
          border: 3px solid rgb(255 180 60 / 90%);
          transform: translate(-50%, -50%) scale(0.3);
          animation: ring-expand 380ms cubic-bezier(.2, .6, .4, 1) forwards;
        }
        @keyframes ring-expand {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.3); }
          60%  { opacity: 0.6; border-width: 2px; }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(5.5); border-width: 1px; }
        }

        /* impact particles & sparks */
        .impact-particle {
          position: absolute;
          z-index: 4;
          left: var(--px, 50%);
          top: var(--py, 35%);
          pointer-events: none;
          font-size: 20px;
          transform: translate(-50%, -50%);
          animation: particle-pop 580ms cubic-bezier(.2, .8, .4, 1) forwards;
        }
        @keyframes particle-pop {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(.6) rotate(0deg); }
          25%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--drift)), calc(-50% - 52px)) scale(1.5) rotate(var(--spin, 90deg)); }
        }
        .impact-spark {
          position: absolute;
          z-index: 5;
          left: var(--px, 50%);
          top: var(--py, 35%);
          width: 5px;
          height: 5px;
          border-radius: 50%;
          pointer-events: none;
          background: radial-gradient(circle, #fff9e0 0%, #ffcc44 50%, rgb(255 100 10 / 60%) 100%);
          transform: translate(-50%, -50%);
          animation: spark-fly 480ms cubic-bezier(.15, .8, .4, 1) forwards;
        }
        @keyframes spark-fly {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))) scale(0.3); }
        }

        /* bag burst flash + fragments */
        .burst-flash {
          position: absolute;
          z-index: 5;
          left: 50%;
          top: 50%;
          width: 180px;
          height: 180px;
          border-radius: 50%;
          pointer-events: none;
          background: radial-gradient(circle, rgb(255 250 220 / 98%) 0 12%, rgb(255 190 50 / 85%) 38%, rgb(255 80 20 / 50%) 65%, transparent 78%);
          transform: translate(-50%, -50%) scale(.15);
          opacity: 0;
          animation: flash-pop 560ms cubic-bezier(.2, .8, .4, 1) forwards;
        }
        @keyframes flash-pop {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(.15); }
          25%  { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.0); }
        }
        .burst-fragment {
          position: absolute;
          z-index: 4;
          left: 50%;
          top: 55%;
          width: var(--fw, 22px);
          height: var(--fh, 12px);
          border-radius: 35% 60% 50% 45%;
          pointer-events: none;
          background: linear-gradient(135deg, #d43040 10%, #8a0f1e 70%, #5a0810);
          box-shadow: inset 0 2px 4px rgb(255 255 255 / 18%), inset 0 -2px 4px rgb(0 0 0 / 30%);
          transform: translate(-50%, -50%);
          animation: fragment-fly 780ms cubic-bezier(.15, .85, .4, 1) forwards;
        }
        @keyframes fragment-fly {
          0%   { opacity: 1; transform: translate(-50%, -50%) rotate(0deg) scale(1); }
          15%  { opacity: 1; }
          100% { opacity: 0; transform: translate(calc(-50% + var(--fx)), calc(-50% + var(--fy))) rotate(var(--frot)) scale(.5); }
        }

        /* reduced-motion overrides */
        @media (prefers-reduced-motion: reduce) {
          .splash::before { animation: none !important; opacity: 0.4; }
          .breath-lungs-wrap, .lung-lobe-group, .lung-air-pulse, .alveoli-nodes, .bronchial-tree {
            animation: none !important;
            transition: none !important;
          }
          .vent-study { animation: none; }
          .vent-study::before { animation: none; opacity: 0.5; }
          .study-sheet.burning .vent-word { animation-duration: 1ms; animation-iteration-count: 1; }
          .study-sheet.burning::after { animation: none; opacity: 0; }
          .vent-character.punching, .vent-character.kicking,
          .vent-character.punching .char-punch-arm, .vent-character.kicking .char-kick-leg,
          .vent-bag.hit, .vent-bag.kick, .vent-bag-wrap.swinging,
          .vent-bag-wrap.kick-swing, .vent-bag-wrap.burst,
          .impact-particle, .impact-spark, .burst-flash, .burst-fragment { animation-duration: 1ms; animation-iteration-count: 1; }
        }
      </style>
      <main class="screen fresh">
        <section class="panel" role="dialog" aria-modal="true" aria-labelledby="overlay-title" tabindex="-1">
          <div class="splash" aria-hidden="true"></div>
        </section>
      </main>
    `;
    page.appendChild(host);

    // The cover is mounted before the hidden page is made visible.
    page.removeAttribute("data-focus-friend-revealed");
    page.style.setProperty("visibility", "visible", "important");

    setPageInert(true);
    applyOverlayLanguage();
    watchViewFocus();
    shadow.addEventListener("keydown", handleOverlayKeydown);
    if (!focusInListenerAttached) {
      document.addEventListener("focusin", handleFocusIn, true);
      focusInListenerAttached = true;
    }
    return true;
  }

  function makePanel(title, message = "") {
    const panel = shadow.querySelector(".panel");
    panel.classList.remove("greeting-panel");
    panel.replaceChildren();
    panel.setAttribute("aria-labelledby", "overlay-title");
    panel.tabIndex = -1;

    const heading = document.createElement("h1");
    heading.id = "overlay-title";
    heading.textContent = title;
    panel.append(heading);

    if (message) {
      const paragraph = document.createElement("p");
      paragraph.textContent = message;
      panel.append(paragraph);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    panel.append(actions);
    return { panel, actions };
  }

  function addButton(actions, label, style, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = style;
    button.textContent = label;
    button.addEventListener("click", onClick);
    actions.append(button);
    return button;
  }

  /* ── Anti-Repetition Voice Picker (§6.2) ──────────────────────────
     Maintains chrome.storage.local key voice_history: { [slot]: [...] }
     Excludes the last 3 used IDs (or last 1 if bank size <= 4).
     Guarantees fresh, non-repetitive lines across visits. */
  async function pickVoiceLineWithIndex(slot, pool, cachedIndex = null) {
    if (!Array.isArray(pool) || pool.length === 0) {
      if (typeof pool === "string") return { text: pool, index: null };
      return { text: "", index: null };
    }
    if (pool.length === 1) {
      const item = pool[0];
      return { text: typeof item === "string" ? item : item.text, index: 0 };
    }

    if (typeof cachedIndex === "number" && cachedIndex >= 0 && cachedIndex < pool.length) {
      const item = pool[cachedIndex];
      return { text: typeof item === "string" ? item : item.text, index: cachedIndex };
    }

    try {
      const { voice_history: savedHistory } = await chrome.storage.local.get("voice_history");
      const history = (savedHistory && typeof savedHistory === "object") ? savedHistory : {};
      const slotHistory = Array.isArray(history[slot]) ? history[slot] : [];

      const excludeCount = pool.length <= 4 ? 1 : 3;
      const recentExcluded = slotHistory.slice(-excludeCount);

      const eligibleIndices = [];
      for (let i = 0; i < pool.length; i += 1) {
        if (!recentExcluded.includes(i)) {
          eligibleIndices.push(i);
        }
      }

      const candidateIndices = eligibleIndices.length > 0
        ? eligibleIndices
        : Array.from({ length: pool.length }, (_, i) => i);

      const chosenIndex = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];

      const updatedSlotHistory = [...slotHistory.filter((idx) => idx !== chosenIndex), chosenIndex].slice(-3);
      history[slot] = updatedSlotHistory;

      void chrome.storage.local.set({ voice_history: history }).catch(() => {});

      const chosen = pool[chosenIndex];
      return { text: typeof chosen === "string" ? chosen : chosen.text, index: chosenIndex };
    } catch (_) {
      const chosenIndex = Math.floor(Math.random() * pool.length);
      const chosen = pool[chosenIndex];
      return { text: typeof chosen === "string" ? chosen : chosen.text, index: chosenIndex };
    }
  }

  async function showGreeting(isLanguageSwitch = false) {
    view = "greeting";
    setFreshTheme(true);

    const greetingPool = copy.greeting || (Array.isArray(copy.interception?.greeting) ? copy.interception.greeting : [copy.interception?.greeting]);
    const { text: greetingText, index: gIdx } = await pickVoiceLineWithIndex(
      "greeting",
      greetingPool,
      isLanguageSwitch ? selectedGreetingIndex : null
    );
    selectedGreetingIndex = gIdx;

    const ventOfferPool = copy.vent_offer_link || (Array.isArray(copy.interception?.ventOfferLink) ? copy.interception.ventOfferLink : [copy.interception?.ventOfferLink]);
    const { text: ventOfferText, index: vIdx } = await pickVoiceLineWithIndex(
      "vent_offer_link",
      ventOfferPool,
      isLanguageSwitch ? selectedVentOfferIndex : null
    );
    selectedVentOfferIndex = vIdx;

    const { panel, actions } = makePanel(greetingText);
    panel.classList.add("greeting-panel");
    actions.classList.add("greeting-actions");
    addButton(actions, copy.interception.letsGo, "primary", beginBreathingPrep);
    addButton(actions, copy.interception.notNow, "secondary", handleNotNow);

    const ventLink = document.createElement("button");
    ventLink.type = "button";
    ventLink.className = "vent-offer-button";
    ventLink.textContent = ventOfferText;
    ventLink.addEventListener("click", showVentChoice);
    panel.append(ventLink);
  }

  async function showNotNowResponse() {
    view = "notNow";
    setFreshTheme(true);
    const notNowPool = copy.not_now || (Array.isArray(copy.interception?.notNowResponse) ? copy.interception.notNowResponse : [copy.interception?.notNowResponse]);
    const { text: notNowText } = await pickVoiceLineWithIndex("not_now", notNowPool);
    makePanel(notNowText);
  }

  function showContinueCheckin() {
    view = "continueCheckin";
    setFreshTheme(true);
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    const screen = shadow?.querySelector(".screen");
    if (screen) screen.classList.remove("toast-mode");

    const title = copy?.interception?.continueCheckin || "";
    const hint = copy?.interception?.continueCheckinHint || "";
    const { panel, actions } = makePanel(title, hint);
    panel.classList.remove("toast-panel");

    addButton(actions, copy.interception.keepPause, "secondary", async () => {
      await resetNotNowChoice(activeDomain);
      await rememberSiteHit();
      makePanel(copy.interception.keepPauseResponse || "");
      transitionTimer = setTimeout(revealPage, 1100);
    });

    addButton(actions, copy.interception.disableSitePause, "primary", async () => {
      await disablePauseForActiveSite();
    });
  }

  async function showFactReveal() {
    view = "factReveal";
    setFreshTheme(true);

    const numberFactEntry = copy.number_facts ? copy.number_facts[String(cycleCount)] : null;
    const isSwerve = !numberFactEntry;
    let selectedFactText = "";
    let factSource = "number";
    let factIndex = 0;

    if (numberFactEntry) {
      if (Array.isArray(numberFactEntry)) {
        factIndex = Math.floor(Math.random() * numberFactEntry.length);
        const item = numberFactEntry[factIndex];
        selectedFactText = typeof item === "string" ? item : item.text;
      } else {
        selectedFactText = typeof numberFactEntry === "string" ? numberFactEntry : numberFactEntry.text;
      }
    } else if (copy.general_facts && copy.general_facts.length) {
      factSource = "general";
      factIndex = Math.floor(Math.random() * copy.general_facts.length);
      const item = copy.general_facts[factIndex];
      selectedFactText = typeof item === "string" ? item : item.text;
    }

    const factIntroPool = isSwerve ? copy.swerve_intro : copy.fact_intro;
    let replySlot = "default";
    try {
      const { last_cycle_count: lastCycleCount } = await chrome.storage.local.get("last_cycle_count");
      if (lastCycleCount === cycleCount && copy.cycle_reply && copy.cycle_reply.same_as_last && copy.cycle_reply.same_as_last.length) {
        replySlot = "same_as_last";
      }
      await chrome.storage.local.set({ last_cycle_count: cycleCount });
    } catch (error) {
      console.error("Focus Friend could not save the last cycle count:", error);
    }

    const introSlotKey = isSwerve ? "swerve_intro" : "fact_intro";
    const { index: introIndex } = await pickVoiceLineWithIndex(introSlotKey, factIntroPool);

    const replySlotKey = replySlot === "same_as_last" ? "cycle_reply_same_as_last" : "cycle_reply_default";
    const replyPool = (copy.cycle_reply && copy.cycle_reply[replySlot]) || [];
    const { index: replyIndex } = await pickVoiceLineWithIndex(replySlotKey, replyPool);

    factSelection = {
      factText: selectedFactText,
      factSource,
      factIndex,
      isSwerve,
      introIndex,
      replySlot,
      replyIndex
    };
    renderFactReveal();
  }

  // Re-read the fact from the current language bank so a mid-screen language
  // switch does not leave one language's sentence on the other language's page.
  function resolveFactText(selection) {
    if (!selection) return "";
    try {
      if (selection.factSource === "general") {
        const item = copy.general_facts?.[selection.factIndex];
        if (item) return typeof item === "string" ? item : item.text;
      } else {
        const entry = copy.number_facts?.[String(cycleCount)];
        if (entry) {
          const item = Array.isArray(entry) ? entry[selection.factIndex] : entry;
          if (item) return typeof item === "string" ? item : item.text;
        }
      }
    } catch (_) {
      // Fall back to the sentence captured when the screen was opened.
    }
    return selection.factText;
  }

  function renderFactReveal() {
    if (!factSelection) return;
    view = "factReveal";
    setFreshTheme(true);

    const fact = resolveFactText(factSelection);
    const introPool = factSelection.isSwerve ? copy.swerve_intro : copy.fact_intro;
    const introTemplate = (introPool && introPool[factSelection.introIndex]) || introPool[0] || "";
    const intro = introTemplate.replaceAll("{n}", String(cycleCount));

    const replyPool = (copy.cycle_reply && copy.cycle_reply[factSelection.replySlot]) || [];
    const replyTemplate = (replyPool && replyPool[factSelection.replyIndex]) || replyPool[0] || "";
    const reply = replyTemplate.replaceAll("{n}", String(cycleCount));

    const { panel, actions } = makePanel(String(cycleCount), reply);

    const introLine = document.createElement("p");
    introLine.className = "fact-intro";
    introLine.textContent = intro;
    panel.insertBefore(introLine, actions);

    const factLine = document.createElement("p");
    factLine.className = "fact-text";
    factLine.textContent = fact;
    panel.insertBefore(factLine, actions);

    addButton(actions, copy.interception.backToWork, "primary", () => void showGoodbye());
  }

  async function showGoodbye(isLanguageSwitch = false) {
    view = "goodbye";
    setFreshTheme(true);
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }

    const goodbyePool = copy.goodbye || [copy.interception?.returning || ""];
    const { text: line, index } = await pickVoiceLineWithIndex(
      "goodbye",
      goodbyePool,
      isLanguageSwitch ? selectedGoodbyeIndex : null
    );
    selectedGoodbyeIndex = index;

    const { panel, actions } = makePanel(line);
    panel.classList.add("greeting-panel");
    actions.classList.add("greeting-actions");
    addButton(actions, copy.interception.backToWork, "primary", beginReturn);
  }

  function showVentChoice() {
    clearVentIdleTimer();
    view = "ventChoice";
    setFreshTheme(true);
    enterVentEntry();

    const panel = shadow.querySelector(".panel");
    panel.classList.remove("greeting-panel");
    panel.replaceChildren();

    const study = document.createElement("div");
    study.className = "vent-study vent-choice";
    study.lang = studyLang();

    const head = document.createElement("header");
    head.className = "study-head";
    const eyebrow = document.createElement("span");
    eyebrow.className = "study-eyebrow";
    eyebrow.textContent = copy.vent.eyebrow;
    const index = document.createElement("span");
    index.className = "study-index";
    index.setAttribute("aria-hidden", "true");
    index.textContent = "01";
    head.append(eyebrow, index);

    const title = document.createElement("h1");
    title.id = "overlay-title";
    title.className = "study-title";
    title.textContent = copy.vent.promptTitle;

    const note = document.createElement("p");
    note.className = "study-note";
    note.textContent = copy.vent.choiceNote;

    const choices = document.createElement("div");
    choices.className = "study-choices";
    choices.append(
      makeStudyChoice("01", copy.vent.writeDoor, copy.vent.writeDoorHint, startVentWrite),
      makeStudyChoice("02", copy.vent.punchDoor, copy.vent.punchDoorHint, requestVentRound)
    );

    const back = document.createElement("button");
    back.type = "button";
    back.className = "study-link";
    back.textContent = copy.vent.studyBackToWork;
    back.addEventListener("click", () => {
      ventDraft = "";
      void showGoodbye();
    });

    study.append(head, title, note, choices, back);
    panel.append(study);
  }

  function makeStudyChoice(number, title, hint, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "study-choice";

    const num = document.createElement("span");
    num.className = "study-choice-num";
    num.setAttribute("aria-hidden", "true");
    num.textContent = number;

    const body = document.createElement("span");
    body.className = "study-choice-body";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("span");
    small.className = "study-choice-hint";
    small.textContent = hint;
    body.append(strong, small);

    const arrow = document.createElement("span");
    arrow.className = "study-choice-arrow";
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");

    button.append(num, body, arrow);
    button.addEventListener("click", onClick);
    return button;
  }

  function startVentWrite() {
    showVentWrite();
  }

  function updateVentWords(mirror, text) {
    mirror.replaceChildren();
    if (!text) return 0;

    const tokens = text.split(/(\s+)/);
    let wordCount = 0;

    for (const token of tokens) {
      if (!token) continue;

      if (/^\s+$/.test(token)) {
        mirror.appendChild(document.createTextNode(token));
      } else {
        wordCount += 1;
        const span = document.createElement("span");
        span.className = "vent-word";
        span.textContent = token;
        mirror.appendChild(span);
      }
    }

    return wordCount;
  }

  function updateStudyUI(progressFill, countEl, burnButton, wordCount) {
    const safeWordCount = Number.isFinite(wordCount) ? Math.max(0, wordCount) : 0;
    const pct = Math.min(safeWordCount / STUDY_FULL_WORDS, 1);
    if (progressFill) progressFill.style.width = `${Math.round(pct * 100)}%`;
    if (countEl) {
      const unit = safeWordCount === 1
        ? (copy.vent.wordUnitOne || copy.vent.wordUnit)
        : copy.vent.wordUnit;
      countEl.textContent = safeWordCount > 0
        ? `${formatStudyNumber(safeWordCount)} ${unit}`
        : "";
    }
    if (burnButton) burnButton.disabled = safeWordCount === 0;
  }

  function studyLang() {
    return settings?.language === "bn" ? "bn" : "en";
  }

  function formatStudyNumber(value) {
    const locale = studyLang() === "bn" ? "bn-BD" : "en-US";
    try {
      return new Intl.NumberFormat(locale, { useGrouping: false }).format(value);
    } catch (_) {
      return String(value);
    }
  }

  function showVentWrite() {
    clearVentIdleTimer();
    view = "ventWrite";
    setFreshTheme(true);
    enterVentRoom();

    const panel = shadow.querySelector(".panel");
    panel.classList.remove("greeting-panel");
    panel.replaceChildren();

    const study = document.createElement("div");
    study.className = "vent-study vent-write";
    study.lang = studyLang();

    const head = document.createElement("header");
    head.className = "study-head";
    const eyebrow = document.createElement("span");
    eyebrow.className = "study-eyebrow";
    eyebrow.textContent = copy.vent.eyebrow;
    const index = document.createElement("span");
    index.className = "study-index";
    index.setAttribute("aria-hidden", "true");
    index.textContent = "02";
    head.append(eyebrow, index);

    const title = document.createElement("h1");
    title.id = "overlay-title";
    title.className = "study-title";
    title.append(document.createTextNode(copy.vent.writeTitle));
    title.append(document.createElement("br"));
    const accent = document.createElement("em");
    accent.textContent = copy.vent.writeTitleAccent;
    title.append(accent);

    const note = document.createElement("p");
    note.className = "study-note";
    note.id = "vent-write-note";
    note.textContent = copy.vent.writeHint;

    const sheet = document.createElement("div");
    sheet.className = "study-sheet";

    const mirror = document.createElement("div");
    mirror.className = "vent-words";
    mirror.setAttribute("aria-hidden", "true");

    const textarea = document.createElement("textarea");
    textarea.className = "vent-textarea";
    textarea.placeholder = copy.vent.writePlaceholder;
    textarea.value = ventDraft;
    textarea.spellcheck = false;
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("aria-label", copy.vent.writePlaceholder);
    textarea.setAttribute("aria-describedby", note.id);

    const initialWords = updateVentWords(mirror, ventDraft);

    const progress = document.createElement("div");
    progress.className = "study-progress";
    progress.setAttribute("aria-hidden", "true");
    const progressFill = document.createElement("span");
    progressFill.className = "study-progress-fill";
    progress.append(progressFill);

    const foot = document.createElement("footer");
    foot.className = "study-foot";
    const countEl = document.createElement("span");
    countEl.className = "study-count";
    const burnButton = document.createElement("button");
    burnButton.type = "button";
    burnButton.className = "study-burn";
    burnButton.textContent = copy.vent.burnButton;
    const arrow = document.createElement("span");
    arrow.className = "study-burn-arrow";
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");
    burnButton.append(arrow);
    foot.append(countEl, burnButton);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "study-link study-back";
    back.textContent = copy.vent.back;
    back.addEventListener("click", () => showVentChoice());

    sheet.append(mirror, textarea);
    study.append(head, title, note, sheet, progress, foot, back);
    panel.append(study);

    updateStudyUI(progressFill, countEl, burnButton, initialWords);

    textarea.addEventListener("input", () => {
      ventDraft = textarea.value;
      const words = updateVentWords(mirror, ventDraft);
      updateStudyUI(progressFill, countEl, burnButton, words);
      mirror.scrollTop = textarea.scrollTop;
      armVentIdleCheck(showVentWrite);
    });

    textarea.addEventListener("scroll", () => {
      mirror.scrollTop = textarea.scrollTop;
    });

    burnButton.addEventListener("click", () => burnVentDraft(sheet, textarea, mirror, burnButton, back));

    textarea.focus({ preventScroll: true });
    const caretEnd = textarea.value.length;
    textarea.setSelectionRange(caretEnd, caretEnd);
    textarea.scrollTop = textarea.scrollHeight;
    mirror.scrollTop = textarea.scrollTop;
    armVentIdleCheck(showVentWrite);
  }

  function burnVentDraft(sheet, textarea, mirror, burnButton, backButton) {
    if (view !== "ventWrite") return;
    if (!textarea.value.trim()) {
      textarea.focus({ preventScroll: true });
      return;
    }

    clearVentIdleTimer();
    view = "ventBurning";

    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (burnButton) burnButton.disabled = true;
    if (backButton) backButton.disabled = true;
    textarea.readOnly = true;
    sheet.classList.add("burning");
    playBurnSound();

    const words = mirror.querySelectorAll(".vent-word");
    words.forEach((word, index) => {
      word.style.setProperty("--w-delay", `${Math.min(index * 14, 300)}ms`);
    });

    transitionTimer = setTimeout(() => {
      if (view !== "ventBurning") return;
      textarea.value = "";
      ventDraft = "";
      mirror.replaceChildren();
      showVentBurned();
    }, reduceMotion ? 300 : 1100);
  }

  function showVentBurned() {
    clearVentIdleTimer();
    view = "ventBurned";
    setFreshTheme(true);
    enterVentRoom();

    const panel = shadow.querySelector(".panel");
    panel.classList.remove("greeting-panel");
    panel.replaceChildren();

    const study = document.createElement("div");
    study.className = "vent-study vent-burned-room";
    study.lang = studyLang();

    const title = document.createElement("h1");
    title.id = "overlay-title";
    title.className = "study-title";
    title.textContent = copy.vent.burnedMessage;

    const note = document.createElement("p");
    note.className = "study-note";
    note.textContent = copy.vent.burnedNote;

    const back = document.createElement("button");
    back.type = "button";
    back.className = "study-link";
    back.textContent = copy.vent.studyBackToWork;
    back.addEventListener("click", () => void beginReturn());

    study.append(title, note, back);
    panel.append(study);
  }

  async function readVentRoundsToday() {
    const today = localDayKey();
    const { vent_rounds_today: saved } = await chrome.storage.local.get("vent_rounds_today");
    if (saved?.day === today) {
      return {
        day: today,
        rounds: Number.isInteger(saved.rounds) ? saved.rounds : 0,
        fiveRoundWarningShown: Boolean(saved.fiveRoundWarningShown)
      };
    }

    const fresh = { day: today, rounds: 0, fiveRoundWarningShown: false };
    await chrome.storage.local.set({ vent_rounds_today: fresh });
    return fresh;
  }

  async function requestVentRound() {
    let progress;
    try {
      progress = await readVentRoundsToday();
    } catch (error) {
      console.error("Focus Friend could not read today's vent rounds:", error);
      startVentPunch();
      return;
    }

    if (progress.rounds >= VENT_ROUNDS_PER_DAY) {
      showVentDailyLimit();
      return;
    }
    if (progress.rounds > 10) {
      showVentRoundWarning("many");
      return;
    }
    if (progress.rounds > 5 && !progress.fiveRoundWarningShown) {
      progress.fiveRoundWarningShown = true;
      try {
        await chrome.storage.local.set({ vent_rounds_today: progress });
      } catch (error) {
        console.error("Focus Friend could not save the vent warning state:", error);
      }
      showVentRoundWarning("five");
      return;
    }

    startVentPunch();
  }

  function showVentRoundDone() {
    view = "ventRoundDone";
    setFreshTheme(true);
    const { actions } = makePanel(copy.vent.roundDone);
    addButton(actions, copy.vent.tryAgain, "primary", requestVentRound);
    addButton(actions, copy.vent.stopNow, "secondary", showVentAfterExit);
  }

  function showVentRoundWarning(kind) {
    view = "ventRoundWarning";
    ventWarningKind = kind;
    setFreshTheme(true);
    const message = kind === "five"
      ? copy.vent.fiveRoundWarning
      : copy.vent.manyRoundWarning;
    const { actions } = makePanel(message);
    addButton(actions, copy.vent.continueRound, "primary", startVentPunch);
    addButton(actions, copy.vent.stopNow, "secondary", showVentAfterExit);
  }

  function showVentDailyLimit() {
    view = "ventDailyLimit";
    setFreshTheme(true);
    const { actions } = makePanel(copy.vent.dailyLimit);
    addButton(actions, copy.vent.dailyLimitBack, "primary", () => void showGoodbye());
  }

  async function completeVentRound() {
    try {
      const progress = await readVentRoundsToday();
      progress.rounds = Math.min(VENT_ROUNDS_PER_DAY, progress.rounds + 1);
      await chrome.storage.local.set({ vent_rounds_today: progress });
      if (progress.rounds >= VENT_ROUNDS_PER_DAY) {
        showVentDailyLimit();
      } else {
        showVentRoundDone();
      }
    } catch (error) {
      console.error("Focus Friend could not save today's vent round:", error);
      showVentRoundDone();
    }
  }

  function startVentPunch() {
    ventHits = 0;
    showVentPunch();
  }

  function showVentPunch() {
    if (ventTapTimer) {
      clearTimeout(ventTapTimer);
      ventTapTimer = null;
    }
    view = "ventPunch";
    setFreshTheme(true);
    const { panel, actions } = makePanel(copy.vent.punchTitle, copy.vent.punchHint);

    const scene = document.createElement("div");
    scene.className = "vent-scene";
    scene.innerHTML = `
      <!-- Realistic Boxer SVG -->
      <svg class="vent-character" viewBox="0 0 160 268" aria-hidden="true">
        <defs>
          <radialGradient id="skin-grad" cx="42%" cy="35%" r="58%">
            <stop offset="0%" stop-color="#f5c99a"/>
            <stop offset="100%" stop-color="#c88050"/>
          </radialGradient>
          <linearGradient id="shorts-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#2a6245"/>
            <stop offset="50%" stop-color="#3a7a58"/>
            <stop offset="100%" stop-color="#1f4f36"/>
          </linearGradient>
          <linearGradient id="glove-r-grad" x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stop-color="#c8303e"/>
            <stop offset="40%" stop-color="#e04050"/>
            <stop offset="100%" stop-color="#8a1520"/>
          </linearGradient>
          <linearGradient id="glove-l-grad" x1="90%" y1="0%" x2="10%" y2="100%">
            <stop offset="0%" stop-color="#b82838"/>
            <stop offset="40%" stop-color="#d03848"/>
            <stop offset="100%" stop-color="#7a1218"/>
          </linearGradient>
          <linearGradient id="shoe-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#2a2a3a"/>
            <stop offset="100%" stop-color="#12121e"/>
          </linearGradient>
          <filter id="char-shadow" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="2" dy="4" stdDeviation="4" flood-color="#284b39" flood-opacity="0.18"/>
          </filter>
        </defs>

        <!-- Floor shadow -->
        <ellipse cx="80" cy="260" rx="44" ry="6" fill="rgb(35 60 45 / 14%)"/>

        <!-- BACK LEG (left in view) -->
        <g>
          <!-- back thigh -->
          <path d="M62 158 Q52 185 50 210" fill="none" stroke="#3a7a58" stroke-width="20" stroke-linecap="round"/>
          <!-- back shin -->
          <path d="M50 210 Q46 230 46 248" fill="none" stroke="#2a6245" stroke-width="17" stroke-linecap="round"/>
          <!-- back shoe -->
          <path d="M38 246 Q44 250 58 251 L58 258 L36 258 Z" fill="url(#shoe-grad)" rx="4"/>
          <path d="M38 246 Q44 250 58 251" fill="none" stroke="#48486a" stroke-width="2.5" stroke-linecap="round"/>
        </g>

        <!-- TORSO -->
        <g class="char-torso" filter="url(#char-shadow)">
          <!-- tank top -->
          <path d="M52 100 Q48 120 45 158 L99 158 Q96 120 92 100 Q72 88 52 100Z"
                fill="url(#shorts-grad)" stroke="#1f4f36" stroke-width="2"/>
          <!-- collar/neck shading -->
          <path d="M62 100 Q72 95 83 100" fill="none" stroke="#2a6245" stroke-width="3" stroke-linecap="round"/>
          <!-- body highlight -->
          <path d="M60 108 Q65 130 62 155" fill="none" stroke="rgb(255 255 255 / 14%)" stroke-width="6" stroke-linecap="round"/>
        </g>

        <!-- FRONT LEG (right, kick leg) -->
        <g class="char-kick-leg" filter="url(#char-shadow)">
          <!-- front thigh -->
          <path d="M82 158 Q90 184 94 210" fill="none" stroke="#3a7a58" stroke-width="22" stroke-linecap="round"/>
          <!-- front shin -->
          <path d="M94 210 Q98 232 100 248" fill="none" stroke="#2a6245" stroke-width="19" stroke-linecap="round"/>
          <!-- front shoe -->
          <path d="M90 247 Q98 251 115 252 L116 259 L88 259 Z" fill="url(#shoe-grad)"/>
          <path d="M90 247 Q98 251 115 252" fill="none" stroke="#48486a" stroke-width="2.5" stroke-linecap="round"/>
          <!-- shin highlight -->
          <path d="M97 215 Q99 232 101 248" fill="none" stroke="rgb(255 255 255 / 10%)" stroke-width="5" stroke-linecap="round"/>
        </g>

        <!-- SHORTS waistband -->
        <rect x="44" y="153" width="56" height="10" rx="5" fill="#1f4f36" stroke="#143826" stroke-width="1.5"/>
        <line x1="72" y1="153" x2="72" y2="163" stroke="#143826" stroke-width="1.5"/>

        <!-- BACK ARM (left, guard arm) -->
        <g class="char-punch-arm2" filter="url(#char-shadow)">
          <!-- upper arm -->
          <path d="M54 104 Q38 118 32 136" fill="none" stroke="url(#skin-grad)" stroke-width="16" stroke-linecap="round"/>
          <!-- forearm -->
          <path d="M32 136 Q26 150 22 162" fill="none" stroke="#c88050" stroke-width="13" stroke-linecap="round"/>
          <!-- guard glove -->
          <ellipse cx="20" cy="168" rx="16" ry="12" fill="url(#glove-l-grad)" stroke="#6a0e18" stroke-width="1.5"/>
          <ellipse cx="17" cy="165" rx="8" ry="6" fill="rgb(255 255 255 / 20%)"/>
          <path d="M12 170 Q20 174 28 171" fill="none" stroke="#6a0e18" stroke-width="1.5" stroke-linecap="round"/>
        </g>

        <!-- FRONT/JAB ARM (right arm) -->
        <g class="char-punch-arm" filter="url(#char-shadow)">
          <!-- upper arm -->
          <path d="M90 103 Q105 110 118 118" fill="none" stroke="url(#skin-grad)" stroke-width="17" stroke-linecap="round"/>
          <!-- forearm -->
          <path d="M118 118 Q130 124 138 128" fill="none" stroke="#c88050" stroke-width="14" stroke-linecap="round"/>
          <!-- jab glove — larger, faces bag -->
          <ellipse cx="144" cy="128" rx="17" ry="13" fill="url(#glove-r-grad)" stroke="#6a0e18" stroke-width="1.5"/>
          <ellipse cx="140" cy="124" rx="9" ry="7" fill="rgb(255 255 255 / 22%)"/>
          <path d="M137 130 Q144 133 151 131" fill="none" stroke="#6a0e18" stroke-width="1.5" stroke-linecap="round"/>
          <!-- glove thumb detail -->
          <ellipse cx="152" cy="122" rx="6" ry="4" fill="#c03040" stroke="#6a0e18" stroke-width="1"/>
        </g>

        <!-- NECK -->
        <rect x="67" y="76" width="18" height="26" rx="8" fill="url(#skin-grad)"/>

        <!-- HEAD -->
        <g filter="url(#char-shadow)">
          <!-- head shape -->
          <ellipse cx="76" cy="55" rx="27" ry="30" fill="url(#skin-grad)" stroke="#b87050" stroke-width="1.5"/>
          <!-- ear -->
          <ellipse cx="102" cy="56" rx="6" ry="8" fill="#d8956a" stroke="#b87050" stroke-width="1"/>
          <!-- ear shadow -->
          <ellipse cx="103" cy="56" rx="3" ry="5" fill="#b87050"/>
          <!-- hair -->
          <path d="M50 44 Q52 20 76 18 Q100 18 102 42 Q90 32 76 30 Q60 30 50 44Z" fill="#28201a"/>
          <!-- eyebrow R -->
          <path d="M62 40 Q70 36 79 39" fill="none" stroke="#28201a" stroke-width="3" stroke-linecap="round"/>
          <!-- eyebrow L -->
          <path d="M82 39 Q90 36 97 39" fill="none" stroke="#28201a" stroke-width="2.5" stroke-linecap="round"/>
          <!-- eye sockets -->
          <ellipse cx="70" cy="47" rx="6" ry="5" fill="rgb(0 0 0 / 8%)"/>
          <ellipse cx="88" cy="46" rx="5" ry="4.5" fill="rgb(0 0 0 / 8%)"/>
          <!-- eyes -->
          <circle cx="70" cy="47" r="3.5" fill="#2a2018"/>
          <circle cx="88" cy="46" r="3" fill="#2a2018"/>
          <circle cx="71.5" cy="46" r="1.2" fill="rgb(255 255 255 / 55%)"/>
          <circle cx="89" cy="45" r="1" fill="rgb(255 255 255 / 55%)"/>
          <!-- nose -->
          <path d="M75 52 Q72 60 68 63 Q74 65 80 63" fill="none" stroke="#b87050" stroke-width="2.2" stroke-linecap="round"/>
          <!-- mouth - focused grimace -->
          <path d="M66 70 Q76 68 87 70" fill="none" stroke="#8a4530" stroke-width="2.5" stroke-linecap="round"/>
          <!-- chin shadow -->
          <ellipse cx="76" cy="82" rx="12" ry="4" fill="rgb(0 0 0 / 10%)"/>
          <!-- boxing headgear hint -->
          <path d="M49 44 Q48 52 50 62 Q52 68 55 72" fill="none" stroke="#1f4f36" stroke-width="4" stroke-linecap="round" opacity="0.7"/>
          <path d="M103 42 Q105 50 103 62 Q101 68 98 72" fill="none" stroke="#1f4f36" stroke-width="4" stroke-linecap="round" opacity="0.7"/>
          <path d="M49 44 Q76 32 103 42" fill="none" stroke="#1f4f36" stroke-width="5" stroke-linecap="round" opacity="0.7"/>
        </g>
      </svg>

      <!-- Heavy Bag (SVG for realism) -->
      <div class="vent-bag-wrap">
        <div class="bag-mount" aria-hidden="true">
          <div class="bag-hook"></div>
          <div class="bag-chain">
            <div class="bag-link"></div><div class="bag-link"></div>
            <div class="bag-link"></div><div class="bag-link"></div>
            <div class="bag-link"></div>
          </div>
          <div class="bag-swivel"></div>
        </div>
        <button class="vent-bag" type="button" aria-label="${copy.vent.punchDoor}">
          <svg viewBox="0 0 108 192" width="108" height="192" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" overflow="visible">
            <defs>
              <linearGradient id="bag-body-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#5a0a14"/>
                <stop offset="14%"  stop-color="#8a1222"/>
                <stop offset="38%"  stop-color="#d93040"/>
                <stop offset="55%"  stop-color="#e84055"/>
                <stop offset="78%"  stop-color="#b01c30"/>
                <stop offset="100%" stop-color="#5a0a14"/>
              </linearGradient>
              <linearGradient id="bag-band-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#3a0510"/>
                <stop offset="30%"  stop-color="#6a0e1e"/>
                <stop offset="55%"  stop-color="#8a1830"/>
                <stop offset="100%" stop-color="#3a0510"/>
              </linearGradient>
              <linearGradient id="bag-top-grad" x1="30%" y1="0%" x2="70%" y2="100%">
                <stop offset="0%"   stop-color="#c02838"/>
                <stop offset="100%" stop-color="#6a0a18"/>
              </linearGradient>
              <radialGradient id="bag-sheen" cx="28%" cy="28%" r="55%">
                <stop offset="0%"   stop-color="rgb(255 255 255 / 32%)"/>
                <stop offset="50%"  stop-color="rgb(255 255 255 / 8%)"/>
                <stop offset="100%" stop-color="rgb(0 0 0 / 0%)"/>
              </radialGradient>
              <radialGradient id="bag-bottom-shad" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stop-color="rgb(0 0 0 / 0%)"/>
                <stop offset="100%" stop-color="rgb(0 0 0 / 30%)"/>
              </radialGradient>
              <filter id="bag-shadow" x="-20%" y="-5%" width="140%" height="120%">
                <feDropShadow dx="4" dy="10" stdDeviation="8" flood-color="#1a0408" flood-opacity="0.35"/>
              </filter>
              <clipPath id="bag-clip">
                <path d="M12 20 Q10 8 54 6 Q98 8 96 20 L100 165 Q100 186 54 188 Q8 186 8 165 Z"/>
              </clipPath>
            </defs>

            <!-- bag shadow on floor -->
            <ellipse cx="54" cy="195" rx="40" ry="6" fill="rgb(20 5 10 / 22%)"/>

            <!-- Main bag body -->
            <g filter="url(#bag-shadow)">
              <path d="M12 20 Q10 8 54 6 Q98 8 96 20 L100 165 Q100 186 54 188 Q8 186 8 165 Z"
                    fill="url(#bag-body-grad)" stroke="#400810" stroke-width="1.5"/>

              <!-- Leather texture lines (vertical panels) -->
              <g clip-path="url(#bag-clip)" stroke="rgb(0 0 0 / 20%)" stroke-width="1" fill="none">
                <path d="M28 6 Q26 96 28 188"/>
                <path d="M54 6 Q54 97 54 188"/>
                <path d="M80 6 Q82 96 80 188"/>
              </g>

              <!-- Stitching along seams -->
              <g clip-path="url(#bag-clip)">
                <line x1="28" y1="12" x2="28" y2="184" stroke="rgb(0 0 0 / 28%)" stroke-width="1" stroke-dasharray="4 5"/>
                <line x1="54" y1="6"  x2="54" y2="188" stroke="rgb(0 0 0 / 22%)" stroke-width="1" stroke-dasharray="4 5"/>
                <line x1="80" y1="12" x2="80" y2="184" stroke="rgb(0 0 0 / 28%)" stroke-width="1" stroke-dasharray="4 5"/>
              </g>

              <!-- Top band -->
              <path d="M12 32 Q10 32 10 32 L98 32 Q98 32 98 32 L100 44 Q54 50 8 44 Z"
                    fill="url(#bag-band-grad)" opacity="0.9"/>
              <line x1="10" y1="32" x2="98" y2="32" stroke="rgb(255 255 255 / 15%)" stroke-width="1"/>
              <line x1="8"  y1="44" x2="100" y2="44" stroke="rgb(0 0 0 / 25%)" stroke-width="1"/>

              <!-- Bottom band -->
              <path d="M8 148 Q8 148 8 148 L100 148 L100 160 Q54 166 8 160 Z"
                    fill="url(#bag-band-grad)" opacity="0.9"/>
              <line x1="8"  y1="148" x2="100" y2="148" stroke="rgb(255 255 255 / 12%)" stroke-width="1"/>
              <line x1="8"  y1="160" x2="100" y2="160" stroke="rgb(0 0 0 / 25%)" stroke-width="1"/>

              <!-- Specular highlight (leather gloss) -->
              <path d="M22 20 Q24 90 22 168" fill="none" stroke="rgb(255 255 255 / 20%)" stroke-width="10" stroke-linecap="round" filter="blur(3px)"/>
              <path d="M18 30 Q20 100 18 162" fill="none" stroke="rgb(255 255 255 / 10%)" stroke-width="5" stroke-linecap="round"/>

              <!-- Sheen overlay -->
              <path d="M12 20 Q10 8 54 6 Q98 8 96 20 L100 165 Q100 186 54 188 Q8 186 8 165 Z"
                    fill="url(#bag-sheen)"/>

              <!-- Bottom shadow -->
              <ellipse cx="54" cy="175" rx="44" ry="10" fill="url(#bag-bottom-shad)"/>

              <!-- Top cap -->
              <path d="M12 20 Q10 8 54 6 Q98 8 96 20 L88 26 Q54 34 20 26Z"
                    fill="url(#bag-top-grad)" stroke="rgb(0 0 0 / 20%)" stroke-width="1"/>
              <ellipse cx="54" cy="12" rx="34" ry="8" fill="rgb(255 255 255 / 12%)"/>

              <!-- Bottom cap -->
              <path d="M8 165 Q8 186 54 188 Q100 186 100 165 L96 162 Q54 170 12 162Z"
                    fill="rgb(0 0 0 / 25%)"/>
            </g>
          </svg>
        </button>
      </div>
    `;
    panel.insertBefore(scene, actions);

    const bag = scene.querySelector(".vent-bag");
    const character = scene.querySelector(".vent-character");
    const bagWrap = scene.querySelector(".vent-bag-wrap");

    let pointerStart = null;
    let ignoreClickUntil = 0;
    const hit = (kind = "punch") => {
      if (view !== "ventPunch") return;
      playHitSound(kind);
      ventHits += 1;
      bag.classList.remove("hit", "kick");
      void bag.offsetWidth;
      bag.classList.add(kind === "kick" ? "kick" : "hit");
      // swing arc grows as bag takes more hits — capped to feel natural
      const swing = Math.min(32, 10 + ventHits * 0.5);
      bagWrap.style.setProperty("--swing-neg", `-${swing}deg`);
      bagWrap.style.setProperty("--swing-pos", `${swing}deg`);
      bagWrap.classList.remove("swinging", "kick-swing");
      void bagWrap.offsetWidth;
      bagWrap.classList.add(kind === "kick" ? "kick-swing" : "swinging");
      character.classList.remove("punching", "kicking");
      void character.getBoundingClientRect();
      character.classList.add(kind === "kick" ? "kicking" : "punching");
      addVentParticle(bag);
      addVentRing(bag);
      addVentSparks(bag);
      armVentIdleCheck(showVentPunch);

      if (ventHits >= VENT_HITS_TO_COMPLETE) {
        clearVentIdleTimer();
        bag.disabled = true;
        // burst: scatter particles + flash + flying fragments
        for (let index = 0; index < 12; index += 1) addVentParticle(bag, true);
        const flash = document.createElement("span");
        flash.className = "burst-flash";
        flash.setAttribute("aria-hidden", "true");
        bagWrap.append(flash);
        for (let index = 0; index < 8; index += 1) {
          const fragment = document.createElement("span");
          fragment.className = "burst-fragment";
          fragment.setAttribute("aria-hidden", "true");
          const angle = (Math.PI * 2 * index) / 8 + Math.random() * 0.6;
          const distance = 70 + Math.random() * 70;
          fragment.style.setProperty("--fx", `${Math.round(Math.cos(angle) * distance)}px`);
          fragment.style.setProperty("--fy", `${Math.round(Math.sin(angle) * distance - 40)}px`);
          fragment.style.setProperty("--frot", `${Math.round(Math.random() * 540 - 270)}deg`);
          fragment.style.setProperty("--fw", `${16 + Math.round(Math.random() * 14)}px`);
          fragment.style.setProperty("--fh", `${10 + Math.round(Math.random() * 10)}px`);
          bagWrap.append(fragment);
        }
        setTimeout(() => flash.remove(), 700);
        bagWrap.classList.add("burst");
        transitionTimer = setTimeout(() => void completeVentRound(), 720);
      }
    };

    bag.addEventListener("pointerdown", (event) => {
      pointerStart = { x: event.clientX, y: event.clientY };
      bag.setPointerCapture(event.pointerId);
    });
    bag.addEventListener("pointerup", (event) => {
      if (!pointerStart) return;
      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (distance > 40) {
        if (ventTapTimer) {
          clearTimeout(ventTapTimer);
          ventTapTimer = null;
        }
        ignoreClickUntil = performance.now() + 500;
        hit("kick");
      }
    });
    bag.addEventListener("click", () => {
      prepareAudio();
      if (performance.now() < ignoreClickUntil) {
        ignoreClickUntil = 0;
        return;
      }
      if (ventTapTimer) {
        clearTimeout(ventTapTimer);
        ventTapTimer = null;
        hit("kick");
      } else {
        ventTapTimer = setTimeout(() => {
          ventTapTimer = null;
          hit("punch");
        }, 220);
      }
    });

    armVentIdleCheck(showVentPunch);
  }

  function addVentParticle(bag, isBurst = false) {
    const particle = document.createElement("span");
    particle.className = "impact-particle";
    const burstParticles = copy.vent.burstParticles;
    particle.textContent = isBurst && burstParticles.length
      ? burstParticles[Math.floor(Math.random() * burstParticles.length)]
      : copy.vent.hitParticle;
    particle.style.setProperty("--drift", `${Math.round(Math.random() * 70 - 35)}px`);
    particle.style.setProperty("--spin", `${Math.round(Math.random() * 180 - 90)}deg`);
    if (isBurst) {
      particle.style.setProperty("--px", `${35 + Math.random() * 30}%`);
      particle.style.setProperty("--py", `${28 + Math.random() * 18}%`);
      shadow.querySelector(".panel").append(particle);
    } else {
      particle.style.setProperty("--px", `${kindImpactX()}%`);
      particle.style.setProperty("--py", `${30 + Math.random() * 22}%`);
      bag.append(particle);
    }
    setTimeout(() => particle.remove(), 600);
  }

  function kindImpactX() {
    return 38 + Math.random() * 24;
  }

  function addVentRing(bag) {
    const ring = document.createElement("span");
    ring.className = "impact-ring";
    ring.setAttribute("aria-hidden", "true");
    ring.style.setProperty("--px", `${kindImpactX()}%`);
    ring.style.setProperty("--py", `${32 + Math.random() * 20}%`);
    bag.append(ring);
    setTimeout(() => ring.remove(), 420);
  }

  function addVentSparks(bag) {
    const count = 4 + Math.floor(Math.random() * 4);
    const impactX = kindImpactX();
    const impactY = 32 + Math.random() * 20;
    for (let i = 0; i < count; i += 1) {
      const spark = document.createElement("span");
      spark.className = "impact-spark";
      spark.setAttribute("aria-hidden", "true");
      const angle = (Math.random() * Math.PI * 2);
      const speed = 18 + Math.random() * 36;
      spark.style.setProperty("--px", `${impactX}%`);
      spark.style.setProperty("--py", `${impactY}%`);
      spark.style.setProperty("--sx", `${Math.round(Math.cos(angle) * speed)}px`);
      spark.style.setProperty("--sy", `${Math.round(Math.sin(angle) * speed) - 12}px`);
      bag.append(spark);
      setTimeout(() => spark.remove(), 520);
    }
  }

  function addVentSpark(bag) {
    addVentSparks(bag);
  }

  function armVentIdleCheck(resumeView) {
    clearVentIdleTimer();
    ventIdleTimer = setTimeout(() => showVentIdleCheck(resumeView), 25_000);
  }

  function clearVentIdleTimer() {
    if (ventIdleTimer) {
      clearTimeout(ventIdleTimer);
      ventIdleTimer = null;
    }
  }

  function showVentIdleCheck(resumeView) {
    clearVentIdleTimer();
    view = "ventIdleCheck";
    ventResumeView = resumeView;
    const isStudy = resumeView === showVentWrite;
    const title = isStudy
      ? (copy.vent.studyIdleCheck || copy.vent.idleCheck)
      : copy.vent.idleCheck;
    const { actions } = makePanel(title);
    addButton(actions, copy.vent.idleYes, "primary", showVentAfterExit);
    addButton(actions, copy.vent.idleContinue, "secondary", resumeView);
  }

  function showVentAfterExit() {
    clearVentIdleTimer();
    if (ventTapTimer) {
      clearTimeout(ventTapTimer);
      ventTapTimer = null;
    }
    ventDraft = "";
    ventHits = 0;
    view = "ventAfter";
    setFreshTheme(true);
    const { actions } = makePanel(copy.vent.afterExit);
    addButton(actions, copy.vent.backToWork, "primary", () => void showGoodbye());
  }

  function createLungsElement(isPrep = false) {
    const wrap = document.createElement("div");
    wrap.className = isPrep ? "breath-lungs-wrap prep-mode" : "breath-lungs-wrap";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `
      <svg class="breath-lungs" viewBox="0 0 240 210">
        <defs>
          <linearGradient id="lung-grad-right" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stop-color="#7fc49c" />
            <stop offset="45%" stop-color="#468864" />
            <stop offset="100%" stop-color="#2d6044" />
          </linearGradient>
          <linearGradient id="lung-grad-left" x1="80%" y1="0%" x2="20%" y2="100%">
            <stop offset="0%" stop-color="#7fc49c" />
            <stop offset="45%" stop-color="#468864" />
            <stop offset="100%" stop-color="#2d6044" />
          </linearGradient>
          <linearGradient id="trachea-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#93caa8" />
            <stop offset="50%" stop-color="#d4eedc" />
            <stop offset="100%" stop-color="#93caa8" />
          </linearGradient>
          <radialGradient id="lung-highlight" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45" />
            <stop offset="60%" stop-color="#ffffff" stop-opacity="0.05" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="air-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#f0fff6" stop-opacity="0.85" />
            <stop offset="60%" stop-color="#88e2ae" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#468864" stop-opacity="0" />
          </radialGradient>
          <filter id="lung-shadow" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#284b39" flood-opacity="0.16" />
          </filter>
        </defs>

        <ellipse cx="120" cy="198" rx="65" ry="7" fill="rgb(40 75 57 / 9%)" />

        <!-- RIGHT LUNG (3 Lobes) -->
        <g class="lung-lobe-group lung-right">
          <path class="lung-body" filter="url(#lung-shadow)"
            d="M106,72 C102,52 90,32 78,32 C64,32 50,48 42,76 C33,108 30,138 34,162 C37,178 52,185 72,183 C88,181 100,172 107,156 C112,142 110,105 106,72 Z"
            fill="url(#lung-grad-right)" />
          <path d="M106,72 C102,52 90,32 78,32 C64,32 50,48 42,76 C33,108 30,138 34,162 C37,178 52,185 72,183 C88,181 100,172 107,156 C112,142 110,105 106,72 Z"
            fill="url(#lung-highlight)" />

          <path d="M40,118 Q72,125 107,120" stroke="#25523a" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.65" />
          <path d="M54,148 Q80,146 106,142" stroke="#25523a" stroke-width="1.3" stroke-linecap="round" fill="none" opacity="0.5" />

          <ellipse class="lung-air-pulse" cx="72" cy="120" rx="32" ry="46" fill="url(#air-glow)" />

          <g class="bronchial-tree" stroke="#e6f7ec" stroke-linecap="round" fill="none">
            <path d="M104,78 Q90,92 78,105" stroke-width="2.8" />
            <path d="M78,105 Q65,115 54,134" stroke-width="2.2" />
            <path d="M78,105 Q85,122 86,148" stroke-width="2" />
            <path d="M92,86 Q82,70 74,56" stroke-width="2.2" />
            <path d="M74,56 Q66,48 60,46" stroke-width="1.4" opacity="0.8" />
            <path d="M54,134 Q46,142 42,154" stroke-width="1.3" opacity="0.75" />
            <path d="M86,148 Q78,162 68,170" stroke-width="1.3" opacity="0.75" />
          </g>
          <g class="alveoli-nodes" fill="#ffffff" opacity="0.55">
            <circle cx="60" cy="46" r="2.2" />
            <circle cx="53" cy="58" r="1.8" />
            <circle cx="42" cy="154" r="2" />
            <circle cx="50" cy="166" r="2.2" />
            <circle cx="68" cy="170" r="2.4" />
            <circle cx="86" cy="162" r="2" />
            <circle cx="48" cy="98" r="1.8" />
          </g>
        </g>

        <!-- LEFT LUNG (2 Lobes, Cardiac Notch) -->
        <g class="lung-lobe-group lung-left">
          <path class="lung-body" filter="url(#lung-shadow)"
            d="M134,72 C138,52 150,32 162,32 C176,32 190,48 198,76 C207,108 210,138 206,162 C203,178 188,185 168,183 C154,181 144,172 138,158 C132,144 135,130 131,114 C128,98 131,85 134,72 Z"
            fill="url(#lung-grad-left)" />
          <path d="M134,72 C138,52 150,32 162,32 C176,32 190,48 198,76 C207,108 210,138 206,162 C203,178 188,185 168,183 C154,181 144,172 138,158 C132,144 135,130 131,114 C128,98 131,85 134,72 Z"
            fill="url(#lung-highlight)" />

          <path d="M198,95 Q170,126 136,152" stroke="#25523a" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.6" />

          <ellipse class="lung-air-pulse" cx="168" cy="120" rx="30" ry="46" fill="url(#air-glow)" />

          <g class="bronchial-tree" stroke="#e6f7ec" stroke-linecap="round" fill="none">
            <path d="M136,78 Q150,92 162,105" stroke-width="2.8" />
            <path d="M162,105 Q175,115 186,134" stroke-width="2.2" />
            <path d="M162,105 Q155,122 154,148" stroke-width="2" />
            <path d="M148,86 Q158,70 166,56" stroke-width="2.2" />
            <path d="M166,56 Q174,48 180,46" stroke-width="1.4" opacity="0.8" />
            <path d="M186,134 Q194,142 198,154" stroke-width="1.3" opacity="0.75" />
            <path d="M154,148 Q162,162 172,170" stroke-width="1.3" opacity="0.75" />
          </g>
          <g class="alveoli-nodes" fill="#ffffff" opacity="0.55">
            <circle cx="180" cy="46" r="2.2" />
            <circle cx="187" cy="58" r="1.8" />
            <circle cx="198" cy="154" r="2" />
            <circle cx="190" cy="166" r="2.2" />
            <circle cx="172" cy="170" r="2.4" />
            <circle cx="154" cy="162" r="2" />
            <circle cx="192" cy="98" r="1.8" />
          </g>
        </g>

        <!-- TRACHEA & BRONCHI -->
        <g class="trachea-structure">
          <path d="M113,8 L127,8 L127,58 Q127,66 136,76 L130,82 Q121,71 120,64 Q119,71 110,82 L104,76 Q113,66 113,58 Z"
            fill="url(#trachea-grad)" filter="url(#lung-shadow)" />

          <g stroke="#396c4f" stroke-width="1.8" stroke-linecap="round" opacity="0.75">
            <line x1="114" y1="14" x2="126" y2="14" />
            <line x1="114" y1="21" x2="126" y2="21" />
            <line x1="114" y1="28" x2="126" y2="28" />
            <line x1="114" y1="35" x2="126" y2="35" />
            <line x1="114" y1="42" x2="126" y2="42" />
            <line x1="114" y1="49" x2="126" y2="49" />
          </g>

          <g stroke="#396c4f" stroke-width="1.5" stroke-linecap="round" opacity="0.6">
            <line x1="110" y1="62" x2="117" y2="67" />
            <line x1="106" y1="70" x2="113" y2="75" />
            <line x1="123" y1="67" x2="130" y2="62" />
            <line x1="127" y1="75" x2="134" y2="70" />
          </g>
        </g>
      </svg>
    `;
    return wrap;
  }

  function showBreathingPrep() {
    view = "breathingPrep";
    setFreshTheme(true);
    const { panel, actions } = makePanel(
      copy.interception.breathingPrepTitle,
      copy.interception.breathingPrepHint
    );

    const lungsWrap = createLungsElement(true);
    panel.insertBefore(lungsWrap, actions);

    const startButton = addButton(
      actions,
      copy.interception.startBreathing,
      "primary",
      startBreathing
    );
    startButton.focus();
  }

  function beginBreathingPrep() {
    if (view !== "greeting") return;
    showBreathingPrep();
  }

  function showBreathing() {
    view = "breathing";
    setFreshTheme(true);
    const { panel, actions } = makePanel(
      copy.interception.breathingTitle,
      copy.interception.breathingHint
    );

    const timer = document.createElement("div");
    timer.className = "timer";
    timer.setAttribute("aria-live", "off");
    panel.insertBefore(timer, actions);

    const lungsWrap = createLungsElement(false);
    lungsWrap.classList.toggle("expand", cyclePhase === "in");

    const cue = document.createElement("p");
    cue.className = "breath-cue";
    cue.setAttribute("aria-live", "polite");
    cue.textContent = cyclePhase === "in"
      ? copy.interception.breatheIn
      : copy.interception.breatheOut;

    const cycleDisplay = document.createElement("div");
    cycleDisplay.className = "cycle-count";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(cycleCount);

    const countLabel = document.createElement("span");
    countLabel.className = "count-label";
    countLabel.textContent = copy.interception.cycleCount;
    cycleDisplay.append(count, countLabel);

    panel.insertBefore(lungsWrap, actions);
    panel.insertBefore(cue, actions);
    panel.insertBefore(cycleDisplay, actions);

    addButton(actions, copy.interception.doneEarly, "secondary", finishBreathing);
    updateBreathTimer();
  }

  function showBreathingFiveMinDone() {
    view = "breathingFiveMin";
    setFreshTheme(true);
    const { panel, actions } = makePanel(
      copy.interception.breathingFiveMinTitle,
      copy.interception.breathingFiveMinHint
    );

    const lungsWrap = createLungsElement(true);
    panel.insertBefore(lungsWrap, actions);

    addButton(
      actions,
      copy.interception.breathingAgain,
      "primary",
      startBreathing
    );
    addButton(
      actions,
      copy.interception.breathingGoBack,
      "secondary",
      () => void showGoodbye()
    );
  }

  function showReturning() {
    view = "returning";
    setFreshTheme(true);
    const line = (copy.goodbye && typeof selectedGoodbyeIndex === "number" && copy.goodbye[selectedGoodbyeIndex])
      || copy.interception.returning;
    makePanel(line);
  }

  function setFreshTheme(isFresh) {
    const screen = shadow.querySelector(".screen");
    screen.classList.toggle("fresh", isFresh);
    screen.classList.remove("vent-room", "vent-entry");
  }

  function enterVentEntry() {
    shadow.querySelector(".screen")?.classList.add("vent-entry");
  }

  function enterVentRoom() {
    shadow.querySelector(".screen")?.classList.add("vent-room");
  }

  function renderCurrentView() {
    if (!copy || !host) return;
    if (view === "greeting") void showGreeting(true);
    else if (view === "notNow") void showNotNowResponse();
    else if (view === "continueCheckin") showContinueCheckin();
    else if (view === "breathingPrep") showBreathingPrep();
    else if (view === "breathing") showBreathing();
    else if (view === "breathingFiveMin") showBreathingFiveMinDone();
    else if (view === "factReveal") renderFactReveal();
    else if (view === "ventChoice") showVentChoice();
    else if (view === "ventWrite") showVentWrite();
    else if (view === "ventBurned") showVentBurned();
    else if (view === "ventPunch") showVentPunch();
    else if (view === "ventIdleCheck") showVentIdleCheck(ventResumeView);
    else if (view === "ventRoundDone") showVentRoundDone();
    else if (view === "ventRoundWarning") showVentRoundWarning(ventWarningKind);
    else if (view === "ventDailyLimit") showVentDailyLimit();
    else if (view === "ventAfter") showVentAfterExit();
    else if (view === "goodbye") void showGoodbye(true);
    else if (view === "returning") showReturning();
    else if (view === "returnFailed") showReturnFailed();
  }

  async function readSettings() {
    // storage.js is registered alongside this file, so every surface validates
    // and repairs settings the same way.
    if (globalThis.FocusStorage?.getSettings) return FocusStorage.getSettings();
    return chrome.storage.sync.get({
      enabled: true,
      enabled_sites: [],
      language: String(navigator.language || "").toLowerCase().startsWith("bn") ? "bn" : "en",
      debounce_minutes: DEFAULT_COOLDOWN_MINUTES,
      continue_checkin_enabled: true,
      time_checkin_enabled: false,
      time_checkin_minutes: 20
    });
  }

  function findMatchingDomain(enabledSites) {
    const hostname = location.hostname.toLowerCase();
    return enabledSites
      .filter((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
      .sort((first, second) => second.length - first.length)[0] || null;
  }

  async function loadCopy(language) {
    const result = await chrome.runtime.sendMessage({ type: "getCopy", language });
    if (!result || result.error) {
      throw new Error(result?.error || "Focus Friend could not load its language copy.");
    }
    return result;
  }

  async function wasRecentlyShown(domain, minutes) {
    if (typeof minutes !== "number" || minutes <= 0) return false;
    const { last_site_hit = {} } = await chrome.storage.local.get("last_site_hit");
    const lastHit = last_site_hit[domain];
    return Boolean(lastHit && Date.now() - lastHit < minutes * 60 * 1000);
  }

  async function rememberSiteHit() {
    if (!activeDomain) return;
    const { last_site_hit = {} } = await chrome.storage.local.get("last_site_hit");
    await chrome.storage.local.set({
      last_site_hit: { ...last_site_hit, [activeDomain]: Date.now() }
    });
  }

  function localDayKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  async function recordNotNowChoice() {
    if (!activeDomain) return false;
    if (settings?.continue_checkin_enabled === false) return false;

    const today = localDayKey();
    const { not_now_daily_counts: previous } = await chrome.storage.local.get("not_now_daily_counts");
    const record = previous?.day === today
      ? previous
      : { day: today, counts: {}, shown: [] };
    const counts = { ...record.counts };
    const shown = Array.isArray(record.shown) ? [...record.shown] : [];

    counts[activeDomain] = (counts[activeDomain] || 0) + 1;
    const currentCount = counts[activeDomain];
    // Triggers on the 6th "Not now" (more than 5 times) and every 6th time if they keep pausing
    const shouldShow = currentCount >= 6 && (!shown.includes(activeDomain) || currentCount % 6 === 0);
    if (shouldShow && !shown.includes(activeDomain)) {
      shown.push(activeDomain);
    }

    await chrome.storage.local.set({
      not_now_daily_counts: { day: today, counts, shown }
    });
    return shouldShow;
  }

  async function resetNotNowChoice(domain) {
    if (!domain) return;
    try {
      const today = localDayKey();
      const { not_now_daily_counts: previous } = await chrome.storage.local.get("not_now_daily_counts");
      if (previous?.counts) {
        previous.counts[domain] = 0;
        if (Array.isArray(previous.shown)) {
          previous.shown = previous.shown.filter((d) => d !== domain);
        }
        await chrome.storage.local.set({ not_now_daily_counts: previous });
      }
    } catch (error) {
      console.warn("Focus Friend could not reset not-now count:", error);
    }
  }

  // Used when the current site is no longer paused: stop counting time, take
  // away any leftover pill, and forget the stale domain/settings.
  function stopTrackingForInactiveSite() {
    if (gentlePillHost) {
      gentlePillHost.remove();
      gentlePillHost = null;
    }
    if (activeTrackerTimer) {
      clearInterval(activeTrackerTimer);
      activeTrackerTimer = null;
    }
    activeDomain = null;
    settings = null;
  }

  async function disablePauseForActiveSite() {
    const domain = activeDomain;
    if (!domain) {
      revealPage();
      return;
    }

    // Show the confirmation first. The settings change below will notify this
    // same page; the flag keeps that notification from wiping the message.
    makePanel(copy?.interception?.disabledSitePauseResponse || "");
    pendingDisableConfirmation = true;
    transitionTimer = setTimeout(() => {
      pendingDisableConfirmation = false;
      revealPage();
    }, 1400);

    try {
      const latest = await readSettings();
      const enabledSites = Array.isArray(latest.enabled_sites) ? latest.enabled_sites : [];
      await chrome.storage.sync.set({
        enabled_sites: enabledSites.filter((entry) => entry !== domain)
      });
    } catch (error) {
      pendingDisableConfirmation = false;
      console.error("Focus Friend could not disable site pause:", error);
      revealPage();
    }
  }

  function startBreathing() {
    cycleCount = 0;
    factSelection = null;
    breathingStartedAt = performance.now();
    breathDeadline = breathingStartedAt + BREATH_MAX_MS;
    cyclePhase = "in";
    showBreathing();
    if (breathTimer) clearInterval(breathTimer);
    breathTimer = setInterval(updateBreathTimer, 100);
  }

  function updateBreathTimer() {
    if (!isCurrentInstance()) return;
    if (view !== "breathing" || !shadow) return;
    const timer = shadow.querySelector(".timer");
    if (!timer) return;

    const elapsed = Math.max(0, performance.now() - breathingStartedAt);
    const boundedElapsed = Math.min(elapsed, BREATH_MAX_MS);
    const completedCycles = Math.floor(boundedElapsed / BREATH_CYCLE_MS);
    if (completedCycles !== cycleCount) {
      cycleCount = completedCycles;
      const count = shadow.querySelector(".count");
      if (count) count.textContent = String(cycleCount);
    }

    const nextPhase = boundedElapsed % BREATH_CYCLE_MS < BREATH_CYCLE_MS / 2 ? "in" : "out";
    if (nextPhase !== cyclePhase) {
      cyclePhase = nextPhase;
      const lungsWrap = shadow.querySelector(".breath-lungs-wrap");
      const cue = shadow.querySelector(".breath-cue");
      if (lungsWrap) lungsWrap.classList.toggle("expand", cyclePhase === "in");
      if (cue) {
        cue.textContent = cyclePhase === "in"
          ? copy.interception.breatheIn
          : copy.interception.breatheOut;
      }
    }

    const elapsedSeconds = Math.min(300, Math.floor(boundedElapsed / 1000));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const timeLabel = copy.interception.timeElapsed || copy.interception.timeLeft || "";
    timer.textContent = `${timeLabel}: ${formattedTime}`;

    if (elapsed >= BREATH_MAX_MS) {
      if (breathTimer) {
        clearInterval(breathTimer);
        breathTimer = null;
      }
      showBreathingFiveMinDone();
    }
  }

  function finishBreathing() {
    if (view !== "breathing") return;
    if (breathTimer) {
      clearInterval(breathTimer);
      breathTimer = null;
    }
    cycleCount = Math.floor(Math.min(BREATH_MAX_MS, Math.max(0, performance.now() - breathingStartedAt)) / BREATH_CYCLE_MS);
    void showFactReveal();
  }

  async function handleNotNow() {
    if (view !== "greeting") return;
    view = "processingNotNow";
    let shouldShowCheckin = false;
    try {
      shouldShowCheckin = await recordNotNowChoice();
    } catch (error) {
      console.error("Focus Friend could not save the optional check-in count:", error);
    }

    if (shouldShowCheckin) {
      showContinueCheckin();
      return;
    }

    try {
      await rememberSiteHit();
    } catch (error) {
      console.error("Focus Friend could not save the site cooldown:", error);
    }

    showNotNowResponse();
    transitionTimer = setTimeout(revealPage, 900);
  }

  function getSafeReturnUrl() {
    if (!previousPageUrl) return null;

    try {
      const previousPage = new URL(previousPageUrl);
      if (previousPage.protocol !== "http:" && previousPage.protocol !== "https:") return null;

      const hostname = previousPage.hostname.toLowerCase();
      const pausedSites = Array.isArray(settings?.enabled_sites) ? settings.enabled_sites : [];
      const leadsToPausedSite = pausedSites.some((domain) =>
        hostname === domain || hostname.endsWith(`.${domain}`)
      );
      if (leadsToPausedSite || (activeDomain && (hostname === activeDomain || hostname.endsWith(`.${activeDomain}`)))) {
        return null;
      }

      return previousPage.href;
    } catch {
      return null;
    }
  }

  async function returnToWork() {
    const returnUrl = getSafeReturnUrl();
    if (returnUrl) {
      try {
        window.location.replace(returnUrl);
        return true;
      } catch (error) {
        console.error("Focus Friend could not open the previous page:", error);
      }
    }

    try {
      const result = await chrome.runtime.sendMessage({ type: "returnToNewTab" });
      if (result?.error) throw new Error(result.error);
      return true;
    } catch (error) {
      console.error("Focus Friend could not return to a work page:", error);
      return false;
    }
  }

  function showReturnFailed() {
    view = "returnFailed";
    setFreshTheme(true);
    const { actions } = makePanel(copy.interception.returnFailed);
    addButton(actions, copy.interception.retryReturn, "primary", beginReturn);
    addButton(actions, copy.interception.stayHere, "secondary", revealPage);
  }

  function beginReturn() {
    showReturning();
    transitionTimer = setTimeout(() => {
      void (async () => {
        const returned = await returnToWork();
        if (!returned) showReturnFailed();
      })();
    }, 2500);
  }

  /* ── Gentle In-Session Active Time Check-In ─────────── */
  let gentlePillHost = null;
  let pillDismissedDomain = null;
  let pendingDisableConfirmation = false;
  let activeTrackerTimer = null;
  let activityListenersAttached = false;
  let lastUserActivityTime = Date.now();
  let unsavedActiveSeconds = 0;
  const IDLE_THRESHOLD_MS = 120_000; // 2 minutes AFK pauses active time tracking

  function onUserActiveInteraction() {
    lastUserActivityTime = Date.now();
  }

  function setupUserActivityListeners() {
    if (activityListenersAttached) return;
    activityListenersAttached = true;
    window.addEventListener("pointerdown", onUserActiveInteraction, { passive: true });
    window.addEventListener("keydown", onUserActiveInteraction, { passive: true });
    window.addEventListener("scroll", onUserActiveInteraction, { passive: true });
  }

  async function flushActiveTime() {
    if (!activeDomain || unsavedActiveSeconds <= 0) return null;
    const addedSeconds = unsavedActiveSeconds;
    unsavedActiveSeconds = 0;

    try {
      const today = localDayKey();
      const { daily_active_time: previous } = await chrome.storage.local.get("daily_active_time");
      const record = previous?.day === today
        ? previous
        : { day: today, seconds: {}, prompted: [] };
      const seconds = { ...record.seconds };
      const prompted = Array.isArray(record.prompted) ? [...record.prompted] : [];

      seconds[activeDomain] = (seconds[activeDomain] || 0) + addedSeconds;
      await chrome.storage.local.set({
        daily_active_time: { day: today, seconds, prompted }
      });
      return { totalSeconds: seconds[activeDomain], prompted };
    } catch (error) {
      console.warn("Focus Friend could not flush active time:", error);
      return null;
    }
  }

  async function checkActiveTimeThreshold() {
    if (!isCurrentInstance()) return;
    if (!settings?.time_checkin_enabled || !activeDomain) return;
    const result = await flushActiveTime();
    if (!result) return;

    const { totalSeconds, prompted } = result;
    const targetSeconds = (settings.time_checkin_minutes || 20) * 60;

    if (totalSeconds >= targetSeconds && !prompted.includes(activeDomain) && !host && !gentlePillHost && pillDismissedDomain !== activeDomain) {
      void showGentleTimePill();
    }
  }

  function startActiveTimeTracker() {
    if (!isCurrentInstance()) return;
    if (activeTrackerTimer) return;
    setupUserActivityListeners();

    activeTrackerTimer = setInterval(() => {
      if (!isCurrentInstance()) return;
      if (!activeDomain || !settings?.time_checkin_enabled) return;
      if (document.visibilityState !== "visible") return;
      if (!document.hasFocus()) return;
      if (Date.now() - lastUserActivityTime > IDLE_THRESHOLD_MS) return;
      if (host) return; // Don't count while pause overlay is covering

      unsavedActiveSeconds += 1;

      if (unsavedActiveSeconds >= 15) {
        checkActiveTimeThreshold().catch((error) => {
          console.warn("Focus Friend could not check active time:", error);
        });
      }
    }, 1000);
  }

  async function markSitePromptedToday(domain) {
    if (!domain) return;
    try {
      const today = localDayKey();
      const { daily_active_time: previous } = await chrome.storage.local.get("daily_active_time");
      const record = previous?.day === today
        ? previous
        : { day: today, seconds: {}, prompted: [] };
      const prompted = Array.isArray(record.prompted) ? [...record.prompted] : [];
      if (!prompted.includes(domain)) {
        prompted.push(domain);
      }
      await chrome.storage.local.set({
        daily_active_time: { day: today, seconds: record.seconds || {}, prompted }
      });
    } catch (err) {
      console.warn("Focus Friend could not mark site prompted:", err);
    }
  }

  async function showGentleTimePill() {
    if (!isCurrentInstance()) return;
    if (gentlePillHost || host) return;
    if (!copy) {
      copy = await loadCopy(settings?.language || "en");
    }

    gentlePillHost = document.createElement("div");
    gentlePillHost.id = GENTLE_PILL_HOST_ID;
    const pillShadow = gentlePillHost.attachShadow({ mode: "closed" });

    const titleText = copy?.interception?.timeCheckinTitle || "";
    const breakText = copy?.interception?.timeCheckinTakeBreak || "";
    const continueText = copy?.interception?.timeCheckinKeepGoing || "";
    const closeLabel = copy?.interception?.close || "";

    pillShadow.innerHTML = `
      <style>
        :host { all: initial; }
        .pill-wrap {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483646;
          box-sizing: border-box;
          width: min(420px, calc(100vw - 32px));
          padding: 16px 18px;
          border: 1.5px solid rgb(70 118 90 / 25%);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 16px 40px rgba(35, 62, 43, 0.16), 0 4px 12px rgba(0,0,0,0.06);
          font-family: system-ui, -apple-system, sans-serif;
          color: #284b39;
          text-align: left;
          pointer-events: auto;
          animation: pill-slide-in 380ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes pill-slide-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pill-slide-out {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(16px) scale(0.96); }
        }
        .pill-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .pill-title {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          line-height: 1.45;
          color: #284b39;
        }
        .pill-close {
          border: 0;
          background: transparent;
          color: #7a9484;
          font-size: 18px;
          line-height: 1;
          padding: 2px 6px;
          border-radius: 6px;
          cursor: pointer;
        }
        .pill-close:hover { background: #e3eee4; color: #284b39; }
        .pill-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .pill-btn {
          border: 0;
          border-radius: 999px;
          padding: 8px 16px;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          transition: transform 0.15s ease, background 0.2s ease;
        }
        .pill-btn:hover { transform: translateY(-1px); }
        .pill-btn.primary {
          background: #46765a;
          color: #fff;
          box-shadow: 0 4px 12px rgba(70, 118, 90, 0.25);
        }
        .pill-btn.primary:hover { background: #39634b; }
        .pill-btn.secondary {
          background: #eaf3eb;
          color: #365943;
        }
        .pill-btn.secondary:hover { background: #ddeade; }
      </style>
      <div class="pill-wrap" role="status" aria-live="polite">
        <div class="pill-header">
          <p class="pill-title">${titleText}</p>
          <button type="button" class="pill-close" aria-label="${closeLabel}">✕</button>
        </div>
        <div class="pill-actions">
          <button type="button" class="pill-btn secondary" id="pill-continue">${continueText}</button>
          <button type="button" class="pill-btn primary" id="pill-break">${breakText}</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(gentlePillHost);

    const wrap = pillShadow.querySelector(".pill-wrap");
    const closeBtn = pillShadow.querySelector(".pill-close");
    const continueBtn = pillShadow.querySelector("#pill-continue");
    const breakBtn = pillShadow.querySelector("#pill-break");

    function dismissPill() {
      if (!gentlePillHost) return;
      // Keep it gone for the rest of this page even if the storage write fails.
      pillDismissedDomain = activeDomain;
      wrap.style.animation = "pill-slide-out 250ms ease forwards";
      setTimeout(() => {
        if (gentlePillHost) {
          gentlePillHost.remove();
          gentlePillHost = null;
        }
      }, 240);
    }

    closeBtn.addEventListener("click", async () => {
      await markSitePromptedToday(activeDomain);
      dismissPill();
    });

    continueBtn.addEventListener("click", async () => {
      await markSitePromptedToday(activeDomain);
      dismissPill();
    });

    breakBtn.addEventListener("click", async () => {
      await markSitePromptedToday(activeDomain);
      dismissPill();
      if (!host) mountCover();
      startBreathing();
    });
  }

  window.addEventListener("pagehide", () => void flushActiveTime());
  window.addEventListener("beforeunload", () => void flushActiveTime());

  async function checkAndShow(coverImmediately = false) {
    if (!isCurrentInstance()) return;

    // An extension reload invalidates content scripts that are already running in open tabs.
    // Do not try to call extension APIs from that stale context (the tab must be refreshed).
    if (!chrome?.runtime?.id) {
      revealPage();
      return;
    }

    try {
      if (coverImmediately && !mountCover()) return;

      settings = await readSettings();
      if (!isCurrentInstance()) return;
      applyOverlayLanguage();

      activeDomain = settings.enabled ? findMatchingDomain(settings.enabled_sites) : null;
      if (!activeDomain) {
        revealPage();
        return;
      }

      startActiveTimeTracker();

      if (await wasRecentlyShown(activeDomain, settings.debounce_minutes)) {
        if (isCurrentInstance()) revealPage();
        return;
      }

      copy = await loadCopy(settings.language);
      if (!isCurrentInstance()) return;
      if (!host) mountCover();
      setPageInert(true);
      view = "greeting";
      await showGreeting();
    } catch (error) {
      if (!/extension context invalidated/i.test(error?.message || "")) {
        console.error("Focus Friend could not show the pause screen:", error);
      }
      revealPage();
    }
  }

  function armStartupWatchdog() {
    if (startupWatchdog) clearTimeout(startupWatchdog);
    startupWatchdog = setTimeout(() => {
      startupWatchdog = null;
      if (!host || !shadow?.querySelector(".panel h1")) {
        console.warn("Intermission did not finish starting; revealing the page.");
        revealPage();
      }
    }, 8000);
  }

  function cleanupInstance() {
    if (activeTrackerTimer) {
      clearInterval(activeTrackerTimer);
      activeTrackerTimer = null;
    }
    if (gentlePillHost) {
      gentlePillHost.remove();
      gentlePillHost = null;
    }
    if (activityListenersAttached) {
      window.removeEventListener("pointerdown", onUserActiveInteraction);
      window.removeEventListener("keydown", onUserActiveInteraction);
      window.removeEventListener("scroll", onUserActiveInteraction);
      activityListenersAttached = false;
    }
    if (focusInListenerAttached) {
      document.removeEventListener("focusin", handleFocusIn, true);
      focusInListenerAttached = false;
    }
    revealPage();
    activeDomain = null;
    settings = null;
    copy = null;
  }

  function start() {
    try {
      if (document.documentElement) {
        mountCover();
        void checkAndShow();
        armStartupWatchdog();
        return;
      }

      const observer = new MutationObserver(() => {
        if (!document.documentElement) return;
        observer.disconnect();
        mountCover();
        void checkAndShow();
        armStartupWatchdog();
      });
      observer.observe(document, { childList: true, subtree: true });
    } catch (error) {
      console.error("Intermission could not start:", error);
      revealPage();
    }
  }

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (!isCurrentInstance()) return;
    if (areaName !== "sync") return;

    let latest;
    try {
      latest = await readSettings();
    } catch (error) {
      console.warn("Focus Friend could not refresh its settings:", error);
      return;
    }

    const matchingDomain = latest.enabled
      ? findMatchingDomain(latest.enabled_sites)
      : null;

    if (!matchingDomain) {
      stopTrackingForInactiveSite();
      if (!pendingDisableConfirmation) revealPage();
      return;
    }

    if ("enabled" in changes || "enabled_sites" in changes) {
      const justEnabled = changes.enabled?.oldValue === false && latest.enabled === true;
      const previousSites = Array.isArray(changes.enabled_sites?.oldValue)
        ? changes.enabled_sites.oldValue
        : [];
      const hostname = location.hostname.toLowerCase();
      const newlyEnabled = latest.enabled_sites.some((domain) =>
        !previousSites.includes(domain)
        && (hostname === domain || hostname.endsWith(`.${domain}`))
      );

      // Turning the extension back on should pause this tab now, not after a refresh.
      if (!host && (justEnabled || newlyEnabled)) {
        void checkAndShow();
        return;
      }
    }

    if ("continue_checkin_enabled" in changes) {
      settings = latest;
      if (!latest.continue_checkin_enabled && view === "continueCheckin") {
        revealPage();
        return;
      }
    }

    if (["time_checkin_enabled", "time_checkin_minutes"].some((key) => key in changes)) {
      settings = latest;
      if (!latest.time_checkin_enabled && gentlePillHost) {
        gentlePillHost.remove();
        gentlePillHost = null;
      }
    }

    if ("language" in changes && host) {
      settings = latest;
      try {
        copy = await loadCopy(settings.language);
        applyOverlayLanguage();
        renderCurrentView();
      } catch (error) {
        console.warn("Focus Friend could not switch language:", error);
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!isCurrentInstance()) return;
    if (document.visibilityState === "hidden") {
      void flushActiveTime();
    } else if (document.visibilityState === "visible") {
      lastUserActivityTime = Date.now();
      if (!host) {
        void checkAndShow();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "focusFriendReveal" && isCurrentInstance()) {
      revealPage();
    }
  });

  INSTANCE_TOKEN.cleanup = cleanupInstance;
  start();
})();
