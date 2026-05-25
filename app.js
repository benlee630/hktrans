const form = document.getElementById('searchForm');
const input = document.getElementById('queryInput');
const result = document.getElementById('result');

const API_BASE = 'https://hktrans.benlee630.workers.dev';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  result.innerHTML = `<p class="muted">搜尋中...</p>`;

  try {
    const data = await searchKmb(q);
    renderResult(data);
  } catch (err) {
    console.error(err);
    result.innerHTML = `<p>⚠️ 無實時數據</p>`;
  }
});

function parseQuery(q) {
  const s = q.trim().toUpperCase();
  const parts = s.split(/s+/);
  const route = parts[0];
  const stopText = parts.slice(1).join(' ').trim();
  return { route, stopText };
}

async function searchKmb(q) {
  const { route, stopText } = parseQuery(q);
  if (!route) throw new Error('No route');

  const routeStops = await fetchJson(`${API_BASE}/kmb/route-stop/${encodeURIComponent(route)}/1/1`);
  const stopList = routeStops.data || routeStops || [];
  if (!stopList.length) throw new Error('No stop list');

  let chosen = null;
  if (stopText) chosen = stopList.find(s => matchesStopText(s, stopText)) || null;
  if (!chosen) chosen = stopList[0];

  const stopId = chosen.stop || chosen.stop_id || chosen.id;
  const stopName = chosen.name_tc || chosen.name_en || stopText || stopId;
  if (!stopId) throw new Error('No stop id');

  const etaRes = await fetchJson(`${API_BASE}/kmb/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/1`);
  const etaData = Array.isArray(etaRes.data) ? etaRes.data : (Array.isArray(etaRes) ? etaRes : []);
  const etas = etaData.filter(x => x && x.eta).slice(0, 3).map((x, idx) => ({
    label: idx === 0 ? '下一班' : idx === 1 ? '下 2 班' : '下 3 班',
    time: formatTime(x.eta),
    status: etaStatus(x)
  }));

  if (!etas.length) throw new Error('No ETA');

  const stopEtaRes = await fetchJson(`${API_BASE}/kmb/stop-eta/${encodeURIComponent(stopId)}`);
  const stopEtaData = Array.isArray(stopEtaRes.data) ? stopEtaRes.data : (Array.isArray(stopEtaRes) ? stopEtaRes : []);
  const sameStopRoutes = stopEtaData
    .filter(x => String(x.route || '').toUpperCase() !== route)
    .slice(0, 3)
    .map(x => ({
      route: x.route,
      t1: x.eta ? formatTime(x.eta) : '-',
      t2: x.eta2 ? formatTime(x.eta2) : '-',
      t3: x.eta3 ? formatTime(x.eta3) : '-',
      status: etaStatus(x)
    }));

  return { route, stopName, etas, sameStopRoutes };
}

function matchesStopText(stop, text) {
  const hay = `${stop.name_tc || ''} ${stop.name_en || ''} ${stop.stop || ''}`.toUpperCase();
  return hay.includes(text.toUpperCase());
}

function etaStatus(x) {
  const delay = Number(x.delay || 0);
  if (delay > 5) return `延誤 ${delay} 分鐘`;
  return '正常';
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function renderResult(data) {
  result.innerHTML = `
    <div class="row"><strong>${escapeHtml(data.route)}｜${escapeHtml(data.stopName)}</strong><span class="small">即時結果</span></div>
    ${data.etas.map(item => `
      <div class="row">
        <span>${escapeHtml(item.label)}</span>
        <span>${escapeHtml(item.time)} <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">(${escapeHtml(item.status)})</span></span>
      </div>
    `).join('')}
    ${data.sameStopRoutes.length ? `
      <div style="height:12px"></div>
      <div class="row"><strong>同站其他路線</strong><span class="small">最多 3 條</span></div>
      ${data.sameStopRoutes.map(item => `
        <div class="row" style="font-size:14px">
          <span>${escapeHtml(item.route)}</span>
          <span>${escapeHtml(item.t1)}｜${escapeHtml(item.t2)}｜${escapeHtml(item.t3)} <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">(${escapeHtml(item.status)})</span></span>
        </div>
      `).join('')}
    ` : ''}
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
