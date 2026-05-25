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
    console.error('searchKmb error:', err);
    result.innerHTML = `<p>⚠️ 無實時數據</p>`;
  }
});

function parseQuery(q) {
  const s = q.trim().toUpperCase();
  const parts = s.split(/s+/);
  const route = parts[0] || '';
  const stopText = parts.slice(1).join(' ').trim();
  return { route, stopText };
}

async function searchKmb(q) {
  const { route, stopText } = parseQuery(q);
  console.log('parseQuery =>', { route, stopText });

  if (!route) throw new Error('No route');

  const routeStopUrl = `${API_BASE}/kmb/route-stop/${encodeURIComponent(route)}/1/1`;
  console.log('fetch route-stop =>', routeStopUrl);

  const routeStopsRes = await fetchJson(routeStopUrl);
  console.log('routeStopsRes =>', routeStopsRes);

  const stopList = routeStopsRes.data || routeStopsRes || [];
  console.log('stopList =>', stopList);

  if (!Array.isArray(stopList) || !stopList.length) {
    throw new Error('No stop list');
  }

  let chosen = null;
  if (stopText) {
    chosen = stopList.find(s => matchesStopText(s, stopText)) || null;
  }
  if (!chosen) chosen = stopList[0];

  console.log('chosen stop =>', chosen);

  const stopId = chosen.stop || chosen.stop_id || chosen.id || '';
  const stopName = chosen.name_tc || chosen.name_en || stopText || stopId;

  console.log('stopId =>', stopId);
  console.log('stopName =>', stopName);

  if (!stopId) throw new Error('No stop id');

  const stopEtaUrl = `${API_BASE}/kmb/stop-eta/${encodeURIComponent(stopId)}`;
  console.log('fetch stop-eta =>', stopEtaUrl);

  const stopEtaRes = await fetchJson(stopEtaUrl);
  console.log('stopEtaRes =>', stopEtaRes);

  const stopEtaData = stopEtaRes.data || stopEtaRes || [];
  console.log('stopEtaData =>', stopEtaData);

  if (!Array.isArray(stopEtaData) || !stopEtaData.length) {
    throw new Error('No stop ETA data');
  }

  const routeUpper = String(route).toUpperCase();

  const etas = stopEtaData
    .filter(x => {
      const ok = x && String(x.route || '').toUpperCase() === routeUpper && x.eta;
      if (ok) console.log('matched ETA item =>', x);
      return ok;
    })
    .slice(0, 3)
    .map((x, idx) => ({
      label: idx === 0 ? '下一班' : idx === 1 ? '下 2 班' : '下 3 班',
      time: formatTime(x.eta),
      status: etaStatus(x)
    }));

  console.log('etas =>', etas);

  if (!etas.length) {
    throw new Error('No ETA');
  }

  const sameStopRoutes = [];
  const seen = new Set();

  for (const x of stopEtaData) {
    const r = String(x.route || '').toUpperCase();
    if (!r || r === routeUpper || seen.has(r)) continue;
    seen.add(r);

    sameStopRoutes.push({
      route: x.route,
      t1: x.eta ? formatTime(x.eta) : '-',
      t2: x.eta2 ? formatTime(x.eta2) : '-',
      t3: x.eta3 ? formatTime(x.eta3) : '-',
      status: etaStatus(x)
    });

    if (sameStopRoutes.length >= 3) break;
  }

  console.log('sameStopRoutes =>', sameStopRoutes);

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
  return d.toLocaleTimeString('zh-HK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  console.log('fetch response =>', url, res.status);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.log('error body =>', text);
    throw new Error(`HTTP ${res.status}`);
  }

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
