// ==UserScript==
// @name         Windows Central - suppress anti-adblock alert and scroll reset
// @description  Suppress the Windows Central "Please allow ads" prompt and preserve article scroll position.
// @match        https://windowscentral.com/*
// @match        https://www.windowscentral.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const promptPattern = /please allow ads on this site|click ok to learn more/i;
  const key = `wc-scroll:${location.pathname}${location.search}`;
  const now = () => Date.now();

  let suspiciousUntil = now() + 5000;
  let lastGoodY = Math.max(0, Number(sessionStorage.getItem(key)) || window.scrollY || 0);
  let restoring = false;

  const getY = () => window.scrollY || document.documentElement.scrollTop || document.body?.scrollTop || 0;

  const rememberY = () => {
    if (restoring) return;
    const y = getY();
    if (y > 120) {
      lastGoodY = y;
      try { sessionStorage.setItem(key, String(y)); } catch (_) {}
    }
  };

  const markSuspicious = () => {
    rememberY();
    suspiciousUntil = now() + 15000;
  };

  const shouldBlockPrompt = value => {
    const blocked = promptPattern.test(String(value || ''));
    if (blocked) markSuspicious();
    return blocked;
  };

  const originalAlert = window.alert.bind(window);
  const originalConfirm = window.confirm.bind(window);

  window.alert = value => {
    if (shouldBlockPrompt(value)) return undefined;
    return originalAlert(value);
  };

  window.confirm = value => {
    if (shouldBlockPrompt(value)) return false;
    return originalConfirm(value);
  };

  try { history.scrollRestoration = 'manual'; } catch (_) {}

  const originalScrollTo = window.scrollTo.bind(window);
  const originalScrollBy = window.scrollBy.bind(window);
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  const extractTargetY = args => {
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      return Number(args[0].top ?? getY());
    }
    return Number(args[1] ?? getY());
  };

  const isSuspiciousTopJump = targetY => {
    if (now() > suspiciousUntil) return false;
    if (lastGoodY < 250) return false;
    return Number.isFinite(targetY) && targetY <= 80;
  };

  const restoreY = reason => {
    const y = Math.max(lastGoodY, Number(sessionStorage.getItem(key)) || 0);
    if (y < 250) return;
    if (getY() >= y - 120) return;

    restoring = true;
    try { originalScrollTo(0, y); } catch (_) {}
    setTimeout(() => { restoring = false; }, 80);
  };

  window.scrollTo = (...args) => {
    const targetY = extractTargetY(args);
    if (isSuspiciousTopJump(targetY)) {
      setTimeout(() => restoreY('blocked-scrollTo'), 0);
      return undefined;
    }
    return originalScrollTo(...args);
  };

  window.scrollBy = (...args) => {
    const deltaY = extractTargetY(args);
    const targetY = getY() + deltaY;
    if (isSuspiciousTopJump(targetY)) {
      setTimeout(() => restoreY('blocked-scrollBy'), 0);
      return undefined;
    }
    return originalScrollBy(...args);
  };

  Element.prototype.scrollIntoView = function (...args) {
    if (now() <= suspiciousUntil && lastGoodY >= 250) {
      setTimeout(() => restoreY('blocked-scrollIntoView'), 0);
      return undefined;
    }
    return originalScrollIntoView.apply(this, args);
  };

  const patchLocationMethod = name => {
    try {
      const original = Location.prototype[name];
      Object.defineProperty(Location.prototype, name, {
        configurable: true,
        value: function (...args) {
          if (now() <= suspiciousUntil) return undefined;
          return original.apply(this, args);
        }
      });
    } catch (_) {}
  };

  patchLocationMethod('reload');

  window.addEventListener('scroll', rememberY, { passive: true });
  window.addEventListener('pagehide', rememberY, { passive: true });
  window.addEventListener('beforeunload', rememberY, { passive: true });

  [0, 50, 150, 350, 750, 1500, 3000, 6000].forEach(delay => {
    setTimeout(() => restoreY(`restore-${delay}`), delay);
  });
})();
