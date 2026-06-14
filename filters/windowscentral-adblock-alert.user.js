// ==UserScript==
// @name         Windows Central - suppress anti-adblock prompt/reload
// @description  Suppress the Windows Central "Please allow ads" prompt, block likely forced reload paths, and preserve reading position as a fallback.
// @match        https://windowscentral.com/*
// @match        https://www.windowscentral.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const promptPattern = /please allow ads on this site|click ok to learn more/i;
  const suspiciousPattern = /please allow ads|allow ads|adblock|ad blocker|ad-block|fuckadblock|blockadblock/i;
  const disruptivePattern = /location|reload|assign|replace|href|history\.go|scrollTo|scrollIntoView/i;
  const pageKey = `wc-pos:v4:${location.pathname}${location.search}`;
  const now = () => Date.now();

  const readSaved = () => {
    try {
      const item = JSON.parse(localStorage.getItem(pageKey) || sessionStorage.getItem(pageKey) || 'null');
      if (!item || typeof item.y !== 'number') return 0;
      if (now() - Number(item.t || 0) > 24 * 60 * 60 * 1000) return 0;
      return Math.max(0, item.y);
    } catch (_) {
      return 0;
    }
  };

  const writeSaved = y => {
    if (!Number.isFinite(y) || y < 80) return;
    const value = JSON.stringify({ y: Math.round(y), t: now() });
    try { localStorage.setItem(pageKey, value); } catch (_) {}
    try { sessionStorage.setItem(pageKey, value); } catch (_) {}
  };

  const getY = () => window.scrollY || document.documentElement.scrollTop || document.body?.scrollTop || 0;
  const maxScrollableY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  let lastGoodY = Math.max(readSaved(), getY());
  let guardUntil = now() + 45000;
  let restoring = false;
  let userScrollUntil = 0;

  const remember = () => {
    if (restoring) return;
    const y = getY();
    if (y > lastGoodY || y > 140) {
      lastGoodY = Math.max(lastGoodY, y);
      writeSaved(lastGoodY);
    }
  };

  const extendGuard = ms => {
    remember();
    guardUntil = Math.max(guardUntil, now() + ms);
  };

  const looksDisruptive = value => {
    const s = String(value || '');
    return suspiciousPattern.test(s) && disruptivePattern.test(s);
  };

  const blockPrompt = value => {
    const blocked = promptPattern.test(String(value || ''));
    if (blocked) extendGuard(60000);
    return blocked;
  };

  // Keep the page from fading through a black background if a visual overlay is used.
  const injectBaseCss = () => {
    const css = `
      html, body { background: #fff !important; }
      html.wc-no-blackout, html.wc-no-blackout body { background: #fff !important; }
      html.wc-no-blackout * { scroll-behavior: auto !important; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    (document.documentElement || document.head || document).appendChild(style);
    document.documentElement.classList.add('wc-no-blackout');
  };

  try { injectBaseCss(); } catch (_) {
    document.addEventListener('DOMContentLoaded', injectBaseCss, { once: true });
  }

  try { history.scrollRestoration = 'manual'; } catch (_) {}

  // Suppress the visible prompt.
  const originalAlert = window.alert.bind(window);
  const originalConfirm = window.confirm.bind(window);
  window.alert = value => blockPrompt(value) ? undefined : originalAlert(value);
  window.confirm = value => blockPrompt(value) ? false : originalConfirm(value);

  // Block delayed callbacks that appear to be the anti-adblock punishment path.
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalRAF = window.requestAnimationFrame?.bind(window);
  const originalEval = window.eval.bind(window);
  const OriginalFunction = window.Function;

  const safeTimerHandler = handler => {
    if (typeof handler === 'string') {
      if (looksDisruptive(handler)) {
        extendGuard(60000);
        return () => undefined;
      }
      return handler;
    }

    if (typeof handler === 'function') {
      const source = Function.prototype.toString.call(handler);
      if (looksDisruptive(source)) {
        extendGuard(60000);
        return () => undefined;
      }
    }

    return handler;
  };

  window.setTimeout = (handler, delay, ...args) => originalSetTimeout(safeTimerHandler(handler), delay, ...args);
  window.setInterval = (handler, delay, ...args) => originalSetInterval(safeTimerHandler(handler), delay, ...args);

  if (originalRAF) {
    window.requestAnimationFrame = callback => originalRAF(safeTimerHandler(callback));
  }

  window.eval = code => {
    if (looksDisruptive(code)) {
      extendGuard(60000);
      return undefined;
    }
    return originalEval(code);
  };

  try {
    window.Function = new Proxy(OriginalFunction, {
      apply(target, thisArg, args) {
        const body = args.join('\n');
        if (looksDisruptive(body)) {
          extendGuard(60000);
          return function () {};
        }
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args) {
        const body = args.join('\n');
        if (looksDisruptive(body)) {
          extendGuard(60000);
          return function () {};
        }
        return Reflect.construct(target, args);
      }
    });
  } catch (_) {}

  // Some anti-adblock code is injected as inline scripts. Neuter those before they run when possible.
  const originalAppendChild = Node.prototype.appendChild;
  const originalInsertBefore = Node.prototype.insertBefore;

  const neutralizeScriptNode = node => {
    try {
      if (node && String(node.tagName).toLowerCase() === 'script') {
        const code = node.textContent || '';
        if (looksDisruptive(code)) {
          extendGuard(60000);
          node.textContent = '';
          node.type = 'javascript/blocked';
        }
      }
    } catch (_) {}
    return node;
  };

  Node.prototype.appendChild = function (node) {
    return originalAppendChild.call(this, neutralizeScriptNode(node));
  };

  Node.prototype.insertBefore = function (node, ref) {
    return originalInsertBefore.call(this, neutralizeScriptNode(node), ref);
  };

  // Hide transient black fixed overlays if the site uses a visual fade instead of a hard reload.
  const isBlackout = el => {
    try {
      if (!(el instanceof HTMLElement)) return false;
      const cs = getComputedStyle(el);
      const z = Number(cs.zIndex || 0);
      const rect = el.getBoundingClientRect();
      const bg = cs.backgroundColor || '';
      const coversScreen = rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8;
      const fixedOrSticky = cs.position === 'fixed' || cs.position === 'sticky';
      const dark = /rgba?\(\s*(0|1|2|3|4|5|6|7|8|9|1\d|2\d|3\d)\s*,\s*(0|1|2|3|4|5|6|7|8|9|1\d|2\d|3\d)\s*,\s*(0|1|2|3|4|5|6|7|8|9|1\d|2\d|3\d)/i.test(bg);
      return fixedOrSticky && coversScreen && dark && z >= 10;
    } catch (_) {
      return false;
    }
  };

  const removeBlackouts = root => {
    if (now() > guardUntil) return;
    const nodes = [];
    if (root instanceof HTMLElement) nodes.push(root);
    try { nodes.push(...root.querySelectorAll?.('*') || []); } catch (_) {}
    for (const node of nodes) {
      if (isBlackout(node)) {
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('opacity', '0', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  };

  try {
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) removeBlackouts(node);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  const originalScrollTo = window.scrollTo.bind(window);
  const originalScrollBy = window.scrollBy.bind(window);
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalHistoryGo = history.go.bind(history);
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  const targetFromArgs = args => {
    if (args.length === 1 && args[0] && typeof args[0] === 'object') return Number(args[0].top ?? getY());
    return Number(args[1] ?? getY());
  };

  const shouldBlockProgrammaticJump = targetY => {
    if (restoring) return false;
    if (now() > guardUntil) return false;
    if (now() < userScrollUntil) return false;
    const currentY = getY();
    const referenceY = Math.max(lastGoodY, readSaved());
    if (referenceY < 300) return false;
    if (!Number.isFinite(targetY)) return false;
    if (targetY < 120) return true;
    if (targetY < referenceY - 350 && targetY < currentY - 250) return true;
    return false;
  };

  const canRestore = y => Number.isFinite(y) && y >= 250 && maxScrollableY() >= y - 120;

  const restore = () => {
    const y = Math.max(lastGoodY, readSaved());
    if (!canRestore(y)) return false;
    if (getY() >= y - 140) return true;
    restoring = true;
    try { originalScrollTo(0, y); } catch (_) {}
    originalSetTimeout(() => { restoring = false; }, 100);
    return true;
  };

  window.scrollTo = (...args) => {
    const targetY = targetFromArgs(args);
    if (shouldBlockProgrammaticJump(targetY)) {
      originalSetTimeout(restore, 0);
      return undefined;
    }
    return originalScrollTo(...args);
  };

  window.scrollBy = (...args) => {
    const deltaY = targetFromArgs(args);
    const targetY = getY() + deltaY;
    if (shouldBlockProgrammaticJump(targetY)) {
      originalSetTimeout(restore, 0);
      return undefined;
    }
    return originalScrollBy(...args);
  };

  Element.prototype.scrollIntoView = function (...args) {
    if (now() <= guardUntil && now() >= userScrollUntil && Math.max(lastGoodY, readSaved()) >= 300) {
      originalSetTimeout(restore, 0);
      return undefined;
    }
    return originalScrollIntoView.apply(this, args);
  };

  history.go = delta => {
    if (now() <= guardUntil && Number(delta) === 0) {
      originalSetTimeout(restore, 0);
      return undefined;
    }
    return originalHistoryGo(delta);
  };

  history.pushState = function (...args) {
    remember();
    return originalPushState(...args);
  };

  history.replaceState = function (...args) {
    remember();
    return originalReplaceState(...args);
  };

  const patchLocationMethod = name => {
    try {
      const original = Location.prototype[name];
      Object.defineProperty(Location.prototype, name, {
        configurable: true,
        value: function (...args) {
          if (now() <= guardUntil) {
            originalSetTimeout(restore, 0);
            return undefined;
          }
          return original.apply(this, args);
        }
      });
    } catch (_) {}
  };

  patchLocationMethod('reload');
  patchLocationMethod('assign');
  patchLocationMethod('replace');

  const markUserScroll = () => {
    userScrollUntil = now() + 700;
  };

  window.addEventListener('wheel', markUserScroll, { passive: true, capture: true });
  window.addEventListener('touchstart', markUserScroll, { passive: true, capture: true });
  window.addEventListener('touchmove', markUserScroll, { passive: true, capture: true });
  window.addEventListener('keydown', markUserScroll, { passive: true, capture: true });

  window.addEventListener('scroll', remember, { passive: true });
  window.addEventListener('pagehide', remember, { passive: true });
  window.addEventListener('beforeunload', remember, { passive: true });
  document.addEventListener('visibilitychange', remember, { passive: true });

  originalSetInterval(remember, 250);

  [0, 25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2200, 3000, 4500, 6500, 9000, 12000, 16000, 22000, 30000].forEach(delay => {
    originalSetTimeout(restore, delay);
  });

  const keeper = originalSetInterval(() => {
    if (now() > guardUntil + 1000) {
      clearInterval(keeper);
      return;
    }
    removeBlackouts(document.documentElement);
    const referenceY = Math.max(lastGoodY, readSaved());
    if (referenceY >= 300 && getY() < referenceY - 350 && now() >= userScrollUntil) restore();
  }, 300);
})();
