function fmt(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'America/Chicago'
  }) + ' · ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago'
  }) + ' CT';
}

chrome.storage.local.get(
  ['summary', 'summaryGeneratedAt', 'pdfUrl'],
  ({ summary, summaryGeneratedAt, pdfUrl }) => {
    if (!summary) {
      const deadline = Date.now() + 90_000; // 90 second timeout
      const interval = setInterval(() => {
        chrome.storage.local.get(
          ['summary', 'summaryGeneratedAt', 'pdfUrl', 'summaryError'],
          ({ summary, summaryGeneratedAt, pdfUrl, summaryError }) => {
            if (summary) {
              clearInterval(interval);
              render(summary, summaryGeneratedAt, pdfUrl);
            } else if (summaryError || Date.now() > deadline) {
              clearInterval(interval);
              showError(pdfUrl);
            }
          });
      }, 2000);
      return;
    }
    render(summary, summaryGeneratedAt, pdfUrl);
  }
);

function showError(pdfUrl) {
  document.getElementById('loading').innerHTML = `
    <p style="margin-bottom:12px">Summary generation failed.</p>
    <button id="retryBtn" style="padding:8px 16px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Retry</button>
    ${pdfUrl ? `<br><br><a href="${pdfUrl}" target="_blank" style="color:#60a5fa;font-size:12px">Open raw PDF →</a>` : ''}
  `;
  document.getElementById('retryBtn')?.addEventListener('click', () => {
    document.getElementById('loading').innerHTML = '<div class="spinner"></div><p>Retrying…</p>';
    chrome.runtime.sendMessage({ type: 'RETRY_SUMMARY' });
  });
}

function render(summary, generatedAt, pdfUrl) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';

  document.getElementById('metaLine').textContent =
    `${summary.reportDate ?? ''}  ·  Generated ${fmt(generatedAt)}`;

  if (pdfUrl) document.getElementById('pdfLink').href = pdfUrl;

  document.getElementById('oneLiner').textContent = summary.oneLiner ?? '—';

  const rows = document.getElementById('rows');
  rows.innerHTML = '';

  // Find max absolute change for bar scaling
  const maxChange = Math.max(
    ...( summary.table ?? []).map(r => Math.abs(parseFloat(r.change) || 0))
  );

  for (const row of (summary.table ?? [])) {
    const change = parseFloat(row.change) || 0;
    const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const barPct = maxChange > 0 ? Math.round((Math.abs(change) / maxChange) * 100) : 0;
    const magPct = barPct * 0.3; // subtle background tint, max 30%

    rows.innerHTML += `
      <div class="row ${dir}" style="--mag:${magPct}%">
        <div class="product-name">${row.product ?? '—'}</div>
        <div class="bar-wrap"><div class="bar-fill" style="--bar:${barPct}%"></div></div>
        <div class="change-col">
          <span class="change-val">${row.change ?? '—'}</span>
          <span class="change-pct">${row.changePct ?? ''}</span>
        </div>
        <div class="price-col">
          <div class="price-val">${row.weightedAvg ?? '—'}</div>
          <div class="price-label">Wtd Avg</div>
        </div>
      </div>`;
  }
}
