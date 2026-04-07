const AMS_URL = 'https://www.ams.usda.gov/rules-regulations/mmr/dmr';
const ALARM_NAME = 'checkDairyReport';
const CHECK_INTERVAL_MINUTES = 1;

// ── Bootstrap ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  console.log('[Dairy Watcher] Installed — checking every minute on Wed 11am–1pm CT.');
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkForNewReport();
});

// ── Time window guard ─────────────────────────────────────────────────────────

function isWithinCheckWindow() {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return ct.getDay() === 3 && ct.getHours() >= 11 && ct.getHours() < 13;
}

// ── Tab helpers ───────────────────────────────────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// Runs inside the AMS page (same origin) — finds the PDF and fingerprints its content
async function scrapeReportSignal() {
  // Find the "Most Recent Issue" PDF link
  let pdfUrl = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.toLowerCase().includes('most recent issue')) {
      const container = node.parentElement;
      for (const el of [container, container?.parentElement]) {
        if (!el) continue;
        const link = el.querySelector('a[href$=".pdf"]');
        if (link) { pdfUrl = link.href; break; }
      }
      if (pdfUrl) break;
    }
  }
  if (!pdfUrl) return null;

  // Fetch first 16KB of the PDF — same-origin, no CORS issues
  // PDF metadata (title, creation date) lives near the start of the file
  try {
    const res = await fetch(pdfUrl, {
      headers: { 'Range': 'bytes=0-16383' },
      cache: 'no-store'
    });
    const buffer = await res.arrayBuffer();

    // Hash the bytes with SubtleCrypto — available in extension contexts
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const fingerprint = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { pdfUrl, fingerprint };
  } catch (e) {
    console.error('[Dairy Watcher] Failed to fingerprint PDF:', e);
    return { pdfUrl, fingerprint: null };
  }
}

// ── Core check ────────────────────────────────────────────────────────────────

async function checkForNewReport() {
  if (!isWithinCheckWindow()) return;

  await chrome.storage.local.set({ lastChecked: new Date().toISOString() });

  // Open AMS page in a background tab (not focused)
  const tab = await chrome.tabs.create({ url: AMS_URL, active: false });

  try {
    await waitForTabLoad(tab.id);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeReportSignal
    });

    const signal = results?.[0]?.result;
    console.log('[Dairy Watcher] Signal:', signal);

    if (!signal?.pdfUrl) {
      console.warn('[Dairy Watcher] No PDF link found on page.');
      return;
    }

    if (!signal.fingerprint) {
      console.warn('[Dairy Watcher] Could not fingerprint PDF.');
      return;
    }

    const { knownFingerprint } = await chrome.storage.local.get('knownFingerprint');
    console.log('[Dairy Watcher] Stored fingerprint:', knownFingerprint);
    console.log('[Dairy Watcher] Current fingerprint:', signal.fingerprint);

    if (signal.fingerprint && signal.fingerprint !== knownFingerprint) {
      await chrome.storage.local.set({
        knownFingerprint: signal.fingerprint,
        pdfUrl: signal.pdfUrl,
        detectedAt: new Date().toISOString()
      });
      fireNotification(signal.pdfUrl);
    } else if (isWithinCheckWindow()) {
      // PDF hasn't changed yet — keep polling every 15s until it does
      setTimeout(checkForNewReport, 15_000);
    }
  } finally {
    chrome.tabs.remove(tab.id);
  }
}

// ── Notification ──────────────────────────────────────────────────────────────

function fireNotification(pdfUrl) {
  // Open the PDF immediately — no click needed
  chrome.tabs.create({ url: pdfUrl, active: true });

  // Notification is just a heads-up that it happened
  chrome.notifications.create('dairyReportLive', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Dairy Report is Live',
    message: "This week's midweek dairy PDF is open and ready.",
    priority: 2,
    requireInteraction: true
  });
}
