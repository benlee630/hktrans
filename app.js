const form = document.getElementById('searchForm');
const input = document.getElementById('queryInput');
const result = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;

  result.innerHTML = `<p class="muted">搜尋中...</p>`;

  try {
    const data = await mockSearch(q);
    renderResult(q, data);
  } catch (err) {
    result.innerHTML = `<p>⚠️ 無實時數據</p>`;
  }
});

async function mockSearch(q) {
  await new Promise(r => setTimeout(r, 500));
  return {
    title: q,
    items: [
      { label: '下一班', time: '14:23', status: '正常' },
      { label: '下 2 班', time: '14:38', status: '正常' },
      { label: '下 3 班', time: '14:53', status: '延誤 6 分鐘' },
    ]
  };
}

function renderResult(q, data) {
  result.innerHTML = `
    <div class="row"><strong>${escapeHtml(data.title)}</strong><span class="small">即時結果</span></div>
    ${data.items.map(item => `
      <div class="row">
        <span>${escapeHtml(item.label)}</span>
        <span>${escapeHtml(item.time)} <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">(${escapeHtml(item.status)})</span></span>
      </div>
    `).join('')}
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
