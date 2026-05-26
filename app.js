const providers = {
  kmb: {
    key: 'kmb',
    label: 'KMB / LWB',
    brandName: 'KMB / LWB',

    async fetchRouteMeta(route, app) {
      try {
        const json = await app.fetchJson(`https://data.etabus.gov.hk/v1/transport/kmb/route/${encodeURIComponent(route)}`);
        const list = app.normalizeList(json);
        return list[0] || json || {};
      } catch (_) {
        return {};
      }
    },

    async fetchStopMeta(stopId, app) {
      try {
        const json = await app.fetchJson(`https://data.etabus.gov.hk/v1/transport/kmb/stop/${encodeURIComponent(stopId)}`);
        return json?.data || json || {};
      } catch (_) {
        return {};
      }
    },

    async resolveAllDirections(route, stopText, routeMeta, app) {
      const found = [];
      for (const direction of ['outbound', 'inbound']) {
        const url = `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${encodeURIComponent(route)}/${encodeURIComponent(direction)}/1`;
        try {
          const json = await app.fetchJson(url);
          const stopList = app.normalizeList(json);
          if (!stopList.length) continue;

          const enrichedStopList = await app.enrichKmbStops(stopList, app);
          let chosenStop = null;

          if (stopText) chosenStop = enrichedStopList.find(s => app.matchesStopText(s, stopText)) || null;
          if (!chosenStop) chosenStop = enrichedStopList[0];
          if (!chosenStop) continue;

          const stopId = app.getRawStopId(chosenStop);
          if (!stopId) continue;

          const stopMeta = await this.fetchStopMeta(stopId, app);
          const stopName = app.getKmbStopName(chosenStop, stopMeta, stopId);
          const destName = this.resolveDestName(direction, routeMeta);

          found.push({
            chosenDirection: direction,
            stopList,
            enrichedStopList,
            chosenStop,
            stopMeta,
            stopId,
            stopName,
            destName
          });
        } catch (_) {}
      }
      return found;
    },

    resolveDestName(direction, routeMeta) {
      const isOut = direction === 'outbound' || String(direction) === '2';
      if (isOut) return routeMeta?.dest_tc || routeMeta?.dest_en || routeMeta?.dest || '';
      return routeMeta?.orig_tc || routeMeta?.orig_en || routeMeta?.orig || '';
    },

    async fetchEta(route, stopId, app) {
      const url = `https://data.etabus.gov.hk/v1/transport/kmb/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/1`;
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

  ctb: {
    key: 'ctb',
    label: 'Citybus',
    brandName: 'Citybus',

    async fetchRouteMeta(route, app) {
      const routeNo = String(route || '').trim().toUpperCase();
      const urls = [
        `https://rt.data.gov.hk/v2/transport/citybus/route/ctb/${encodeURIComponent(routeNo)}`,
        `https://rt.data.gov.hk/v2/transport/citybus/route/ctb/${encodeURIComponent(routeNo)}/1`
      ];
      for (const url of urls) {
        try {
          const json = await app.fetchJson(url);
          const meta = json?.data || json || {};
          if (meta && Object.keys(meta).length) return meta;
        } catch (_) {}
      }
      return {};
    },

    async fetchStopMeta(stopId, app) {
      try {
        const json = await app.fetchJson(`https://rt.data.gov.hk/v2/transport/citybus/stop/${encodeURIComponent(stopId)}`);
        return json?.data || json || {};
      } catch (_) {
        return {};
      }
    },

    async resolveAllDirections(route, stopText, routeMeta, app) {
      const routeNo = String(route || '').trim().toUpperCase();
      const routeData = routeMeta?.data || routeMeta || {};
      const directions = [
        { key: 'outbound', aliases: ['outbound', 'o', '2'] },
        { key: 'inbound', aliases: ['inbound', 'i', '1'] }
      ];
      const found = [];

      for (const d of directions) {
        const tried = [];
        const urls = [
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${d.key}`,
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${d.key}/1`,
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${d.key}/2`,
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${d.aliases[1]}`,
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${d.aliases[2]}`
        ];

        let stopList = [];
        let usedUrl = '';
        for (const u of urls) {
          tried.push(u);
          try {
            const json = await app.fetchJson(u);
            const list = app.normalizeList(json);
            if (list.length) {
              stopList = list;
              usedUrl = u;
              break;
            }
          } catch (_) {}
        }

        if (!stopList.length) {
          if (app.config.debug) app.debug.citybus.push({ stage: 'route-stop-empty', route: routeNo, direction: d.key, tried });
          continue;
        }

        const enrichedStopList = await app.enrichCitybusStops(stopList, app);

        let chosenStop = null;
        const stopTextNorm = String(stopText || '').trim().toUpperCase();
        if (stopTextNorm) {
          chosenStop = enrichedStopList.find(s => app.matchesStopText(s, stopTextNorm)) || null;
        }
        if (!chosenStop) chosenStop = enrichedStopList[0] || null;

        const stopId = app.getRawStopId(chosenStop);
        if (!stopId) {
          if (app.config.debug) app.debug.citybus.push({ stage: 'no-stopid', route: routeNo, direction: d.key, usedUrl });
          continue;
        }

        const stopMeta = await this.fetchStopMeta(stopId, app);
        const stopName = app.getCitybusStopName(chosenStop, stopMeta, stopId);
        const destName = this.resolveDestName(d.key, routeData);

        found.push({
          chosenDirection: d.key,
          stopList,
          enrichedStopList,
          chosenStop,
          stopMeta,
          stopId,
          stopName,
          destName,
          usedUrl
        });

        if (app.config.debug) app.debug.citybus.push({ stage: 'route-stop-ok', route: routeNo, direction: d.key, usedUrl, stopId, stopName, count: stopList.length });
      }

      return found;
    },

    resolveDestName(direction, routeMeta) {
      const d = String(direction || '').toLowerCase();
      const isOut = d === 'outbound' || d === 'o' || d === '2';
      return isOut ? (routeMeta?.dest_tc || routeMeta?.dest_en || routeMeta?.dest || '') : (routeMeta?.orig_tc || routeMeta?.orig_en || routeMeta?.orig || '');
    },

    async fetchEta(route, stopId, app) {
      const routeNo = String(route || '').trim().toUpperCase();
      const urls = [
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}/1`,
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}/2`,
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}?service_type=1`,
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}/?service_type=1`
      ];

      let raw = [];
      let usedUrl = '';
      for (const u of urls) {
        try {
          const json = await app.fetchJson(u);
          const list = app.normalizeList(json);
          if (list.length) {
            raw = list;
            usedUrl = u;
            break;
          }
        } catch (_) {}
      }

      if (app.config.debug) app.debug.citybus.push({ stage: 'eta-fetch', route: routeNo, stopId, usedUrl, count: raw.length });

      const matched = raw.filter(x => String(x?.route || '').toUpperCase() === routeNo && x?.eta);
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
        if (!r || r === routeNo || seen.has(r)) continue;
        seen.add(r);
        sameStopRoutes.push({
          route: x.route,
          time: x.eta ? app.formatTime(x.eta) : '-',
          status: app.etaStatus(x)
        });
        if (sameStopRoutes.length >= 3) break;
      }

      return { raw, etas, sameStopRoutes, usedUrl };
    }
  },

  mtrBus: {
    key: 'mtrBus',
    label: 'MTR Bus',
    brandName: 'MTR Bus',
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
    maxFavorites: 8,
    debug: false
  },

  debug: { citybus: [] },

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

  getProvider() {
    return providers[this.state.providerKey] || null;
  },

  getRouteKey(route) {
    const p = this.getProvider();
    return p?.routeKey ? p.routeKey(route) : `${this.state.providerKey}:${String(route || '').toUpperCase()}`;
  },

  getRawStopId(stop) {
    return stop?.__rawStopId || stop?.stop || stop?.stop_id || stop?.id || stop?.stopId || stop?.stopID || '';
  },

  normalizeText(v) {
    return String(v || '').trim().toUpperCase();
  },

  getKmbStopName(stop, stopMeta, stopId) {
    return (
      stopMeta?.data?.stop_name_tc ||
      stopMeta?.data?.name_tc ||
      stopMeta?.stop_name_tc ||
      stopMeta?.name_tc ||
      stop?.stop_name_tc ||
      stop?.STOP_NAMEC ||
      stop?.name_tc ||
      stop?.name ||
      stopMeta?.data?.stop_name_en ||
      stopMeta?.data?.name_en ||
      stopMeta?.stop_name_en ||
      stopMeta?.name_en ||
      stop?.stop_name_en ||
      stop?.STOP_NAMEE ||
      stop?.name_en ||
      stopId ||
      ''
    );
  },

  getCitybusStopName(stop, stopMeta, stopId) {
    return (
      stopMeta?.name_tc ||
      stopMeta?.stop_name_tc ||
      stopMeta?.data?.name_tc ||
      stopMeta?.data?.stop_name_tc ||
      stop?.stop_name_tc ||
      stop?.name_tc ||
      stop?.STOP_NAMEC ||
      stop?.name ||
      stopMeta?.name_en ||
      stopMeta?.stop_name_en ||
      stopMeta?.data?.name_en ||
      stopMeta?.data?.stop_name_en ||
      stop?.stop_name_en ||
      stop?.name_en ||
      stop?.STOP_NAMEE ||
      stopId ||
      ''
    );
  },

  getStopDisplayName(stop, stopId, providerKey = '') {
    const isCitybus = providerKey === 'ctb';
    if (isCitybus) return this.getCitybusStopName(stop, stop?.__stopMeta || {}, stopId);
    return this.getKmbStopName(stop, stop?.__stopMeta || {}, stopId);
  },

  renderTransportPicker() {
    return `
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <button type="button" class="transport-btn ${this.state.transportType === 'bus' ? 'active' : ''}" data-transport="bus">巴士</button>
        <button type="button" class="transport-btn ${this.state.transportType === 'mtr' ? 'active' : ''}" data-transport="mtr">MTR</button>
        <button type="button" class="transport-btn ${this.state.transportType === 'other' ? 'active' : ''}" data-transport="other">城巴</button>
      </div>
    `;
  },

  renderShellMessage() {
    return this.state.transportSelected ? '輸入路線開始搜尋' : '請先揀交通工具';
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

  async handleSearch(q) {
    try {
      this.debug.citybus = [];
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
        routeKey: this.getRouteKey(this.state.route),
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

      const provider = this.getProvider();
      const chosenStop = (this.state.enrichedStopList || []).find(s => this.getRawStopId(s) === stopId);
      if (!chosenStop) throw new Error('找不到站點');

      let stopMeta = chosenStop.__stopMeta || {};
      if (provider?.key === 'kmb' && provider.fetchStopMeta) stopMeta = await provider.fetchStopMeta(stopId, this);
      if (provider?.key === 'ctb' && provider.fetchStopMeta) stopMeta = await provider.fetchStopMeta(stopId, this);
      chosenStop.__stopMeta = stopMeta;

      const stopName = this.getStopDisplayName(chosenStop, stopId, provider?.key || '');
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
      if (!p || !p.fetchEta) throw new Error('請先揀交通工具');

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
    const parts = s.split(/s+/);
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
    const hay = [
      stop?.stop_name_tc || '',
      stop?.STOP_NAMEC || '',
      stop?.name_tc || '',
      stop?.name || '',
      stop?.stop_name_en || '',
      stop?.STOP_NAMEE || '',
      stop?.name_en || '',
      stop?.__rawStopId || '',
      stop?.__seq || '',
      stop?.stop || '',
      stop?.stopId || ''
    ].join(' ').toUpperCase();
    return hay.includes(this.normalizeText(text));
  },

  async enrichKmbStops(stopList, app) {
    const list = await Promise.all(stopList.map(async (s, idx) => {
      const stopId = app.getRawStopId(s);
      let stopMeta = {};
      if (stopId) {
        try {
          const json = await app.fetchJson(`https://data.etabus.gov.hk/v1/transport/kmb/stop/${encodeURIComponent(stopId)}`);
          stopMeta = json?.data || json || {};
        } catch (_) {}
      }
      const stopName = app.getKmbStopName(s, stopMeta, stopId);
      return {
        ...s,
        __seq: String(s.__seq || s.seq || s.sequence || s.stop_seq || idx + 1),
        __stopMeta: stopMeta,
        stop_name_tc: stopMeta?.stop_name_tc || stopMeta?.name_tc || s.stop_name_tc || s.STOP_NAMEC || s.name_tc || s.name || '',
        stop_name_en: stopMeta?.stop_name_en || stopMeta?.name_en || s.stop_name_en || s.STOP_NAMEE || s.name_en || '',
        name_tc: stopMeta?.stop_name_tc || stopMeta?.name_tc || s.name_tc || s.STOP_NAMEC || s.name || '',
        name_en: stopMeta?.stop_name_en || stopMeta?.name_en || s.name_en || s.STOP_NAMEE || s.name || '',
        display_name: stopName
      };
    }));
    return list;
  },

  async enrichCitybusStops(stopList, app) {
    const list = await Promise.all(stopList.map(async (s, idx) => {
      const stopId = app.getRawStopId(s);
      let stopMeta = {};
      if (stopId) {
        try {
          const json = await app.fetchJson(`https://rt.data.gov.hk/v2/transport/citybus/stop/${encodeURIComponent(stopId)}`);
          stopMeta = json?.data || json || {};
        } catch (_) {}
      }
      const stopName = app.getCitybusStopName(s, stopMeta, stopId);
      return {
        ...s,
        __seq: String(s.__seq || s.seq || s.sequence || s.stop_seq || idx + 1),
        __stopMeta: stopMeta,
        stop_name_tc: stopMeta?.name_tc || stopMeta?.stop_name_tc || s.stop_name_tc || s.name_tc || s.STOP_NAMEC || '',
        stop_name_en: stopMeta?.name_en || stopMeta?.stop_name_en || s.stop_name_en || s.name_en || s.STOP_NAMEE || '',
        name_tc: stopMeta?.name_tc || stopMeta?.stop_name_tc || s.name_tc || s.STOP_NAMEC || '',
        name_en: stopMeta?.name_en || stopMeta?.stop_name_en || s.name_en || s.STOP_NAMEE || '',
        display_name: stopName
      };
    }));
    return list;
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 350)}`);
    return JSON.parse(text);
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
    const providerKey = this.state.providerKey;

    return `
      <div style="margin-top:10px;">
        <label class="small" style="display:block; margin-bottom:4px;">選擇站點</label>
        <select id="stopSelect" style="width:100%; padding:8px; border-radius:8px; background:#1e1e1e; color:#fff; border:1px solid #333; font-size:14px;">
          ${stops.map(s => {
            const sid = this.getRawStopId(s);
            const label = s.display_name || this.getStopDisplayName(s, sid, providerKey);
            return `<option value="${this.escapeHtml(sid)}" ${sid === currentId ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  },

  renderResult() {
    const s = this.state;
    const providerKey = this.state.providerKey;

    this.dom.result.innerHTML = `
      ${this.renderTransportPicker()}
      <div class="row"><strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.destName || s.stopName || '')}</strong></div>
      <div class="row" style="margin-top:4px;"><span class="small">查詢 key：${this.escapeHtml(this.getRouteKey(s.route))}</span></div>
      <div class="row" style="margin-top:4px;"><span class="small">營辦商：${this.escapeHtml(s.brandName || '')}</span></div>
      <div class="row" style="margin-top:4px;"><span class="small">站點：${this.escapeHtml(this.getStopDisplayName(s.chosenStop, s.stopId, providerKey))}</span><span class="small">${this.escapeHtml(this.getDirectionLabel(s.chosenDirection))}</span></div>
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
        if (type === 'bus') this.state.providerKey = 'kmb';
        else if (type === 'mtr') this.state.providerKey = 'mtrBus';
        else this.state.providerKey = 'ctb';

        this.state.transportSelected = true;
        this.state.chosenDirection = null;
        this.state.availableDirections = [];
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

  getDirectionLabel(direction) {
    if (direction === 'outbound' || String(direction) === '2') return '出方向';
    if (direction === 'inbound' || String(direction) === '1') return '入方向';
    return String(direction || '');
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
