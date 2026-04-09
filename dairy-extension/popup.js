function fmt(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const date = d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'America/Chicago'
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Chicago'
  });
  return `${date} · ${time} CT`;
}

function isWatchWindow() {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return ct.getDay() === 3 && ct.getHours() >= 11 && ct.getHours() < 13;
}

chrome.storage.local.get(
  ['lastChecked', 'detectedAt', 'pdfUrl', 'knownFingerprint'],
  ({ lastChecked, detectedAt, pdfUrl, knownFingerprint }) => {

    const dot   = document.getElementById('dot');
    const label = document.getElementById('statusLabel');

    if (knownFingerprint) {
      dot.className   = 'dot dot-live';
      label.className = 'status-label status-live';
      label.textContent = 'Report Live';
    } else if (isWatchWindow()) {
      dot.className   = 'dot dot-watch';
      label.className = 'status-label status-watch';
      label.textContent = 'Watching…';
    } else {
      dot.className   = 'dot dot-off';
      label.className = 'status-label status-off';
      label.textContent = 'Outside Window';
    }

    document.getElementById('lastChecked').textContent = fmt(lastChecked);

    if (detectedAt) {
      document.getElementById('detectedRow').style.display = 'flex';
      document.getElementById('detectedAt').textContent = fmt(detectedAt);
    }

    if (pdfUrl) {
      const btn = document.getElementById('openBtn');
      btn.style.display = 'block';
      btn.addEventListener('click', () => chrome.tabs.create({ url: pdfUrl }));
    }

    if (pdfUrl) {
      const summaryBtn = document.getElementById('summaryBtn');
      summaryBtn.style.display = 'block';
      summaryBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('summary.html') });
      });
    }
  }
);
