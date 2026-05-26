const app = {
  state: {
    route: '',
    stopText: '',
    chosenDirection: null,
    stopList: [],
    chosenStop: null,
    stopId: '',
    stopName: '',
    destName: '',
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
    directionCandidates: ['outbound', 'inbound'],
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
      this.state.chosenDirection = null;
      this.state.availableDirections = [];

      // Step 1: 攞路線目的地
      const routeMeta = await this.fetchRouteMeta(parsed.route);

      // Step 2: 兩個方向都試
      const found = await this.resolveAllDirections(parsed.route, parsed.stopText, routeMeta);
      if (!found.length) throw new Error('找不到相符路線或站點');

      // 保存兩邊方向
      this.state.availableDirections = found.map(x => x.chosenDirection);

      // 預設用第一個方向
      const preferred = found[0];
      await this.applyAndFetch(preferred, found);

      this.pushHistory({ route: this.state.route, stopName: this.state.stopName, direction: this.state.chosenDirection, ts: new Date().toISOString() });
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async handleDirectionChange(direction) {
    try {
      this.stopAutoRefresh();
      this.renderLoading();

      const routeMeta = await this.fetchRouteMeta(this.state.route);
      const found = await this.resolveAllDirections(this.state.route, this.state.stopText, routeMeta);
      if (!found.length) throw new Error('找不到相符路線');

      // 保持兩邊方向唔消失
      this.state.availableDirections = found.map(x => x.chosenDirection);

      const target = found.find(x => String(x.chosenDirection) === String(direction)) || found[0];
      await this.applyAndFetch(target, found);
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async applyAndFetch(pack, allFound) {
    this.state.chosenDirection = pack.chosenDirection;
    this.state.stopList = pack.stopList || [];
    this.state.chosenStop = pack.chosenStop;
    this.state.stopId = pack.stopId;
    this.state.stopName = pack.stopName;
    this.state.destName = pack.destName || '';
    this.state.availableDirections = allFound.map(x => x.chosenDirection);
    this.state.lastResolvedQuery = {
      route: this.state.route,
      stopId: pack.stopId,
      chosenDirection: pack.chosenDirection,
      stopName: pack.stopName
    };
    await this.refreshEta();
  },

  async fetchRouteMeta(route) {
    try {
      const url = `${this.config.API_BASE}/kmb/route/${encodeURIComponent(route)}`;
      const json = await this.fetchJson(url);
      const list = this.normalizeList(json);
      return list[0] || json || {};
    } catch (_) {
      return {};
    }
  },

  async resolveAllDirections(route, stopText, routeMeta) {
    const found = [];
    for (const direction of this.config.directionCandidates) {
      const url = `${this.config.API_BASE}/kmb/route-stop/${encodeURIComponent(route)}/${encodeURIComponent(direction)}/1`;
      try {
        const json = await this.fetchJson(url);
        const stopList = this.normalizeList(json);
        if (!stopList.length) continue;

        let chosenStop = null;
        if (stopText) {
          const enriched = await this.enrichStopNamesIfNeeded(stopList, stopText);
          chosenStop = enriched.find(s => this.matchesStopText(s, stopText)) || null;
        }
        if (!chosenStop) chosenStop = stopList[0];

        const stopId = chosenStop.stop || chosenStop.stop_id || chosenStop.id || '';
        if (!stopId) continue;

        const stopName = await this.resolveStopName(stopId, chosenStop);
        const destName = this.resolveDestName(direction, routeMeta);

        found.push({ chosenDirection: direction, stopList, chosenStop, stopId, stopName, destName });
      } catch (_) {}
    }
    return found;
  },

  async enrichStopNamesIfNeeded(stopList, stopText) {
    // 如果 stopText 係中文，就逐個打 stop API 攞 name_tc
    const hasChinese = /[\u4e00-\u9fff]/.test(stopText);
    if (!hasChinese) return stopList;

    const enriched = await Promise.all(
      stopList.map(async (s) => {
        const sid = s.stop || s.stop_id || s.id || '';
        if (!sid || s.name_tc) return s;
        try {
          const detail = await this.fetchStopDetail(sid);
          return { ...s, name_tc: detail.name_tc || '', name_en: detail.name_en || '' };
        } catch (_) {
          return s;
        }
      })
    );
    return enriched;
  },

  async resolveStopName(stopId, stopObj) {
    if (stopObj?.name_tc) return stopObj.name_tc;
    if (stopObj?.name_en) return stopObj.name_en;
    try {
      const detail = await this.fetchStopDetail(stopId);
      return detail.name_tc || detail.name_en || stopId;
    } catch (_) {
      return stopId;
    }
  },

  async fetchStopDetail(stopId) {
    const url = `${this.config.API_BASE}/kmb/stop/${encodeURIComponent(stopId)}`;
    const json = await this.fetchJson(url);
    const list = this.normalizeList(json);
    return list[0] || json?.data || json || {};
  },

  resolveDestName(direction, routeMeta) {
    const isOut = direction === 'outbound' || String(direction) === '2';
    if (isOut) return routeMeta?.dest_tc || routeMeta?.dest_en || '';
    return routeMeta?.orig_tc || routeMeta?.orig_en || '';
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
    const parts = s.split(/\s+/);
    return { route: parts[0] || '', stopText: parts.slice(1).join(' ').trim() };
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
      sameStopRoutes.push({ route: x.route, time: x.eta ? this.formatTime(x.eta) : '-', status: this.etaStatus(x) });
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
    const hay = [stop?.name_tc || '', stop?.name_en || '', stop?.dest_tc || '', stop?.stop || ''].join(' ').toUpperCase();
    return hay.includes(String(text || '').toUpperCase());
  },

  etaStatus(x) {
    const delay = Number(x?.delay || 0);
    return delay > 5 ? `延誤 ${delay} 分鐘` : '正常';
  },

  formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '-');
    return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
  },

  async fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${text.slice(0, 200)}`); }
  },

  renderIdle() {
    this.dom.result.innerHTML = `<p class="muted">輸入路線及站名開始搜尋</p>`;
  },

  renderLoading() {
    this.dom.result.innerHTML = `<p class="muted">搜尋中...</p>`;
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
      <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
        ${dirs.map(d => `
          <button type="button" class="dir-btn ${String(d) === String(this.state.chosenDirection) ? 'active' : ''}" data-direction="${this.escapeHtml(String(d))}">
            ${this.escapeHtml(this.getDirectionLabel(d))}
          </button>
        `).join('')}
      </div>
    `;
  },

  renderResult() {
    const s = this.state;
    this.dom.result.innerHTML = `
      <div class="row">
        <strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.destName || s.stopName || '')}</strong>
      </div>
      <div class="row" style="margin-top:4px;">
        <span class="small">站點：${this.escapeHtml(s.stopName || '')}</span>
        <span class="small">${this.escapeHtml(this.getDirectionLabel(s.chosenDirection))}</span>
      </div>
      ${this.renderDirectionButtons()}
      <div style="height:10px"></div>
      ${s.etas.length ? s.etas.map(item => `
        <div class="row">
          <span>${this.escapeHtml(item.label)}</span>
          <span>${this.escapeHtml(item.time)} <span class="${item.status.includes('延誤') ? 'badge-red' : 'badge-green'}">(${this.escapeHtml(item.status)})</span></span>
        </div>
      `).join('') : '<div class="row"><span class="muted">暫無班次資料</span></div>'}
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
      <div style="height:8px"></div>
      <div class="row"><span class="small">自動刷新</span><span class="small">${this.config.refreshMs / 1000} 秒</span></div>
    `;
    this.bindDirectionButtons();
  },

  bindDirectionButtons() {
    this.dom.result.querySelectorAll('.dir-btn').forEach(btn => {
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
