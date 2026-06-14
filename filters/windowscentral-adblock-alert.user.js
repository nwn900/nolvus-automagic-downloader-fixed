// ==UserScript==
// @name         Windows Central - stop anti-adblock prompt path
// @description  Stop the Windows Central "Please allow ads" prompt path by throwing out of it, then preserve reading position as a fallback.
// @match        https://windowscentral.com/*
// @match        https://www.windowscentral.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const promptPattern = /please allow ads on this site|click ok to learn more/i;
  const pageKey = `wc-pos:v5:${location.pathname}${location.search}`;
  const SENTINEL = '__wc_blocked_ad_prompt__';
  const now = () => Date.now();

  const makeSentinelError = () => {
    const err = new Error(SENTINEL);
    err.name = SENTINEL;
    return err;
  };

  const isSentinel = value => {
    const text = String(value?.message || value?.reason?.message || value?.error?.message || value || '');
    return text.includes(SENTINEL);
  };

  window.addEventListener('error', event => {
    if (isSentinel(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('unhandledrejection', event => {
    if (isSentinel(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

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

  const blockPrompt = value => {
    if (!promptPattern.test(String(value || ''))) return false;
    extendGuard(60000);
    throw makeSentinelError();
  };

  try { history.scrollRestoration = 'manual'; } catch (_) {}

  const originalAlert = window.alert.bind(window);
  const originalConfirm = window.confirm.bind(window);

  window.alert = value => {
    blockPrompt(value);
    return originalAlert(value);
  };

  window.confirm = value => {
    blockPrompt(value);
    return originalConfirm(value);
  };

  // Also stop prompt-like strings from passing through timer/eval paths.
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalEval = window.eval.bind(window);
  const OriginalFunction = window.Function;

  const suspiciousCode = code => promptPattern.test(String(code || ''));

  const safeHandler = handler => {
    if (typeof handler === 'string' && suspiciousCode(handler)) {
      extendGuard(60000);
      return () => { throw makeSentinelError(); };
    }
    if (typeof handler === 'function') {
      try {
        if (suspiciousCode(Function.prototype.toString.call(handler))) {
          extendGuard(60000);
          return () => { throw makeSentinelError(); };
        }
      } catch (_) {}
    }
    return handler;
  };

  window.setTimeout = (handler, delay, ...args) => originalSetTimeout(safeHandler(handler), delay, ...args);
  window.setInterval = (handler, delay, ...args) => originalSetInterval(safeHandler(handler), delay, ...args);
  window.eval = code => {
    if (suspiciousCode(code)) {
      extendGuard(60000);
      throw makeSentinelError();
    }
    return originalEval(code);
  };

  try {
    window.Function = new Proxy(OriginalFunction, {
      apply(target, thisArg, args) {
        const body = args.join('\n');
        if (suspiciousCode(body)) {
          extendGuard(60000);
          return function () { throw makeSentinelError(); };
        }
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args) {
        const body = args.join('\n');
        if (suspiciousCode(body)) {
          extendGuard(60000);
          return function () { throw makeSentinelError(); };
        }
        return Reflect.construct(target, args);
      }
    });
  } catch (_) {}

  const originalScrollTo = window.scrollTo.bind(window);
  const originalScrollBy = window.scrollBy.bind(window);
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalHistoryGo = history.go.bind(history);

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

  window.addEventListener('touchstart', markUserScroll, { passive: true, capture: true });
  window.addEventListener('touchmove', markUserScroll, { passive: true, capture: true });
  window.addEventListener('wheel', markUserScroll, { passive: true, capture: true });
  window.addEventListener('keydown', markUserScroll, { passive: true, capture: true });

  window.addEventListener('scroll', remember, { passive: true });
  window.addEventListener('pagehide', remember, { passive: true });
  window.addEventListener('beforeunload', remember, { passive: true });
  document.addEventListener('visibilitychange', remember, { passive: true });

  originalSetInterval(remember, 250);

  [0, 25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2200, 3000, 4500, 6500, 9000, 12000, 16000, 22000, 30000].forEach(delay => {
    originalSetTimeout(restore, delay);
  });
})();
