// ==UserScript==
// @name         Windows Central - suppress anti-adblock alert
// @description  Suppress the Windows Central "Please allow ads" alert/confirm prompt.
// @match        https://windowscentral.com/*
// @match        https://www.windowscentral.com/*
// @run-at       document-start
// ==/UserScript==

(() => {
  const shouldBlock = value => /please allow ads on this site|click ok to learn more/i.test(String(value || ''));

  const originalAlert = window.alert.bind(window);
  const originalConfirm = window.confirm.bind(window);

  window.alert = value => {
    if (shouldBlock(value)) return undefined;
    return originalAlert(value);
  };

  window.confirm = value => {
    if (shouldBlock(value)) return false;
    return originalConfirm(value);
  };
})();
