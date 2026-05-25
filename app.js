const app = {
  state: {
    route: '',
    stopText: '',
    chosenDirection: null,
    stopList: [],
    chosenStop: null,
    stopId: '',
    stopName: '',
    etaData: [],
    etas: [],
    sameStopRoutes: [],
    favorites: [],
    history: [],
    lastUpdated: null
  },

  config: {
    API_BASE: 'https://hktrans.benlee630.workers.dev',
    directionCandidates: ['outbound', 'inbound', 1, 2],
    maxHistory: 8,
    maxFavorites: 8
  },

  init() {
    this.cacheDom();
    this.bindEvents();
    this.loadPersistedState();
    this.renderIdle();
  },

  cacheDom() {
    this.dom = {
      form: document.getElementById('searchForm'),
      input: document.getElementById('queryInput'),
      result: document.getElementById('result')
    };
  },

  bindEvents() {
    this.dom.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = this.dom.input.value.trim();
      if (!q) return;
      await this.handleSearch(q);
    });
  },

  async handleSearch(q) {
    try {
      this.renderLoading();
      const parsed = this.parseQuery(q);
      this.state.route = parsed.route;
      this.state.stopText = parsed.stopText;

      const routeStopPack = await this.resolveRouteStop(parsed.route, parsed.stopText);
      if (!routeStopPack) throw new Error('No valid direction');

      this.state.chosenDirection = routeStopPack.chosenDirection;
      this.state.stopList = routeStopPack.stopList;
      this.state.chosenStop = routeStopPack.chosenStop;
      this.state.stopId = routeStopPack.stopId;
      this.state.stopName = routeStopPack.stopName;

      const etaPack = await this.fetchEta(routeStopPack.stopId, parsed.route);
      this.state.etaData = etaPack.raw;
      this.state.etas = etaPack.etas;
      this.state.sameStopRoutes = etaPack.sameStopRoutes;
      this.state.lastUpdated = new Date().toISOString();

      this.pushHistory({
        route: this.state.route,
        stopName: this.state.stopName,
        direction: this.state.chosenDirection,
        ts: this.state.lastUpdated
      });

      this.renderResult();
    } catch (err) {
      this.renderError(err);
    }
  },

  parseQuery(q) {
    const s = q.trim().toUpperCase();
    const parts = s.split(/s+/);
    return {
      route: parts[0] || '',
      stopText: parts.slice(1).join(' ').trim()
    };
  },

  async resolveRouteStop(route, stopText) {
    for (const direction of this.config.directionCandidates) {
      const url = `${this.config.API_BASE}/kmb/route-stop/${encodeURIComponent(route)}/${encodeURIComponent(direction)}/1`;
      try {
        const json = await this.fetchJson(url);
        const stopList = this.normalizeList(json);
        if (!stopList.length) continue;

        let chosenStop = null;
        if (stopText) chosenStop = stopList.find(s => this.matchesStopText(s, stopText)) || null;
        if (!chosenStop) chosenStop = stopList[0];

        const stopId = chosenStop.stop || chosenStop.stop_id || chosenStop.id || '';
        if (!stopId) continue;

        return {
          chosenDirection: direction,
          stopList,
          chosenStop,
          stopId,
          stopName: chosenStop.name_tc || chosenStop.name_en || stopText || stopId
        };
      } catch (_) {}
    }
    return null;
  },

  async fetchEta(stopId, route) {
    const url = `${this.config.API_BASE}/kmb/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/1`;
    const json = await this.fetchJson(url);
    const raw = this.normalizeList(json);

    const routeUpper = String(route).toUpperCase();
    const matched = raw.filter(x => String(x?.route || '').toUpperCase() === routeUpper && x?.eta);

    const etas = matched.slice(0, 3).map((x, idx) => ({
      label: idx === 0 ? '下 1 班' : idx === 1 ? '下 2 班' : '下 3 班',
      time: this.formatTime(x.eta),
      status: this.etaStatus(x),
      rawEta: x.eta
    }));

    const sameStopRoutes = [];
    const seen = new Set();

    for (const x of raw) {
      const r = String(x?.route || '').toUpperCase();
      if (!r || r === routeUpper || seen.has(r)) continue;
      seen.add(r);
      sameStopRoutes.push({
        route: x.route,
        time: x.eta ? this.formatTime(x.eta) : '-',
        status: this.etaStatus(x)
      });
      if (sameStopRoutes.length >= 3) break;
    }

    return { raw, etas, sameStopRoutes };
  },

  normalizeList(json) {
    if (Array.isArray(json?.data)) return json.data;
    if (Array.isArray(json)) return json;
    return [];
  },

  matchesStopText(stop, text) {
    const hay = `${stop.name_tc || ''} ${stop.name_en || ''} ${stop.stop || ''}`.toUpperCase();
    return hay.includes(text.toUpperCase());
  },

  etaStatus(x) {
    const delay = Number(x?.delay || 0);
    return delay > 5 ? `延誤 ${delay} 分鐘` : '正常';
  },

  formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '-');
    return d.toLocaleTimeString('zh-HK', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },

  async fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
    }
  },

  renderIdle() {
    this.dom.result.innerHTML = `
      <div class="row"><strong>香港實時到站</strong><span class="small">準備搜尋</span></div>
    `;
  },

  renderLoading() {
    this.dom.result.innerHTML = `<p class="muted">搜尋中...</p>`;
  },

  renderResult() {
    const s = this.state;
    this.dom.result.innerHTML = `
      <div class="row">
        <strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.stopName)}</strong>
        <span class="small">${this.escapeHtml(String(s.chosenDirection))}</span>
      </div>

      <div style="height:10px"></div>

      ${s.etas.map(item => `
        <div class="row">
          <span>${this.escapeHtml(item.label)}</span>
          <span>${this.escapeHtml(item.time)} <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">(${this.escapeHtml(item.status)})</span></span>
        </div>
      `).join('')}

      ${s.lastUpdated ? `
        <div style="height:8px"></div>
        <div class="row">
          <span class="small">更新時間</span>
          <span class="small">${this.escapeHtml(this.formatClock(s.lastUpdated))}</span>
        </div>
      ` : ''}

      ${s.sameStopRoutes.length ? `
        <div style="height:12px"></div>
        <div class="row"><strong>同站其他路線</strong><span class="small">最多 3 條</span></div>
        ${s.sameStopRoutes.map(item => `
          <div class="row" style="font-size:14px">
            <span>${this.escapeHtml(item.route)}</span>
            <span>${this.escapeHtml(item.time)} <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">(${this.escapeHtml(item.status)})</span></span>
          </div>
        `).join('')}
      ` : ''}
    `;
  },

  renderError(err) {
    this.dom.result.innerHTML = `
      <div class="row">
        <strong>⚠️ 無實時數據</strong>
        <span class="small">${this.escapeHtml(err.message || 'Unknown error')}</span>
      </div>
    `;
  },

  pushHistory(item) {
    this.state.history.unshift(item);
    this.state.history = this.state.history.slice(0, this.config.maxHistory);
    localStorage.setItem('hkbus_history', JSON.stringify(this.state.history));
  },

  loadPersistedState() {
    try {
      this.state.history = JSON.parse(localStorage.getItem('hkbus_history') || '[]');
      this.state.favorites = JSON.parse(localStorage.getItem('hkbus_favorites') || '[]');
    } catch {
      this.state.history = [];
      this.state.favorites = [];
    }
  },

  formatClock(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
  },

  escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
