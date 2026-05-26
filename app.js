const providers = {
  kmb: {
    key: 'kmb',
    label: 'KMB / LWB',
    brandName: 'KMB / LWB',
    routeKey(route) {
      return `kmb:${String(route || '').toUpperCase()}`;
    },
    async fetchRouteMeta(route, app) {
      try {
        const json = await app.fetchJson(`${app.config.API_BASE}/kmb/route/${encodeURIComponent(route)}`);
        const list = app.normalizeList(json);
        return list[0] || json || {};
      } catch (_) {
        return {};
      }
    },
    async resolveAllDirections(route, stopText, routeMeta, app) {
      const found = [];
      for (const direction of ['outbound', 'inbound']) {
        const url = `${app.config.API_BASE}/kmb/route-stop/${encodeURIComponent(route)}/${encodeURIComponent(direction)}/1`;
        try {
          const json = await app.fetchJson(url);
          const stopList = app.normalizeList(json);
          if (!stopList.length) continue;
          const enrichedStopList = await app.enrichAllStopNames(stopList);
          let chosenStop = null;
          if (stopText) chosenStop = enrichedStopList.find(s => app.matchesStopText(s, stopText)) || null;
          if (!chosenStop) chosenStop = enrichedStopList[0];
          const stopId = chosenStop.stop || chosenStop.stop_id || chosenStop.id || '';
          if (!stopId) continue;
          const stopName = chosenStop.name_tc || chosenStop.name_en || stopId;
          const destName = this.resolveDestName(direction, routeMeta);
          found.push({ chosenDirection: direction, stopList, enrichedStopList, chosenStop, stopId, stopName, destName });
        } catch (_) {}
      }
      return found;
    },
    resolveDestName(direction, routeMeta) {
      const isOut = direction === 'outbound' || String(direction) === '2';
      if (isOut) return routeMeta?.dest_tc || routeMeta?.dest_en || '';
      return routeMeta?.orig_tc || routeMeta?.orig_en || '';
    },
    async fetchEta(route, stopId, app) {
      const url = `${app.config.API_BASE}/kmb/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/1`;
      const json = await app.fetchJson(url);
      const raw = app.normalizeList(json);
      const routeUpper = String(route).toUpperCase();
      const matched = raw.filter(x => String(x?.route || '').toUpperCase() === routeUpper && x?.eta);
      const etas = matched.slice(0, 3).map((x, idx) => ({
        label: idx === 0 ? '下 1 班' : idx === 1 ? '下 2 班' : '下 3 班',
        time: app.formatTime(x.eta),
        status: app.etaStatus(x),
        rawEta: x.eta
      }));
      const sameStopRoutes = [];
      const seen = new Set();
      for (const x of raw) {
        const r = String(x?.route || '').toUpperCase();
        if (!r || r === routeUpper || seen.has(r)) continue;
        seen.add(r);
        sameStopRoutes.push({ route: x.route, time: x.eta ? app.formatTime(x.eta) : '-', status: app.etaStatus(x) });
        if (sameStopRoutes.length >= 3) break;
      }
      return { raw, etas, sameStopRoutes };
    }
  },

  ctb: {
    key: 'ctb',
    label: 'Citybus',
    brandName: 'Citybus',
    routeKey(route) {
      return `ctb:${String(route || '').toUpperCase()}`;
    },

    async fetchRouteMeta(route, app) {
      try {
        const json = await app.fetchJson(`https://rt.data.gov.hk/v2/transport/citybus/route/ctb/${encodeURIComponent(route)}`);
        const list = app.normalizeList(json);
        return list[0] || json || {};
      } catch (_) {
        return {};
      }
    },

    async resolveAllDirections(route, stopText, routeMeta, app) {
      const routeUpper = String(route || '').toUpperCase();
      const base = `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(route)}`;
      const directionsToTry = ['outbound', 'inbound', 'I', 'O', '1', '2'];

      const tryOne = async (direction) => {
        const url = `${base}/${encodeURIComponent(direction)}`;
        const json = await app.fetchJson(url);
        const stopList = app.normalizeList(json);
        if (!stopList.length) return null;

        const enrichedStopList = stopList.map(s => ({
          ...s,
          name_tc: s.name_tc || s.stop_name_tc || s.name || '',
          name_en: s.name_en || s.stop_name_en || ''
        }));

        let chosenStop = null;
        if (stopText) chosenStop = enrichedStopList.find(s => app.matchesStopText(s, stopText)) || null;
        if (!chosenStop) chosenStop = enrichedStopList[0];

        const stopId = chosenStop.stop || chosenStop.stop_id || chosenStop.id || chosenStop.stopId || '';
        if (!stopId) return null;

        const stopName = chosenStop.name_tc || chosenStop.name_en || chosenStop.name || stopId;
        const destName = this.resolveDestName(direction, routeMeta);

        return { chosenDirection: direction, stopList, enrichedStopList, chosenStop, stopId, stopName, destName };
      };

      const found = [];
      for (const direction of directionsToTry) {
        try {
          const pack = await tryOne(direction);
          if (pack) found.push(pack);
        } catch (_) {}
      }

      const unique = [];
      const seen = new Set();
      for (const item of found) {
        const key = `${String(item.chosenDirection)}:${String(item.stopId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
      }
      return unique;
    },

    resolveDestName(direction, routeMeta) {
      const d = String(direction || '').toLowerCase();
      const isOut = d === 'outbound' || d === 'o' || d === '2';
      if (isOut) return routeMeta?.dest_en || routeMeta?.dest_tc || '';
      return routeMeta?.orig_en || routeMeta?.orig_tc || '';
    },

    async fetchEta(route, stopId, app) {
      const url = `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/1`;
      const json = await app.fetchJson(url);
      const raw = app.normalizeList(json);

      const routeUpper = String(route || '').toUpperCase();
      const matched = raw.filter(x => String(x?.route || '').toUpperCase() === routeUpper && x?.eta);

      const etas = matched.slice(0, 3).map((x, idx) => ({
        label: idx === 0 ? '下 1 班' : idx === 1 ? '下 2 班' : '下 3 班',
        time: app.formatTime(x.eta),
        status: app.etaStatus(x),
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
          time: x.eta ? app.formatTime(x.eta) : '-',
          status: app.etaStatus(x)
        });
        if (sameStopRoutes.length >= 3) break;
      }

      return { raw, etas, sameStopRoutes };
    }
  },

  mtrBus: {
    key: 'mtrBus',
    label: 'MTR Bus',
    brandName: 'MTR Bus',
    routeKey(route) {
      return `mtrBus:${String(route || '').toUpperCase()}`;
    },
    async fetchRouteMeta() { return {}; },
    async resolveAllDirections() { return []; },
    async fetchEta() { return { raw: [], etas: [], sameStopRoutes: [] }; }
  }
};

const app = {
  state: {
    transportType: '',
    providerKey: '',
    route: '',
    stopText: '',
    chosenDirection: null,
    stopList: [],
    enrichedStopList: [],
    chosenStop: null,
    stopId: '',
    stopName: '',
    destName: '',
    brandName: '',
    etaData: [],
    etas: [],
    sameStopRoutes: [],
    favorites: [],
    history: [],
    lastUpdated: null,
    isRefreshing: false,
    refreshTimer: null,
    lastResolvedQuery: null,
    availableDirections: [],
    transportSelected: false
  },

  config: {
    API_BASE: 'https://hktrans.benlee630.workers.dev',
    refreshMs: 60000,
    maxHistory: 8,
    maxFavorites: 8
  },

  init() {
    this.cacheDom();
    this.bindEvents();
    this.loadPersistedState();
    this.renderShell();
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

      if (!this.state.transportSelected) {
        this.renderMessage('請先揀交通工具');
        return;
      }

      await this.handleSearch(q);
    });
  },

  getProvider() {
    return providers[this.state.providerKey] || null;
  },

  renderShell() {
    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row" style="margin-top:10px;">
        <span class="muted">請先揀交通工具，再輸入路線同站名</span>
      </div>
    `;
    this.bindTransportButtons();
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

      const provider = this.getProvider();
      if (!provider) throw new Error('請先揀交通工具');

      const routeMeta = await provider.fetchRouteMeta(parsed.route, this);
      const found = await provider.resolveAllDirections(parsed.route, parsed.stopText, routeMeta, this);
      if (!found.length) throw new Error('找不到相符路線或站點');

      this.state.availableDirections = found.map(x => x.chosenDirection);
      await this.applyAndFetch(found[0], found, provider);

      this.pushHistory({
        routeKey: provider.routeKey ? provider.routeKey(parsed.route) : `${this.state.providerKey}:${parsed.route}`,
        route: this.state.route,
        stopName: this.state.stopName,
        direction: this.state.chosenDirection,
        provider: this.state.providerKey,
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

      const provider = this.getProvider();
      if (!provider) throw new Error('請先揀交通工具');

      const routeMeta = await provider.fetchRouteMeta(this.state.route, this);
      const found = await provider.resolveAllDirections(this.state.route, this.state.stopText, routeMeta, this);
      if (!found.length) throw new Error('找不到相符路線');

      this.state.availableDirections = found.map(x => x.chosenDirection);
      const target = found.find(x => String(x.chosenDirection) === String(direction)) || found[0];

      await this.applyAndFetch(target, found, provider);
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async handleStopChange(stopId) {
    try {
      this.stopAutoRefresh();
      this.renderLoading();

      const chosenStop = (this.state.enrichedStopList || []).find(s => (s.stop || s.stop_id || s.id) === stopId);
      if (!chosenStop) throw new Error('找不到站點');

      const stopName = chosenStop.name_tc || chosenStop.name_en || stopId;
      this.state.chosenStop = chosenStop;
      this.state.stopId = stopId;
      this.state.stopName = stopName;
      this.state.lastResolvedQuery = {
        route: this.state.route,
        stopId,
        chosenDirection: this.state.chosenDirection,
        stopName
      };

      await this.refreshEta();
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async applyAndFetch(pack, allFound, provider) {
    this.state.chosenDirection = pack.chosenDirection;
    this.state.stopList = pack.stopList || [];
    this.state.enrichedStopList = pack.enrichedStopList || pack.stopList || [];
    this.state.chosenStop = pack.chosenStop;
    this.state.stopId = pack.stopId;
    this.state.stopName = pack.stopName;
    this.state.destName = pack.destName || '';
    this.state.brandName = provider?.brandName || '';
    this.state.availableDirections = allFound.map(x => x.chosenDirection);
    this.state.lastResolvedQuery = {
      route: this.state.route,
      stopId: pack.stopId,
      chosenDirection: pack.chosenDirection,
      stopName: pack.stopName
    };
    await this.refreshEta(provider);
  },

  async refreshEta(provider = null) {
    if (!this.state.lastResolvedQuery || this.state.isRefreshing) return;
    this.state.isRefreshing = true;

    try {
      const p = provider || this.getProvider();
      const { route, stopId } = this.state.lastResolvedQuery;
      if (!p || !p.fetchEta) throw new Error('暫未支援此交通工具');

      const etaPack = await p.fetchEta(route, stopId, this);
      this.state.etaData = etaPack.raw || [];
      this.state.etas = etaPack.etas || [];
      this.state.sameStopRoutes = etaPack.sameStopRoutes || [];
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
    return {
      route: parts[0] || '',
      stopText: parts.slice(1).join(' ').trim()
    };
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

  async enrichAllStopNames(stopList) {
    return Promise.all(stopList.map(async (s) => {
      const sid = s.stop || s.stop_id || s.id || '';
      if (!sid || s.name_tc) return s;
      try {
        const detail = await this.fetchStopDetail(sid);
        return { ...s, name_tc: detail.name_tc || '', name_en: detail.name_en || '' };
      } catch (_) {
        return s;
      }
    }));
  },

  async fetchStopDetail(stopId) {
    const url = `${this.config.API_BASE}/kmb/stop/${encodeURIComponent(stopId)}`;
    const json = await this.fetchJson(url);
    const list = this.normalizeList(json);
    return list[0] || json?.data || json || {};
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

  formatClock(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
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

  renderTransportPicker() {
    return `
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <button type="button" class="transport-btn ${this.state.transportType === 'bus' ? 'active' : ''}" data-transport="bus">巴士</button>
        <button type="button" class="transport-btn ${this.state.transportType === 'mtr' ? 'active' : ''}" data-transport="mtr">MTR</button>
        <button type="button" class="transport-btn ${this.state.transportType === 'other' ? 'active' : ''}" data-transport="other">其他</button>
      </div>
    `;
  },

  renderShellMessage() {
    if (!this.state.transportSelected) return '請先揀交通工具，再輸入路線同站名';
    return '輸入路線開始搜尋';
  },

  renderIdle() {
    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row" style="margin-top:10px;">
        <span class="muted">${this.renderShellMessage()}</span>
      </div>
    `;
    this.bindTransportButtons();
  },

  renderLoading() {
    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row" style="margin-top:10px;">
        <span class="muted">搜尋中...</span>
      </div>
    `;
    this.bindTransportButtons();
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

  renderStopDropdown() {
    const stops = this.state.enrichedStopList || [];
    if (!stops.length) return '';
    const currentId = this.state.stopId || '';
    return `
      <div style="margin-top:10px;">
        <label class="small" style="display:block; margin-bottom:4px;">選擇站點</label>
        <select id="stopSelect" style="width:100%; padding:8px; border-radius:8px; background:#1e1e1e; color:#fff; border:1px solid #333; font-size:14px;">
          ${stops.map((s, idx) => {
            const sid = s.stop || s.stop_id || s.id || '';
            const label = s.name_tc || s.name_en || sid;
            return `<option value="${this.escapeHtml(sid)}" ${sid === currentId ? 'selected' : ''}>${idx + 1}. ${this.escapeHtml(label)}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  },

  renderResult() {
    const s = this.state;
    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row">
        <strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.destName || s.stopName || '')}</strong>
      </div>
      <div class="row" style="margin-top:4px;">
        <span class="small">營辦商：${this.escapeHtml(s.brandName || '')}</span>
      </div>
      <div class="row" style="margin-top:4px;">
        <span class="small">站點：${this.escapeHtml(s.stopName || '')}</span>
        <span class="small">${this.escapeHtml(this.getDirectionLabel(s.chosenDirection))}</span>
      </div>
      ${this.renderDirectionButtons()}
      ${this.renderStopDropdown()}
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
      <div class="row">
        <span class="small">自動刷新</span>
        <span class="small">${this.config.refreshMs / 1000} 秒</span>
      </div>
    `;
    this.bindTransportButtons();
    this.bindDirectionButtons();
    this.bindStopDropdown();
  },

  bindTransportButtons() {
    this.dom.result.querySelectorAll('.transport-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.transport;
        if (!type) return;
        this.state.transportType = type;
        this.state.providerKey = type === 'bus' ? 'kmb' : type;
        this.state.transportSelected = true;
        this.renderIdle();
      });
    });
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

  bindStopDropdown() {
    const sel = this.dom.result.querySelector('#stopSelect');
    if (!sel) return;
    sel.addEventListener('change', async () => {
      const stopId = sel.value;
      if (!stopId || stopId === this.state.stopId) return;
      await this.handleStopChange(stopId);
    });
  },

  renderMessage(msg) {
    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row" style="margin-top:10px;">
        <span class="muted">${this.escapeHtml(msg)}</span>
      </div>
    `;
    this.bindTransportButtons();
  },

  renderError(err) {
    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row" style="margin-top:10px;">
        <strong>⚠️ 無實時數據</strong>
        <span class="small">${this.escapeHtml(err.message || 'Unknown error')}</span>
      </div>
    `;
    this.bindTransportButtons();
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
