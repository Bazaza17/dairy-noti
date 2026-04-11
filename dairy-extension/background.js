importScripts('config.js');

const AMS_URL            = 'https://www.ams.usda.gov/rules-regulations/mmr/dmr';
const ALARM_NAME         = 'checkDairyReport';
const CHECK_INTERVAL_MIN = 1;
const POLL_MS            = 15_000;
const TAB_TIMEOUT_MS     = 30_000;

let isChecking = false; // prevents concurrent checks

// ── Bootstrap ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MIN });
  console.log('[Dairy Watcher] Installed.');
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MIN });
  });
  // Immediately check on browser start in case we're inside the window
  checkForNewReport();
});

// Alarm fires every minute — wakes the service worker if Chrome killed it
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkForNewReport();
});

// ── Time window guard — Wed 10am–2pm CT (wider buffer around the 11am–1pm release) ──

function isWithinCheckWindow() {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return ct.getDay() === 3 && ct.getHours() >= 10 && ct.getHours() < 14;
}

// ── Tab helpers ───────────────────────────────────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out after 30s'));
    }, TAB_TIMEOUT_MS);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Runs inside the AMS page — finds PDF link and hashes first 16KB
async function scrapeReportSignal() {
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

  try {
    const res = await fetch(pdfUrl, {
      headers: { 'Range': 'bytes=0-16383' },
      cache: 'no-store'
    });
    const buffer    = await res.arrayBuffer();
    const hashBuf   = await crypto.subtle.digest('SHA-256', buffer);
    const fingerprint = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return { pdfUrl, fingerprint };
  } catch (e) {
    console.error('[Dairy Watcher] Fingerprint failed:', e);
    return { pdfUrl, fingerprint: null };
  }
}

// ── Core check ────────────────────────────────────────────────────────────────

async function checkForNewReport() {
  if (!isWithinCheckWindow()) return;
  if (isChecking) return; // already running — skip this tick
  isChecking = true;

  await chrome.storage.local.set({ lastChecked: new Date().toISOString() });

  const tab = await chrome.tabs.create({ url: AMS_URL, active: false });

  try {
    await waitForTabLoad(tab.id);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeReportSignal
    });

    const signal = results?.[0]?.result;
    console.log('[Dairy Watcher] Signal:', signal);

    if (!signal?.pdfUrl)     { console.warn('[Dairy Watcher] No PDF link found.');       return; }
    if (!signal.fingerprint) { console.warn('[Dairy Watcher] Could not fingerprint PDF.'); return; }

    const { knownFingerprint } = await chrome.storage.local.get('knownFingerprint');

    if (signal.fingerprint !== knownFingerprint) {
      await chrome.storage.local.set({
        knownFingerprint: signal.fingerprint,
        pdfUrl: signal.pdfUrl,
        detectedAt: new Date().toISOString(),
        summary: null,
        summaryGeneratedAt: null
      });
      fireNotification(signal.pdfUrl);
      fetchAndSummarize(signal.pdfUrl);
    }
  } catch (e) {
    console.error('[Dairy Watcher] Check error:', e);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
    isChecking = false;
    // Always reschedule within the window — whether check passed, failed, or found nothing
    if (isWithinCheckWindow()) setTimeout(checkForNewReport, POLL_MS);
  }
}

// ── Notification ──────────────────────────────────────────────────────────────

function fireNotification(pdfUrl) {
  chrome.tabs.create({ url: pdfUrl, active: true });
  chrome.tabs.create({ url: chrome.runtime.getURL('summary.html'), active: false });
  chrome.notifications.create('dairyReportLive', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Dairy Report is Live',
    message: 'PDF and summary are open.',
    priority: 2,
    requireInteraction: true
  });
}

// ── PDF fetch + Claude summary (retries up to 3x) ────────────────────────────

async function fetchAndSummarize(pdfUrl, attempt = 1) {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.includes('YOUR_KEY_HERE')) {
    console.warn('[Dairy Watcher] No API key in config.js.');
    return;
  }

  console.log(`[Dairy Watcher] Fetching PDF for summarization (attempt ${attempt})…`);

  let pdfBase64;
  try {
    const res    = await fetch(pdfUrl, { cache: 'no-store' });
    const buffer = await res.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    // Chunk-based encoding — avoids per-byte string concatenation which is very slow
    const CHUNK  = 8192;
    let binary   = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    pdfBase64 = btoa(binary);
  } catch (e) {
    console.error('[Dairy Watcher] PDF fetch failed:', e);
    if (attempt < 3) setTimeout(() => fetchAndSummarize(pdfUrl, attempt + 1), 5000 * attempt);
    return;
  }

  const prompt = `You are analyzing a USDA AMS National Dairy Products Sales Report.

Extract ALL products and return a JSON object with this exact structure:

{
  "reportDate": "the report date as a string",
  "table": [
    {
      "product": "product name",
      "weightedAvg": "current week weighted avg price e.g. 1.7250",
      "change": "net change from prior week e.g. +0.0250 or -0.0100",
      "changePct": "percent change e.g. +1.4% or -0.6%"
    }
  ],
  "oneLiner": "One sentence. State the biggest mover and overall market direction."
}

Return ONLY the JSON object, no markdown, no explanation.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error(`Empty Claude response: ${JSON.stringify(data)}`);

    const summary = JSON.parse(text);
    await chrome.storage.local.set({ summary, summaryGeneratedAt: new Date().toISOString() });

    chrome.notifications.create('dairySummaryReady', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Summary Ready',
      message: 'Click the extension icon to view the market summary.',
      priority: 2,
      requireInteraction: false
    });

    console.log('[Dairy Watcher] Summary stored.');
  } catch (e) {
    console.error(`[Dairy Watcher] Claude error (attempt ${attempt}):`, e);
    if (attempt < 3) {
      setTimeout(() => fetchAndSummarize(pdfUrl, attempt + 1), 5000 * attempt);
    } else {
      // All retries exhausted — write error state so summary page can react
      await chrome.storage.local.set({ summaryError: true });
    }
  }
}

// Allow summary page to trigger a retry via message
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RETRY_SUMMARY') {
    chrome.storage.local.get('pdfUrl', ({ pdfUrl }) => {
      if (pdfUrl) {
        chrome.storage.local.set({ summaryError: false });
        fetchAndSummarize(pdfUrl);
      }
    });
  }
});
