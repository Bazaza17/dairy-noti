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

function changeClass(change) {
  if (!change || change === 'N/A') return 'neutral';
  return change.startsWith('+') ? 'positive' : 'negative';
}

function cell(val) {
  return `<td>${val ?? '—'}</td>`;
}

chrome.storage.local.get(
  ['summary', 'summaryGeneratedAt', 'pdfUrl'],
  ({ summary, summaryGeneratedAt, pdfUrl }) => {

    if (!summary) {
      // Still generating — poll every 2s
      const interval = setInterval(() => {
        chrome.storage.local.get(['summary'], ({ summary }) => {
          if (summary) {
            clearInterval(interval);
            render(summary, summaryGeneratedAt, pdfUrl);
          }
        });
      }, 2000);
      return;
    }

    render(summary, summaryGeneratedAt, pdfUrl);
  }
);

function render(summary, generatedAt, pdfUrl) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';

  document.getElementById('metaLine').textContent =
    `${summary.reportDate ?? ''}  ·  Generated ${fmt(generatedAt)}`;

  if (pdfUrl) {
    document.getElementById('pdfLink').href = pdfUrl;
  }

  document.getElementById('brief').textContent = summary.brief ?? '—';

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  for (const row of (summary.table ?? [])) {
    const cw = row.currentWeek ?? {};
    const pw = row.priorWeek ?? {};
    const cls = changeClass(row.change);
    tbody.innerHTML += `
      <tr>
        <td>${row.product ?? '—'}</td>
        ${cell(cw.weightedAvg)}
        ${cell(cw.low)}
        ${cell(cw.high)}
        ${cell(cw.loads)}
        ${cell(pw.weightedAvg)}
        ${cell(pw.low)}
        ${cell(pw.high)}
        ${cell(pw.loads)}
        <td class="${cls}">${row.change ?? '—'}</td>
        <td class="${cls}">${row.changePct ?? '—'}</td>
      </tr>`;
  }
}
