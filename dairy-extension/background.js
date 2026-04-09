importScripts('config.js');

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

// If the service worker was killed and revived, immediately resume checking
// so we don't wait up to 1 minute for the next alarm tick
self.addEventListener('activate', () => {
  checkForNewReport();
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
    const buffer = await res.arrayBuffer();
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
    } else if (isWithinCheckWindow()) {
      setTimeout(checkForNewReport, 15_000);
    }
  } finally {
    chrome.tabs.remove(tab.id);
  }
}

// ── Notification ──────────────────────────────────────────────────────────────

function fireNotification(pdfUrl) {
  chrome.tabs.create({ url: pdfUrl, active: true });

  chrome.notifications.create('dairyReportLive', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Dairy Report is Live',
    message: "PDF is open. Summary is being generated…",
    priority: 2,
    requireInteraction: true
  });
}

// ── PDF fetch + Claude summary ────────────────────────────────────────────────

async function fetchAndSummarize(pdfUrl) {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.includes('YOUR_KEY_HERE')) {
    console.warn('[Dairy Watcher] No API key set in config.js.');
    return;
  }

  console.log('[Dairy Watcher] Fetching full PDF for summarization…');

  let pdfBase64;
  try {
    const res = await fetch(pdfUrl, { cache: 'no-store' });
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    pdfBase64 = btoa(binary);
  } catch (e) {
    console.error('[Dairy Watcher] Failed to fetch PDF:', e);
    return;
  }

  console.log('[Dairy Watcher] Sending PDF to Claude…');

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
  "oneLiner": "One sentence max. State the biggest mover and overall market direction. e.g. Blocks led gains at +$0.05 while butter softened -$0.02 on the week."
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
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      })
    });

    const data = await response.json();
    console.log('[Dairy Watcher] Claude raw response:', JSON.stringify(data).slice(0, 500));
    const text = data.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Claude');

    const summary = JSON.parse(text);
    await chrome.storage.local.set({
      summary,
      summaryGeneratedAt: new Date().toISOString()
    });

    // Update notification to let him know summary is ready
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
    console.error('[Dairy Watcher] Claude API error:', e);
  }
}
