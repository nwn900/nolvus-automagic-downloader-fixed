// ==UserScript==
// @name         Windows Central - suppress anti-adblock prompt and restore position
// @description  Suppress the Windows Central "Please allow ads" prompt and preserve article reading position.
// @match        https://windowscentral.com/*
// @match        https://www.windowscentral.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const promptPattern = /please allow ads on this site|click ok to learn more/i;
  const pageKey = `wc-pos:stable-v1:${location.pathname}${location.search}`;
  const now = () => Date.now();

  const getY = () => window.scrollY || document.documentElement.scrollTop || document.body?.scrollTop || 0;
  const maxScrollableY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

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

  let lastGoodY = Math.max(readSaved(), getY());
  let guardUntil = now() + 30000;
  let restoring = false;
  let userScrollUntil = 0;

  try { history.scrollRestoration = 'manual'; } catch (_) {}

  const remember = () => {
    if (restoring) return;
    const y = getY();
    if (y > lastGoodY || y > 140) {
      lastGoodY = Math.max(lastGoodY, y);
      writeSaved(lastGoodY);
    }
  };

  const markSuspicious = () => {
    remember();
    guardUntil = Math.max(guardUntil, now() + 45000);
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
    setTimeout(() => { restoring = false; }, 100);
    return true;
  };

  window.scrollTo = (...args) => {
    const targetY = targetFromArgs(args);
    if (shouldBlockProgrammaticJump(targetY)) {
      setTimeout(restore, 0);
      return undefined;
    }
    return originalScrollTo(...args);
  };

  window.scrollBy = (...args) => {
    const deltaY = targetFromArgs(args);
    const targetY = getY() + deltaY;
    if (shouldBlockProgrammaticJump(targetY)) {
      setTimeout(restore, 0);
      return undefined;
    }
    return originalScrollBy(...args);
  };

  Element.prototype.scrollIntoView = function (...args) {
    if (now() <= guardUntil && now() >= userScrollUntil && Math.max(lastGoodY, readSaved()) >= 300) {
      setTimeout(restore, 0);
      return undefined;
    }
    return originalScrollIntoView.apply(this, args);
  };

  history.go = delta => {
    if (now() <= guardUntil && Number(delta) === 0) {
      setTimeout(restore, 0);
      return undefined;
    }
    return originalHistoryGo(delta);
  };

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

  setInterval(remember, 250);

  [0, 25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2200, 3000, 4500, 6500, 9000, 12000, 16000, 22000, 30000].forEach(delay => {
    setTimeout(restore, delay);
  });

  const keeper = setInterval(() => {
    if (now() > guardUntil + 1000) {
      clearInterval(keeper);
      return;
    }
    const referenceY = Math.max(lastGoodY, readSaved());
    if (referenceY >= 300 && getY() < referenceY - 350 && now() >= userScrollUntil) restore();
  }, 300);
})();
