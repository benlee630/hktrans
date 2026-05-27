const providers = {
  kmb: {
    key: 'kmb',
    label: '巴士',
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
      const routeUpper = String(route || '').toUpperCase();
      const url = `https://data.etabus.gov.hk/v1/transport/kmb/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(routeUpper)}/1`;
      const json = await app.fetchJson(url);
      const raw = app.normalizeList(json);

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
    label: '巴士',
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

        if (!stopList.length) continue;

        const enrichedStopList = await app.enrichCitybusStops(stopList, app);

        let chosenStop = null;
        const stopTextNorm = String(stopText || '').trim().toUpperCase();
        if (stopTextNorm) chosenStop = enrichedStopList.find(s => app.matchesStopText(s, stopTextNorm)) || null;
        if (!chosenStop) chosenStop = enrichedStopList[0] || null;

        const stopId = app.getRawStopId(chosenStop);
        if (!stopId) continue;

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

  mtr: {
    key: 'mtr',
    label: 'MTR',
    brandName: 'MTR',
    async fetchRouteMeta(route, app) {
      try {
        const json = await app.fetchJson('https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities');
        return json || {};
      } catch (_) {
        return {};
      }
    },
    async fetchStopMeta() { return {}; },

    async resolveAllDirections(route, stopText, routeMeta, app) {
      const q = String(route || '').trim();
      if (!q) return [];
      const upper = q.toUpperCase();

      let mtrMeta = {};
      try {
        mtrMeta = await app.loadMtrDataset();
      } catch (_) {}

      const candidates = app.searchMtrCandidates(upper, stopText, mtrMeta);
      return candidates.slice(0, 5).map(c => ({
        chosenDirection: 'mtr',
        stopList: [],
        enrichedStopList: [],
        chosenStop: null,
        stopMeta: {},
        stopId: c.stationCode || c.lineCode || c.key,
        stopName: c.title,
        destName: c.subtitle,
        usedUrl: '',
        mtrInfo: c.info,
        mtrType: c.type,
        mtrTitle: c.title,
        mtrSubtitle: c.subtitle,
        mtrFare: c.fare,
        mtrAccess: c.access
      }));
    },

    async fetchEta(route, stopId, app) {
      const line = String(route || '').trim().toUpperCase();
      const result = [];
      try {
        const schedule = await app.fetchJson(`https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule?line=${encodeURIComponent(line)}`);
        const items = app.normalizeMtrBusSchedule(schedule, line);
        for (const item of items.slice(0, 3)) {
          result.push(item);
        }
      } catch (_) {}
      if (!result.length) {
        result.push({
          label: 'MTR',
          time: route || '-',
          status: '資料集',
          rawEta: route || '-'
        });
      }
      return { raw: [], etas: result, sameStopRoutes: [] };
    }
  },

  gmb: {
    key: 'gmb',
    label: '小巴',
    brandName: '綠色小巴',
    async fetchRouteMeta(route, app) {
      try {
        const json = await app.fetchJson('https://data.gov.hk/en-data/dataset/hk-td-sm_7-real-time-arrival-data-of-gmb');
        return json || {};
      } catch (_) {
        return {};
      }
    },
    async fetchStopMeta() { return {}; },

    async resolveAllDirections(route, stopText, routeMeta, app) {
      const q = String(route || '').trim().toUpperCase();
      if (!q) return [];

      const found = [];
      try {
        const stopListJson = await app.fetchJson('https://data.gov.hk/en-data/dataset/hk-td-sm_7-real-time-arrival-data-of-gmb/resource/b22d3e1a-78a2-40fa-a939-d2dbe5a9a27f');
        const routeListJson = await app.fetchJson('https://data.gov.hk/en-data/dataset/hk-td-sm_7-real-time-arrival-data-of-gmb/resource/40969f4e-6542-49de-aff8-4a307552e9d7');
        const etaJson = await app.fetchJson('https://data.gov.hk/en-data/dataset/hk-td-sm_7-real-time-arrival-data-of-gmb/resource/09d817d8-470a-4d12-82ff-c09555360c97');

        const routeList = app.normalizeList(routeListJson);
        const etaList = app.normalizeList(etaJson);
        const stopList = app.normalizeList(stopListJson);

        const matches = app.findGmbMatches(q, stopText, routeList, etaList, stopList);

        if (!matches.length) {
          found.push({
            chosenDirection: 'gmb',
            stopList: [],
            enrichedStopList: [],
            chosenStop: null,
            stopMeta: {},
            stopId: q,
            stopName: q,
            destName: q,
            usedUrl: '',
            gmbInfo: ''
          });
        } else {
          for (const m of matches.slice(0, 5)) {
            found.push({
              chosenDirection: 'gmb',
              stopList: [],
              enrichedStopList: [],
              chosenStop: null,
              stopMeta: {},
              stopId: m.stopId,
              stopName: m.stopName,
              destName: m.routeName,
              usedUrl: '',
              gmbInfo: '',
              gmbRoute: m.route,
              gmbStop: m.stopName,
              gmbEtaHint: m.etaText,
              gmbRouteList: m.routeList
            });
          }
        }
      } catch (_) {
        found.push({
          chosenDirection: 'gmb',
          stopList: [],
          enrichedStopList: [],
          chosenStop: null,
          stopMeta: {},
          stopId: q,
          stopName: q,
          destName: q,
          usedUrl: '',
          gmbInfo: ''
        });
      }
      return found;
    },

    async fetchEta(route, stopId, app) {
      const q = String(route || '').trim().toUpperCase();
      const result = [];
      try {
        const etaJson = await app.fetchJson('https://data.gov.hk/en-data/dataset/hk-td-sm_7-real-time-arrival-data-of-gmb/resource/09d817d8-470a-4d12-82ff-c09555360c97');
        const etaList = app.normalizeList(etaJson);
        const filtered = etaList.filter(x => {
          const r = String(x?.route || x?.route_name || x?.routeId || '').toUpperCase();
          const sid = String(x?.stop_id || x?.stopId || x?.stop || '').toUpperCase();
          return (!q || r.includes(q)) && (!stopId || sid === String(stopId).toUpperCase());
        });

        filtered.slice(0, 3).forEach((x, idx) => {
          result.push({
            label: idx === 0 ? '下 1 班' : idx === 1 ? '下 2 班' : '下 3 班',
            time: x?.eta || x?.arrival_time || x?.time || '-',
            status: '正常',
            rawEta: x?.eta || x?.arrival_time || x?.time || '-'
          });
        });
      } catch (_) {}

      if (!result.length) {
        result.push({
          label: 'GMB',
          time: route || '-',
          status: '資料集',
          rawEta: route || '-'
        });
      }
      return { raw: [], etas: result, sameStopRoutes: [] };
    }
  }
};

const app = {
  state: {
    transportType: 'bus',
    providerKey: 'kmb',
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
    transportSelected: true,
    viewMode: 'bus'
  },

  config: {
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
    this.dom.form.addEventListener('submit', async e => {
      e.preventDefault();
      const q = this.dom.input.value.trim();
      if (!q) return;
      await this.handleSearch(q);
    });
  },

  getProvider() { return providers[this.state.providerKey] || null; },

  getRawStopId(stop) {
    return stop?.__rawStopId || stop?.stop || stop?.stop_id || stop?.id || stop?.stopId || stop?.stopID || '';
  },

  normalizeText(v) { return String(v || '').trim().toUpperCase(); },

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

  async loadMtrDataset() {
    if (this._mtrDataset) return this._mtrDataset;
    try {
      const [lines, fares, access] = await Promise.all([
        this.fetchCsvFromDataGov('https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities/resource/73895cac-ac2e-4fec-8525-4f5f1be0a718'),
        this.fetchCsvFromDataGov('https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities/resource/91e47c22-3e5d-40fe-a779-308be439c41f'),
        this.fetchCsvFromDataGov('https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities/resource/b015068c-bc60-4c60-8c6e-6c601fa8011d')
      ]);
      this._mtrDataset = { lines, fares, access };
      return this._mtrDataset;
    } catch (_) {
      this._mtrDataset = { lines: [], fares: [], access: [] };
      return this._mtrDataset;
    }
  },

  async fetchCsvFromDataGov(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const text = await res.text();
      const csv = text.includes(',') ? text : '';
      return this.parseCsv(csv);
    } catch (_) {
      return [];
    }
  },

  parseCsv(csv) {
    const lines = String(csv || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = this.splitCsvLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map(line => {
      const cols = this.splitCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] ?? '');
      return obj;
    });
  },

  splitCsvLine(line) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  },

  searchMtrCandidates(q, stopText, mtrMeta) {
    const needle = this.normalizeText(q + ' ' + stopText);
    const pool = [];

    const mergeRow = (row, type) => {
      const text = JSON.stringify(row);
      if (needle && !this.normalizeText(text).includes(needle) && !this.normalizeText(Object.values(row).join(' ')).includes(needle)) return;
      pool.push({
        type,
        key: row['Line'] || row['Line Code'] || row['Station'] || row['Station Code'] || row['Route'] || needle,
        title: row['Line'] || row['Line Name'] || row['Station'] || row['Station Name'] || row['Route'] || q,
        subtitle: row['Station'] || row['Station Name'] || row['Destination'] || row['Dest'] || row['Fare'] || '',
        lineCode: row['Line Code'] || row['Line'] || '',
        stationCode: row['Station Code'] || row['Station'] || '',
        fare: row['Fare'] || row['Adult Fare'] || row['Price'] || '',
        access: row['Accessible'] || row['Barrier Free'] || row['Lift'] || row['Escalator'] || '',
        info: text.slice(0, 1200)
      });
    };

    (mtrMeta.lines || []).slice(0, 300).forEach(r => mergeRow(r, 'line'));
    (mtrMeta.fares || []).slice(0, 300).forEach(r => mergeRow(r, 'fare'));
    (mtrMeta.access || []).slice(0, 300).forEach(r => mergeRow(r, 'access'));

    if (!pool.length) {
      const fallback = (mtrMeta.lines || [])[0] || {};
      pool.push({
        type: 'line',
        key: q,
        title: q,
        subtitle: fallback['Station'] || fallback['Station Name'] || '',
        lineCode: fallback['Line Code'] || fallback['Line'] || q,
        stationCode: fallback['Station Code'] || fallback['Station'] || '',
        fare: '',
        access: '',
        info: ''
      });
    }

    return pool;
  },

  normalizeMtrBusSchedule(schedule, line) {
    const data = schedule?.data || schedule || {};
    const items = [];
    for (const k of Object.keys(data)) {
      const row = data[k];
      if (!row) continue;
      const arr = Array.isArray(row) ? row : [row];
      for (const x of arr.slice(0, 3)) {
        if (!x) continue;
        items.push({
          label: 'MTR Bus',
          time: x?.time || x?.eta || x?.departure || x?.arrivalTime || '-',
          status: x?.status || '正常',
          rawEta: x?.time || x?.eta || x?.departure || x?.arrivalTime || '-'
        });
      }
    }
    return items.length ? items : [{
      label: 'MTR Bus',
      time: line || '-',
      status: '資料集',
      rawEta: line || '-'
    }];
  },

  async fetchData(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  },

  async renderMtrCard(item) {
    const mapsUrl = this.buildGoogleMapsUrl(item.title || item.subtitle || item.stopName || item.stopId || '');
    return `
      <div class="card">
        <div class="row"><strong>${this.escapeHtml(item.title || 'MTR')}</strong><span class="small">${this.escapeHtml(item.subtitle || '')}</span></div>
        <div class="row" style="margin-top:4px;"><span class="small">類型</span><span class="small">${this.escapeHtml(item.type || 'mtr')}</span></div>
        ${item.fare ? `<div class="row" style="margin-top:4px;"><span class="small">票價</span><span class="small">${this.escapeHtml(item.fare)}</span></div>` : ''}
        ${item.access ? `<div class="row" style="margin-top:4px;"><span class="small">無障礙</span><span class="small">${this.escapeHtml(item.access)}</span></div>` : ''}
        ${item.mtrInfo ? `<div class="row" style="margin-top:4px;"><span class="small">資料</span><span class="small">${this.escapeHtml(item.mtrInfo.slice(0, 240))}</span></div>` : ''}
        <div style="margin-top:10px;"><a class="maps-link" href="${mapsUrl}" target="_blank" rel="noreferrer">開 Google Maps</a></div>
      </div>
    `;
  },

  async renderGmbCard(item) {
    const mapsUrl = this.buildGoogleMapsUrl(item.gmbStop || item.stopName || item.route || '');
    return `
      <div class="card">
        <div class="row"><strong>${this.escapeHtml(item.gmbRoute || item.stopId || 'GMB')}</strong><span class="small">${this.escapeHtml(item.gmbStop || item.stopName || '')}</span></div>
        ${item.gmbEtaHint ? `<div class="row" style="margin-top:4px;"><span class="small">ETA</span><span class="small">${this.escapeHtml(item.gmbEtaHint)}</span></div>` : ''}
        ${item.gmbRouteList ? `<div class="row" style="margin-top:4px;"><span class="small">同站路線</span><span class="small">${this.escapeHtml(item.gmbRouteList)}</span></div>` : ''}
        <div style="margin-top:10px;"><a class="maps-link" href="${mapsUrl}" target="_blank" rel="noreferrer">開 Google Maps</a></div>
      </div>
    `;
  },

  buildGoogleMapsUrl(text) {
    const q = encodeURIComponent(String(text || '').trim());
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  },

  renderTabs() {
    return `
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <button type="button" class="transport-btn ${this.state.viewMode === 'bus' ? 'active' : ''}" data-view="bus">巴士</button>
        <button type="button" class="transport-btn ${this.state.viewMode === 'mtr' ? 'active' : ''}" data-view="mtr">MTR</button>
        <button type="button" class="transport-btn ${this.state.viewMode === 'gmb' ? 'active' : ''}" data-view="gmb">小巴</button>
        <button type="button" class="transport-btn" data-view="maps">Google Maps</button>
      </div>
    `;
  },

  renderIdle() {
    this.dom.result.innerHTML = this.renderTabs() + `<div class="row"><span class="muted">輸入目的地開始搜尋</span></div>`;
    this.bindTabButtons();
  },

  bindTabButtons() {
    this.dom.result.querySelectorAll('.transport-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const view = btn.dataset.view;
        if (view === 'maps') {
          window.open('https://www.google.com/maps/dir/?api=1', '_blank');
          return;
        }
        this.state.viewMode = view;
        if (view === 'bus') this.state.providerKey = 'kmb';
        if (view === 'mtr') this.state.providerKey = 'mtr';
        if (view === 'gmb') this.state.providerKey = 'gmb';
        this.renderIdle();
      });
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

      const provider = this.getProvider();
      const routeMeta = await provider.fetchRouteMeta(parsed.route, this);
      const found = await provider.resolveAllDirections(parsed.route, parsed.stopText, routeMeta, this);

      if (!found.length) throw new Error('找不到相符資料');

      this.state.availableDirections = found.map(x => x.chosenDirection);
      await this.applyAndFetch(found[0], found, provider);
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  renderLoading() {
    this.dom.result.innerHTML = this.renderTabs() + `<div class="row"><span class="muted">搜尋中...</span></div>`;
    this.bindTabButtons();
  },

  async handleDirectionChange(direction) {
    const provider = this.getProvider();
    const routeMeta = await provider.fetchRouteMeta(this.state.route, this);
    const found = await provider.resolveAllDirections(this.state.route, this.state.stopText, routeMeta, this);
    const target = found.find(x => String(x.chosenDirection) === String(direction)) || found[0];
    if (!target) return;
    await this.applyAndFetch(target, found, provider);
  },

  async handleStopChange(stopId) {
    const provider = this.getProvider();
    const chosenStop = (this.state.enrichedStopList || []).find(s => this.getRawStopId(s) === stopId);
    if (!chosenStop) return;
    let stopMeta = chosenStop.__stopMeta || {};
    if (provider?.fetchStopMeta) stopMeta = await provider.fetchStopMeta(stopId, this);
    chosenStop.__stopMeta = stopMeta;

    this.state.chosenStop = chosenStop;
    this.state.stopId = stopId;
    this.state.stopName = this.getStopDisplayName(chosenStop, stopId, provider?.key || '');
    this.state.lastResolvedQuery = { route: this.state.route, stopId, chosenDirection: this.state.chosenDirection, stopName: this.state.stopName };
    await this.refreshEta();
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
    return { route: parts[0] || '', stopText: parts.slice(1).join(' ').trim() };
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
    const out = [];
    for (let i = 0; i < stopList.length; i++) {
      const s = stopList[i];
      const stopId = app.getRawStopId(s);
      let stopMeta = {};
      if (stopId) {
        try {
          const json = await app.fetchJson(`https://data.etabus.gov.hk/v1/transport/kmb/stop/${encodeURIComponent(stopId)}`);
          stopMeta = json?.data || json || {};
        } catch (_) {}
      }
      out.push({
        ...s,
        __seq: String(s.__seq || s.seq || s.sequence || s.stop_seq || i + 1),
        __stopMeta: stopMeta,
        stop_name_tc: stopMeta?.stop_name_tc || stopMeta?.name_tc || s.stop_name_tc || s.STOP_NAMEC || s.name_tc || s.name || '',
        stop_name_en: stopMeta?.stop_name_en || stopMeta?.name_en || s.stop_name_en || s.STOP_NAMEE || s.name_en || '',
        name_tc: stopMeta?.stop_name_tc || stopMeta?.name_tc || s.name_tc || s.STOP_NAMEC || s.name || '',
        name_en: stopMeta?.stop_name_en || stopMeta?.name_en || s.name_en || s.STOP_NAMEE || s.name || ''
      });
    }
    return out;
  },

  async enrichCitybusStops(stopList, app) {
    const out = [];
    for (let i = 0; i < stopList.length; i++) {
      const s = stopList[i];
      const stopId = app.getRawStopId(s);
      let stopMeta = {};
      if (stopId) {
        try {
          const json = await app.fetchJson(`https://rt.data.gov.hk/v2/transport/citybus/stop/${encodeURIComponent(stopId)}`);
          stopMeta = json?.data || json || {};
        } catch (_) {}
      }
      out.push({
        ...s,
        __seq: String(s.__seq || s.seq || s.sequence || s.stop_seq || i + 1),
        __stopMeta: stopMeta,
        stop_name_tc: stopMeta?.name_tc || stopMeta?.stop_name_tc || s.stop_name_tc || s.name_tc || s.STOP_NAMEC || '',
        stop_name_en: stopMeta?.name_en || stopMeta?.stop_name_en || s.stop_name_en || s.name_en || s.STOP_NAMEE || '',
        name_tc: stopMeta?.name_tc || stopMeta?.stop_name_tc || s.name_tc || s.STOP_NAMEC || '',
        name_en: stopMeta?.name_en || stopMeta?.stop_name_en || s.name_en || s.STOP_NAMEE || ''
      });
    }
    return out;
  },

  getStopDisplayName(stop, stopId, providerKey = '') {
    return providerKey === 'ctb'
      ? this.getCitybusStopName(stop, stop?.__stopMeta || {}, stopId)
      : this.getKmbStopName(stop, stop?.__stopMeta || {}, stopId);
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
    try { return JSON.parse(text); } catch { return { data: text }; }
  },

  renderDirectionButtons() {
    const dirs = (this.state.availableDirections || []).slice(0, 2);
    if (!dirs.length) return '';
    return `
      <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
        ${dirs.map(d => `<button type="button" class="dir-btn ${String(d) === String(this.state.chosenDirection) ? 'active' : ''}" data-direction="${this.escapeHtml(String(d))}">${this.escapeHtml(this.getDirectionLabel(d))}</button>`).join('')}
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

  async renderMtrCards(found) {
    return (found || []).map(item => `
      <div class="card">
        <div class="row"><strong>${this.escapeHtml(item.mtrTitle || item.stopName || 'MTR')}</strong><span class="small">${this.escapeHtml(item.mtrSubtitle || '')}</span></div>
        ${item.mtrFare ? `<div class="row" style="margin-top:4px;"><span class="small">票價</span><span class="small">${this.escapeHtml(item.mtrFare)}</span></div>` : ''}
        ${item.mtrAccess ? `<div class="row" style="margin-top:4px;"><span class="small">無障礙</span><span class="small">${this.escapeHtml(item.mtrAccess)}</span></div>` : ''}
        ${item.mtrInfo ? `<div class="row" style="margin-top:4px;"><span class="small">資料</span><span class="small">${this.escapeHtml(item.mtrInfo.slice(0, 240))}</span></div>` : ''}
        <div style="margin-top:10px;"><a class="maps-link" href="${this.buildGoogleMapsUrl(item.mtrTitle || item.mtrSubtitle || item.stopName || '')}" target="_blank" rel="noreferrer">開 Google Maps</a></div>
      </div>
    `).join('');
  },

  async renderGmbCards(found) {
    return (found || []).map(item => `
      <div class="card">
        <div class="row"><strong>${this.escapeHtml(item.gmbRoute || item.stopId || 'GMB')}</strong><span class="small">${this.escapeHtml(item.gmbStop || item.stopName || '')}</span></div>
        ${item.gmbEtaHint ? `<div class="row" style="margin-top:4px;"><span class="small">ETA</span><span class="small">${this.escapeHtml(item.gmbEtaHint)}</span></div>` : ''}
        ${item.gmbRouteList ? `<div class="row" style="margin-top:4px;"><span class="small">同站路線</span><span class="small">${this.escapeHtml(item.gmbRouteList)}</span></div>` : ''}
        <div style="margin-top:10px;"><a class="maps-link" href="${this.buildGoogleMapsUrl(item.gmbStop || item.stopName || item.gmbRoute || '')}" target="_blank" rel="noreferrer">開 Google Maps</a></div>
      </div>
    `).join('');
  },

  buildGoogleMapsUrl(text) {
    const q = encodeURIComponent(String(text || '').trim());
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  },

  async renderResult() {
    const s = this.state;
    const providerKey = this.state.providerKey;

    if (providerKey === 'mtr') {
      const cards = await this.renderMtrCards(this.state.lastResolvedFound || []);
      this.dom.result.innerHTML = `
        ${this.renderTabs()}
        <div class="section-title">MTR 搜尋結果</div>
        <div class="grid">${cards || '<div class="row"><span class="muted">暫無 MTR 資料</span></div>'}</div>
      `;
      this.bindTabButtons();
      return;
    }

    if (providerKey === 'gmb') {
      const cards = await this.renderGmbCards(this.state.lastResolvedFound || []);
      this.dom.result.innerHTML = `
        ${this.renderTabs()}
        <div class="section-title">GMB 搜尋結果</div>
        <div class="grid">${cards || '<div class="row"><span class="muted">暫無 GMB 資料</span></div>'}</div>
      `;
      this.bindTabButtons();
      return;
    }

    this.dom.result.innerHTML = `
      ${this.renderTabs()}
      <div class="row"><strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.destName || s.stopName || '')}</strong></div>
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
      ${s.lastUpdated ? `<div style="height:8px"></div><div class="row"><span class="small">更新時間</span><span class="small">${this.escapeHtml(this.formatClock(s.lastUpdated))}</span></div>` : ''}
      <div style="height:8px"></div>
      <div class="row"><span class="small">自動刷新</span><span class="small">${this.config.refreshMs / 1000} 秒</span></div>
    `;
    this.bindTabButtons();
    this.bindDirectionButtons();
    this.bindStopDropdown();
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

  renderLoading() {
    this.dom.result.innerHTML = this.renderTabs() + `<div class="row"><span class="muted">搜尋中...</span></div>`;
    this.bindTabButtons();
  },

  renderError(err) {
    this.dom.result.innerHTML = this.renderTabs() + `<div class="row" style="margin-top:10px;"><strong>⚠️ 無實時數據</strong><span class="small">${this.escapeHtml(err.message || 'Unknown error')}</span></div>`;
    this.bindTabButtons();
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
      const routeMeta = await provider.fetchRouteMeta(parsed.route, this);
      const found = await provider.resolveAllDirections(parsed.route, parsed.stopText, routeMeta, this);

      if (!found.length) throw new Error('找不到相符資料');

      this.state.availableDirections = found.map(x => x.chosenDirection);
      this.state.lastResolvedFound = found;

      await this.applyAndFetch(found[0], found, provider);
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async handleDirectionChange(direction) {
    const provider = this.getProvider();
    const routeMeta = await provider.fetchRouteMeta(this.state.route, this);
    const found = await provider.resolveAllDirections(this.state.route, this.state.stopText, routeMeta, this);
    this.state.lastResolvedFound = found;
    const target = found.find(x => String(x.chosenDirection) === String(direction)) || found[0];
    if (!target) return;
    await this.applyAndFetch(target, found, provider);
  },

  async handleStopChange(stopId) {
    const provider = this.getProvider();
    const chosenStop = (this.state.enrichedStopList || []).find(s => this.getRawStopId(s) === stopId);
    if (!chosenStop) return;
    let stopMeta = chosenStop.__stopMeta || {};
    if (provider?.fetchStopMeta) stopMeta = await provider.fetchStopMeta(stopId, this);
    chosenStop.__stopMeta = stopMeta;

    this.state.chosenStop = chosenStop;
    this.state.stopId = stopId;
    this.state.stopName = this.getStopDisplayName(chosenStop, stopId, provider?.key || '');
    this.state.lastResolvedQuery = { route: this.state.route, stopId, chosenDirection: this.state.chosenDirection, stopName: this.state.stopName };
    await this.refreshEta();
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
    return { route: parts[0] || '', stopText: parts.slice(1).join(' ').trim() };
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
    const out = [];
    for (let i = 0; i < stopList.length; i++) {
      const s = stopList[i];
      const stopId = app.getRawStopId(s);
      let stopMeta = {};
      if (stopId) {
        try {
          const json = await app.fetchJson(`https://data.etabus.gov.hk/v1/transport/kmb/stop/${encodeURIComponent(stopId)}`);
          stopMeta = json?.data || json || {};
        } catch (_) {}
      }
      out.push({
        ...s,
        __seq: String(s.__seq || s.seq || s.sequence || s.stop_seq || i + 1),
        __stopMeta: stopMeta,
        stop_name_tc: stopMeta?.stop_name_tc || stopMeta?.name_tc || s.stop_name_tc || s.STOP_NAMEC || s.name_tc || s.name || '',
        stop_name_en: stopMeta?.stop_name_en || stopMeta?.name_en || s.stop_name_en || s.STOP_NAMEE || s.name_en || '',
        name_tc: stopMeta?.stop_name_tc || stopMeta?.name_tc || s.name_tc || s.STOP_NAMEC || s.name || '',
        name_en: stopMeta?.stop_name_en || stopMeta?.name_en || s.name_en || s.STOP_NAMEE || s.name || ''
      });
    }
    return out;
  },

  async enrichCitybusStops(stopList, app) {
    const out = [];
    for (let i = 0; i < stopList.length; i++) {
      const s = stopList[i];
      const stopId = app.getRawStopId(s);
      let stopMeta = {};
      if (stopId) {
        try {
          const json = await app.fetchJson(`https://rt.data.gov.hk/v2/transport/citybus/stop/${encodeURIComponent(stopId)}`);
          stopMeta = json?.data || json || {};
        } catch (_) {}
      }
      out.push({
        ...s,
        __seq: String(s.__seq || s.seq || s.sequence || s.stop_seq || i + 1),
        __stopMeta: stopMeta,
        stop_name_tc: stopMeta?.name_tc || stopMeta?.stop_name_tc || s.stop_name_tc || s.name_tc || s.STOP_NAMEC || '',
        stop_name_en: stopMeta?.name_en || stopMeta?.stop_name_en || s.stop_name_en || s.name_en || s.STOP_NAMEE || '',
        name_tc: stopMeta?.name_tc || stopMeta?.stop_name_tc || s.name_tc || s.STOP_NAMEC || '',
        name_en: stopMeta?.name_en || stopMeta?.stop_name_en || s.name_en || s.STOP_NAMEE || ''
      });
    }
    return out;
  },

  getStopDisplayName(stop, stopId, providerKey = '') {
    return providerKey === 'ctb'
      ? this.getCitybusStopName(stop, stop?.__stopMeta || {}, stopId)
      : this.getKmbStopName(stop, stop?.__stopMeta || {}, stopId);
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
    try { return JSON.parse(text); } catch { return { data: text }; }
  },

  async fetchData(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  },

  renderDirectionButtons() {
    const dirs = (this.state.availableDirections || []).slice(0, 2);
    if (!dirs.length) return '';
    return `
      <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
        ${dirs.map(d => `<button type="button" class="dir-btn ${String(d) === String(this.state.chosenDirection) ? 'active' : ''}" data-direction="${this.escapeHtml(String(d))}">${this.escapeHtml(this.getDirectionLabel(d))}</button>`).join('')}
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
      ${this.renderTabs()}
      <div class="row"><strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.destName || s.stopName || '')}</strong></div>
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
      ${s.lastUpdated ? `<div style="height:8px"></div><div class="row"><span class="small">更新時間</span><span class="small">${this.escapeHtml(this.formatClock(s.lastUpdated))}</span></div>` : ''}
      <div style="height:8px"></div>
      <div class="row"><span class="small">自動刷新</span><span class="small">${this.config.refreshMs / 1000} 秒</span></div>
    `;
    this.bindTabButtons();
    this.bindDirectionButtons();
    this.bindStopDropdown();
  },

  renderLoading() {
    this.dom.result.innerHTML = this.renderTabs() + `<div class="row"><span class="muted">搜尋中...</span></div>`;
    this.bindTabButtons();
  },

  renderError(err) {
    this.dom.result.innerHTML = this.renderTabs() + `<div class="row" style="margin-top:10px;"><strong>⚠️ 無實時數據</strong><span class="small">${this.escapeHtml(err.message || 'Unknown error')}</span></div>`;
    this.bindTabButtons();
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
      const routeMeta = await provider.fetchRouteMeta(parsed.route, this);
      const found = await provider.resolveAllDirections(parsed.route, parsed.stopText, routeMeta, this);

      if (!found.length) throw new Error('找不到相符資料');

      this.state.availableDirections = found.map(x => x.chosenDirection);
      this.state.lastResolvedFound = found;

      await this.applyAndFetch(found[0], found, provider);
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  },

  async handleDirectionChange(direction) {
    const provider = this.getProvider();
    const routeMeta = await provider.fetchRouteMeta(this.state.route, this);
    const found = await provider.resolveAllDirections(this.state.route, this.state.stopText, routeMeta, this);
    this.state.lastResolvedFound = found;
    const target = found.find(x => String(x.chosenDirection) === String(direction)) || found[0];
    if (!target) return;
    await this.applyAndFetch(target, found, provider);
  },

  async handleStopChange(stopId) {
    const provider = this.getProvider();
    const chosenStop = (this.state.enrichedStopList || []).find(s => this.getRawStopId(s) === stopId);
    if (!chosenStop) return;
    let stopMeta = chosenStop.__stopMeta || {};
    if (provider?.fetchStopMeta) stopMeta = await provider.fetchStopMeta(stopId, this);
    chosenStop.__stopMeta = stopMeta;

    this.state.chosenStop = chosenStop;
    this.state.stopId = stopId;
    this.state.stopName = this.getStopDisplayName(chosenStop, stopId, provider?.key || '');
    this.state.lastResolvedQuery = { route: this.state.route, stopId, chosenDirection: this.state.chosenDirection, stopName: this.state.stopName };
    await this.refreshEta();
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
    if (direction === 'mtr') return 'MTR';
    if (direction === 'gmb') return 'GMB';
    return String(direction || '');
  },

  async renderMtrCards(found) {
    return (found || []).map(item => `
      <div class="card">
        <div class="row"><strong>${this.escapeHtml(item.mtrTitle || item.stopName || 'MTR')}</strong><span class="small">${this.escapeHtml(item.mtrSubtitle || '')}</span></div>
        <div class="row" style="margin-top:4px;"><span class="small">類型</span><span class="small">${this.escapeHtml(item.mtrType || 'mtr')}</span></div>
        ${item.mtrFare ? `<div class="row" style="margin-top:4px;"><span class="small">票價</span><span class="small">${this.escapeHtml(item.mtrFare)}</span></div>` : ''}
        ${item.mtrAccess ? `<div class="row" style="margin-top:4px;"><span class="small">無障礙</span><span class="small">${this.escapeHtml(item.mtrAccess)}</span></div>` : ''}
        ${item.mtrInfo ? `<div class="row" style="margin-top:4px;"><span class="small">資料</span><span class="small">${this.escapeHtml(item.mtrInfo.slice(0, 240))}</span></div>` : ''}
        <div style="margin-top:10px;"><a class="maps-link" href="${this.buildGoogleMapsUrl(item.mtrTitle || item.mtrSubtitle || item.stopName || '')}" target="_blank" rel="noreferrer">開 Google Maps</a></div>
      </div>
    `).join('');
  },

  async renderGmbCards(found) {
    return (found || []).map(item => `
      <div class="card">
        <div class="row"><strong>${this.escapeHtml(item.gmbRoute || item.stopId || 'GMB')}</strong><span class="small">${this.escapeHtml(item.gmbStop || item.stopName || '')}</span></div>
        ${item.gmbEtaHint ? `<div class="row" style="margin-top:4px;"><span class="small">ETA</span><span class="small">${this.escapeHtml(item.gmbEtaHint)}</span></div>` : ''}
        ${item.gmbRouteList ? `<div class="row" style="margin-top:4px;"><span class="small">同站路線</span><span class="small">${this.escapeHtml(item.gmbRouteList)}</span></div>` : ''}
        <div style="margin-top:10px;"><a class="maps-link" href="${this.buildGoogleMapsUrl(item.gmbStop || item.stopName || item.gmbRoute || '')}" target="_blank" rel="noreferrer">開 Google Maps</a></div>
      </div>
    `).join('');
  },

  async renderResult() {
    const providerKey = this.state.providerKey;

    if (providerKey === 'mtr') {
      const cards = await this.renderMtrCards(this.state.lastResolvedFound || []);
      this.dom.result.innerHTML = `${this.renderTabs()}<div class="grid">${cards || '<div class="row"><span class="muted">暫無 MTR 資料</span></div>'}</div>`;
      this.bindTabButtons();
      return;
    }

    if (providerKey === 'gmb') {
      const cards = await this.renderGmbCards(this.state.lastResolvedFound || []);
      this.dom.result.innerHTML = `${this.renderTabs()}<div class="grid">${cards || '<div class="row"><span class="muted">暫無 GMB 資料</span></div>'}</div>`;
      this.bindTabButtons();
      return;
    }

    const s = this.state;
    this.dom.result.innerHTML = `
      ${this.renderTabs()}
      <div class="row"><strong>${this.escapeHtml(s.route)}｜${this.escapeHtml(s.destName || s.stopName || '')}</strong></div>
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
      ${s.lastUpdated ? `<div style="height:8px"></div><div class="row"><span class="small">更新時間</span><span class="small">${this.escapeHtml(this.formatClock(s.lastUpdated))}</span></div>` : ''}
      <div style="height:8px"></div>
      <div class="row"><span class="small">自動刷新</span><span class="small">${this.config.refreshMs / 1000} 秒</span></div>
    `;
    this.bindTabButtons();
    this.bindDirectionButtons();
    this.bindStopDropdown();
  },

  parseCsv(csv) {
    const lines = String(csv || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = this.splitCsvLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map(line => {
      const cols = this.splitCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] ?? '');
      return obj;
    });
  },

  splitCsvLine(line) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  },

  findGmbMatches(q, stopText, routeList, etaList, stopList) {
    const needle = this.normalizeText(`${q} ${stopText}`);
    const out = [];

    const routeMap = new Map();
    for (const row of routeList || []) {
      const stopId = row['stop_id'] || row['stopId'] || row['stop'] || row['Stop ID'] || '';
      const route = row['route'] || row['Route'] || row['route_no'] || row['Route No'] || '';
      const stopName = row['stop_name_tc'] || row['stop_name'] || row['stop_name_en'] || row['Stop Name'] || row['Stop Name TC'] || '';
      const routeName = row['route_name_tc'] || row['route_name'] || row['route_name_en'] || row['Route Name'] || '';
      if (!stopId && !route) continue;
      const key = String(stopId || route || stopName).toUpperCase();
      routeMap.set(key, {
        stopId,
        route,
        stopName,
        routeName,
        routeList: routeList.slice(0, 5).map(x => x['route'] || x['Route'] || x['route_no'] || '').filter(Boolean).join(' / ')
      });
    }

    for (const row of etaList || []) {
      const stopId = row['stop_id'] || row['stopId'] || row['stop'] || '';
      const route = row['route'] || row['Route'] || row['route_no'] || '';
      const stopName = row['stop_name_tc'] || row['stop_name'] || row['stop_name_en'] || row['Stop Name'] || '';
      const eta = row['eta'] || row['ETA'] || row['arrival_time'] || row['Arrival Time'] || '';
      const routeName = row['route_name_tc'] || row['route_name'] || row['route_name_en'] || row['Route Name'] || '';
      const text = this.normalizeText(`${stopId} ${route} ${stopName} ${routeName} ${eta}`);
      if (needle && !text.includes(needle.split(' ')[0]) && !text.includes(needle)) continue;
      out.push({
        stopId: stopId || route || stopName,
        stopName: stopName || stopId || route,
        route: route,
        routeName: routeName || route,
        etaText: eta || '',
        routeList: routeMap.get(String(stopId || route || stopName).toUpperCase())?.routeList || ''
      });
    }

    if (!out.length && (routeList || []).length) {
      const first = routeList[0];
      out.push({
        stopId: first['stop_id'] || first['stopId'] || first['stop'] || first['Stop ID'] || q,
        stopName: first['stop_name_tc'] || first['stop_name'] || first['Stop Name'] || q,
        route: first['route'] || first['Route'] || q,
        routeName: first['route_name_tc'] || first['route_name'] || first['Route Name'] || q,
        etaText: '',
        routeList: ''
      });
    }

    return out;
  },

  normalizeMtrBusSchedule(schedule, line) {
    const data = schedule?.data || schedule || {};
    const items = [];
    for (const k of Object.keys(data)) {
      const row = data[k];
      if (!row) continue;
      const arr = Array.isArray(row) ? row : [row];
      for (const x of arr.slice(0, 3)) {
        if (!x) continue;
        items.push({
          label: 'MTR Bus',
          time: x?.time || x?.eta || x?.departure || x?.arrivalTime || '-',
          status: x?.status || '正常',
          rawEta: x?.time || x?.eta || x?.departure || x?.arrivalTime || '-'
        });
      }
    }
    return items.length ? items : [{
      label: 'MTR Bus',
      time: line || '-',
      status: '資料集',
      rawEta: line || '-'
    }];
  },

  async fetchData(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  },

  async fetchCsvFromDataGov(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const text = await res.text();
      return this.parseCsv(text);
    } catch (_) {
      return [];
    }
  },

  buildGoogleMapsUrl(text) {
    const q = encodeURIComponent(String(text || '').trim());
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  },

  escapeHtml(str) {
    return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
