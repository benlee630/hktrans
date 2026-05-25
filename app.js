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
    console.error('SEARCH ERROR:', err);
    result.innerHTML = `
      <div class="row"><strong>⚠️ 無實時數據</strong><span class="small">${escapeHtml(err.message || 'Unknown error')}</span></div>
    `;
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
  const debug = {};
  const { route, stopText } = parseQuery(q);
  debug.query = { route, stopText };
  if (!route) throw new Error('No route');

  const routeStopUrl = `${API_BASE}/kmb/route-stop/${encodeURIComponent(route)}/1/1`;
  debug.routeStopUrl = routeStopUrl;
  const routeStopsRes = await fetchJson(routeStopUrl);
  debug.routeStopsRes = routeStopsRes;

  const stopList = Array.isArray(routeStopsRes?.data) ? routeStopsRes.data : (Array.isArray(routeStopsRes) ? routeStopsRes : []);
  debug.stopListCount = stopList.length;
  debug.stopListSample = stopList.slice(0, 3);

  if (!stopList.length) throw new Error('No stop list');

  let chosen = null;
  if (stopText) chosen = stopList.find(s => matchesStopText(s, stopText)) || null;
  if (!chosen) chosen = stopList[0];
  debug.chosen = chosen;

  const stopId = chosen.stop || chosen.stop_id || chosen.id || '';
  const stopName = chosen.name_tc || chosen.name_en || stopText || stopId;
  debug.stopId = stopId;
  debug.stopName = stopName;

  if (!stopId) throw new Error('No stop id');

  const stopEtaUrl = `${API_BASE}/kmb/stop-eta/${encodeURIComponent(stopId)}`;
  debug.stopEtaUrl = stopEtaUrl;
  const stopEtaRes = await fetchJson(stopEtaUrl);
  debug.stopEtaRes = stopEtaRes;

  const stopEtaData = Array.isArray(stopEtaRes?.data) ? stopEtaRes.data : (Array.isArray(stopEtaRes) ? stopEtaRes : []);
  debug.stopEtaCount = stopEtaData.length;
  debug.stopEtaSample = stopEtaData.slice(0, 8);

  if (!stopEtaData.length) throw new Error('No stop ETA data');

  const routeUpper = String(route).toUpperCase();

  const matched = stopEtaData.filter(x => {
    const r = String(x?.route || '').toUpperCase();
    const ok = r === routeUpper && !!x?.eta;
    return ok;
  });
  debug.matchedCount = matched.length;
  debug.matchedSample = matched.slice(0, 5);

  const etas = matched.slice(0, 3).map((x, idx) => ({
    label: idx === 0 ? '下一班' : idx === 1 ? '下 2 班' : '下 3 班',
    route: x.route,
    bound: x.bound || '',
    service_type: x.service_type || x.serviceType || '',
    time: formatTime(x.eta),
    rawEta: x.eta,
    status: etaStatus(x)
  }));
  debug.etas = etas;

  if (!etas.length) throw new Error('No ETA');

  const sameStopRoutes = [];
  const seen = new Set();

  for (const x of stopEtaData) {
    const r = String(x?.route || '').toUpperCase();
    if (!r || r === routeUpper || seen.has(r)) continue;
    seen.add(r);
    sameStopRoutes.push({
      route: x.route,
      bound: x.bound || '',
      service_type: x.service_type || x.serviceType || '',
      t1: x.eta ? formatTime(x.eta) : '-',
      t2: x.eta2 ? formatTime(x.eta2) : '-',
      t3: x.eta3 ? formatTime(x.eta3) : '-',
      status: etaStatus(x)
    });
    if (sameStopRoutes.length >= 3) break;
  }
  debug.sameStopRoutes = sameStopRoutes;

  return { route, stopName, etas, sameStopRoutes, debug };
}

function matchesStopText(stop, text) {
  const hay = `${stop.name_tc || ''} ${stop.name_en || ''} ${stop.stop || ''}`.toUpperCase();
  return hay.includes(text.toUpperCase());
}

function etaStatus(x) {
  const delay = Number(x?.delay || 0);
  if (delay > 5) return `延誤 ${delay} 分鐘`;
  return '正常';
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '-');
  return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
  }
}

function renderResult(data) {
  const dbg = data.debug || {};
  result.innerHTML = `
    <div class="row"><strong>${escapeHtml(data.route)}｜${escapeHtml(data.stopName)}</strong><span class="small">即時結果</span></div>

    <div style="height:10px"></div>
    <div class="row"><strong>Debug summary</strong><span class="small">核心定位</span></div>
    <div class="row" style="font-size:13px"><span>routeStops</span><span>${dbg.stopListCount ?? 0}</span></div>
    <div class="row" style="font-size:13px"><span>stopEta</span><span>${dbg.stopEtaCount ?? 0}</span></div>
    <div class="row" style="font-size:13px"><span>matched ETA</span><span>${dbg.matchedCount ?? 0}</span></div>
    <div class="row" style="font-size:13px"><span>stopId</span><span>${escapeHtml(dbg.stopId || '-')}</span></div>

    <div style="height:10px"></div>
    <div class="row"><strong>輸入解析</strong><span class="small">parseQuery</span></div>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.4;margin:0">${escapeHtml(JSON.stringify(dbg.query || {}, null, 2))}</pre>

    <div style="height:10px"></div>
    <div class="row"><strong>route-stop sample</strong><span class="small">前 3 筆</span></div>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.4;margin:0">${escapeHtml(JSON.stringify(dbg.stopListSample || [], null, 2))}</pre>

    <div style="height:10px"></div>
    <div class="row"><strong>chosen stop</strong><span class="small">實際揀中</span></div>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.4;margin:0">${escapeHtml(JSON.stringify(dbg.chosen || {}, null, 2))}</pre>

    <div style="height:10px"></div>
    <div class="row"><strong>stop-eta sample</strong><span class="small">前 8 筆</span></div>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.4;margin:0">${escapeHtml(JSON.stringify(dbg.stopEtaSample || [], null, 2))}</pre>

    <div style="height:10px"></div>
    <div class="row"><strong>matched ETA</strong><span class="small">前 5 筆</span></div>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.4;margin:0">${escapeHtml(JSON.stringify(dbg.matchedSample || [], null, 2))}</pre>

    <div style="height:12px"></div>
    <div class="row"><strong>正式結果</strong><span class="small">ETA</span></div>
    ${data.etas.map(item => `
      <div class="row">
        <span>${escapeHtml(item.label)}${item.bound ? `｜${escapeHtml(item.bound)}` : ''}</span>
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
