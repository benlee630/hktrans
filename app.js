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
    lastUpdated: null,
    isRefreshing: false,
    refreshTimer: null,
    lastResolvedQuery: null,
    availableDirections: []
  },

  config: {
    API_BASE: 'https://hktrans.benlee630.workers.dev',
    directionCandidates: ['outbound', 'inbound', 2, 1],
    refreshMs: 60000,
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
      this.stopAutoRefresh();
      this.renderLoading();

      const parsed = this.parseQuery(q);
      this.state.route = parsed.route;
      this.state.stopText = parsed.stopText;

      const pack = await this.resolveRouteStop(parsed.route, parsed.stopText);
      if (!pack) throw new Error('No valid direction');

      this.applyRouteStopPack(pack);
      await this.refreshEta();
      this.pushHistory({
        route: this.state.route,
        stopName: this.state.stopName,
        direction: this.state.chosenDirection,
        ts: new Date().toISOString()
      });
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async handleDirectionChange(direction) {
    try {
      this.stopAutoRefresh();
      this.renderLoading();

      const pack = await this.resolveRouteStop(this.state.route, this.state.stopText, direction);
      if (!pack) throw new Error('No valid direction');

      this.applyRouteStopPack(pack);
      await this.refreshEta();
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  applyRouteStopPack(pack) {
    this.state.chosenDirection = pack.chosenDirection;
    this.state.availableDirections = pack.availableDirections || [];
    this.state.stopList = pack.stopList || [];
    this.state.chosenStop = pack.chosenStop;
    this.state.stopId = pack.stopId;
    this.state.stopName = pack.stopName;
    this.state.lastResolvedQuery = {
      route: this.state.route,
      stopId: pack.stopId,
      chosenDirection: pack.chosenDirection,
      stopName: pack.stopName
    };
  },

  async refreshEta() {
    if (!this.state.lastResolvedQuery || this.state.isRefreshing) return;
    this.state.isRefreshing = true;

    try {
      const { route, stopId } = this.state.lastResolvedQuery;
      const etaPack = await this.fetchEta(stopId, route);

      this.state.etaData = etaPack.raw;
      this.state.etas = etaPack.etas;
      this.state.sameStopRoutes = etaPack.sameStopRoutes;
      this.state.lastUpdated = new Date().toISOString();

      this.renderResult();
    } finally {
      this.state.isRefreshing = false;
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.state.refreshTimer = setInterval(() => this.refreshEta(), this.config.refreshMs);
  },

  stopAutoRefresh() {
    if (this.state.refreshTimer) clearInterval(this.state.refreshTimer);
    this.state.refreshTimer = null;
  },

  parseQuery(q) {
    const s = q.trim();
    const parts = s.split(/s+/);
    return {
      route: parts[0] || '',
      stopText: parts.slice(1).join(' ').trim()
    };
  },

  async resolveRouteStop(route, stopText, forcedDirection = null) {
    const directions = forcedDirection != null ? [forcedDirection] : this.config.directionCandidates;
    const found = [];

    for (const direction of directions) {
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

        found.push({
          chosenDirection: direction,
          stopList,
          chosenStop,
          stopId,
          stopName: chosenStop.name_tc || chosenStop.name_en || stopText || stopId
        });
      } catch (_) {}
    }

    if (!found.length) return null;
    if (found.length === 1) return {
      ...found[0],
      availableDirections: found.map(x => x.chosenDirection)
    };

    const preferred = found.find(x => this.matchesStopText(x.chosenStop, stopText)) || found[0];
    return {
      ...preferred,
      availableDirections: found.map(x => x.chosenDirection),
      allFound: found
    };
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
    return hay.includes(String(text || '').toUpperCase());
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
    this.dom.result.innerHTML = `<p class="muted">輸入路線及站名開始搜尋</p>`;
  },

  renderLoading() {
    this.dom.result.innerHTML = `<p class="muted">搜尋中...</p>`;
  },

  getDestinationLabel(s) {
    const stop = s.chosenStop || {};
    return (
      stop.dest_tc ||
      stop.dest_en ||
      stop.destination_tc ||
      stop.destination_en ||
      stop.name_tc ||
      stop.name_en ||
      s.stopName ||
      ''
    );
  },

  getDirectionLabel(direction) {
    if (direction === 'outbound' || String(direction) === '2') return '出方向';
    if (direction === 'inbound' || String(direction) === '1') return '入方向';
    return String(direction || '');
  },

  renderDirectionButtons() {
    const dirs = (this.state.availableDirections || []).slice(0, 2);
    if (!dirs.length) return '';

    return `
      <div style="display:flex; gap:8px; margin-top:10px;">
        ${dirs.map(d => `
          <button
            type="button"
            class="dir-btn ${String(d) === String(this.state.chosenDirection) ? 'active' : ''}"
            data-direction="${this.escapeHtml(String(d))}"
          >
            ${this.escapeHtml(this.getDirectionLabel(d))}
          </button>
        `).join('')}
      </div>
    `;
  },

  renderResult() {
    const s = this.state;
    const destination = this.getDestinationLabel(s);

    this.dom.result.innerHTML = `
      <div class="row">
        <strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(destination)}</strong>
      </div>

      ${this.renderDirectionButtons()}

      <div style="height:10px"></div>

      ${s.etas.map(item => `
        <div class="row">
          <span>${this.escapeHtml(item.label)}</span>
          <span>
            ${this.escapeHtml(item.time)}
            <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">
              (${this.escapeHtml(item.status)})
            </span>
          </span>
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
        <div class="row">
          <strong>同站其他路線</strong>
          <span class="small">最多 3 條</span>
        </div>
        ${s.sameStopRoutes.map(item => `
          <div class="row" style="font-size:14px">
            <span>${this.escapeHtml(item.route)}</span>
            <span>
              ${this.escapeHtml(item.time)}
              <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">
                (${this.escapeHtml(item.status)})
              </span>
            </span>
          </div>
        `).join('')}
      ` : ''}
    `;

    this.bindDirectionButtons();
  },

  bindDirectionButtons() {
    const buttons = this.dom.result.querySelectorAll('.dir-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const direction = btn.dataset.direction;
        if (!direction || String(direction) === String(this.state.chosenDirection)) return;
        await this.handleDirectionChange(direction);
      });
    });
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
    return d.toLocaleTimeString('zh-HK', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
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
