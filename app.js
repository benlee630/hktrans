/* Citybus 專用最小修正 patch — 一鍵 copy 版
   只改 CTB，唔影響 KMB
   用法：喺 app 初始化後，呼叫 applyCitybusOnlyPatch(app)
*/

function applyCitybusOnlyPatch(app) {
  const CITYBUS_DEBUG = true;

  function log(obj) {
    if (!CITYBUS_DEBUG) return;
    app.debug = app.debug || {};
    app.debug.citybus = app.debug.citybus || [];
    app.debug.citybus.push(obj);
  }

  function resetCitybusState() {
    app.state.route = '';
    app.state.stopText = '';
    app.state.chosenDirection = null;
    app.state.stopList = [];
    app.state.enrichedStopList = [];
    app.state.chosenStop = null;
    app.state.stopId = '';
    app.state.stopName = '';
    app.state.destName = '';
    app.state.brandName = '';
    app.state.etaData = [];
    app.state.etas = [];
    app.state.sameStopRoutes = [];
    app.state.lastUpdated = null;
    app.state.availableDirections = [];
    app.state.lastResolvedQuery = null;
  }

  const ctb = {
    key: 'ctb',
    label: 'Citybus',
    brandName: 'Citybus',
    routeKey(route) { return `ctb:${String(route || '').trim().toUpperCase()}`; },

    async fetchRouteMeta(route, appRef) {
      const routeNo = String(route || '').trim().toUpperCase();
      const urls = [
        `https://rt.data.gov.hk/v2/transport/citybus/route/ctb/${encodeURIComponent(routeNo)}`,
        `https://rt.data.gov.hk/v2/transport/citybus/route/ctb/${encodeURIComponent(routeNo)}/1`
      ];
      for (const url of urls) {
        try {
          const json = await appRef.fetchJson(url);
          const meta = json?.data || json || {};
          if (meta && Object.keys(meta).length) {
            log({ stage: 'route-meta-ok', route: routeNo, url, keys: Object.keys(meta).slice(0, 20) });
            return meta;
          }
        } catch (err) {
          log({ stage: 'route-meta-error', route: routeNo, url, error: String(err.message || err) });
        }
      }
      log({ stage: 'route-meta-empty', route: routeNo });
      return {};
    },

    async resolveAllDirections(route, stopText, routeMeta, appRef) {
      const routeNo = String(route || '').trim().toUpperCase();
      const routeData = routeMeta?.data || routeMeta || {};
      const found = [];

      for (const dir of ['outbound', 'inbound']) {
        const urls = [
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${encodeURIComponent(dir)}`,
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${encodeURIComponent(dir)}/1`,
          `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/${encodeURIComponent(dir)}/2`
        ];

        let stopList = [];
        let usedUrl = '';
        for (const url of urls) {
          try {
            const json = await appRef.fetchJson(url);
            const list = appRef.normalizeList(json);
            if (list.length) {
              stopList = list;
              usedUrl = url;
              break;
            }
          } catch (err) {
            log({ stage: 'route-stop-error', route: routeNo, direction: dir, url, error: String(err.message || err) });
          }
        }

        if (!stopList.length) {
          log({ stage: 'route-stop-empty', route: routeNo, direction: dir });
          continue;
        }

        const enrichedStopList = stopList.map((s, idx) => {
          const rawStopId = s.stop || s.stop_id || s.id || s.stopId || s.stopID || s.bus_stop_id || s.busStopId || '';
          const seq = s.seq || s.sequence || s.stop_seq || s.bus_stop_seq || idx + 1;
          const nameTc = s.name_tc || s.stop_name_tc || s.name || s.stopname_tc || s.stopNameTc || s.name_chi || '';
          const nameEn = s.name_en || s.stop_name_en || s.stopname_en || s.stopNameEn || s.name_eng || '';
          return {
            ...s,
            __rawStopId: rawStopId,
            __seq: String(seq),
            name_tc: nameTc,
            name_en: nameEn
          };
        });

        const stopTextNorm = String(stopText || '').trim().toUpperCase();
        let chosenStop = null;
        if (stopTextNorm) {
          chosenStop = enrichedStopList.find(s => {
            const hay = [s.name_tc, s.name_en, s.__rawStopId, s.__seq, s.stop, s.stop_id, s.id]
              .filter(Boolean)
              .join(' ')
              .toUpperCase();
            return hay.includes(stopTextNorm);
          }) || null;
        }
        if (!chosenStop) chosenStop = enrichedStopList[0] || null;

        const stopId = chosenStop?.__rawStopId || chosenStop?.stop || chosenStop?.stop_id || chosenStop?.id || chosenStop?.stopId || '';
        const stopName = chosenStop?.name_tc || chosenStop?.name_en || chosenStop?.__seq || stopId;
        if (!stopId) {
          log({ stage: 'no-stopid', route: routeNo, direction: dir, usedUrl, sampleKeys: enrichedStopList.slice(0, 3).map(x => Object.keys(x).slice(0, 20)) });
          continue;
        }

        const isOut = String(dir).toLowerCase() === 'outbound' || String(dir) === '2';
        const destName = isOut
          ? (routeData?.dest_en || routeData?.dest_tc || routeData?.dest || '')
          : (routeData?.orig_en || routeData?.orig_tc || routeData?.orig || '');

        found.push({
          chosenDirection: dir,
          stopList,
          enrichedStopList,
          chosenStop,
          stopId,
          stopName,
          destName,
          usedUrl
        });

        log({ stage: 'route-stop-ok', route: routeNo, direction: dir, usedUrl, stopId, stopName, count: stopList.length });
      }

      if (!found.length) log({ stage: 'route-search-failed', route: routeNo });
      return found;
    },

    async fetchEta(route, stopId, appRef) {
      const routeNo = String(route || '').trim().toUpperCase();
      const urls = [
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}/1`,
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}/2`,
        `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}?service_type=1`
      ];

      let raw = [];
      let usedUrl = '';
      for (const url of urls) {
        try {
          const json = await appRef.fetchJson(url);
          const list = appRef.normalizeList(json);
          if (list.length) {
            raw = list;
            usedUrl = url;
            break;
          }
        } catch (err) {
          log({ stage: 'eta-error', route: routeNo, stopId, url, error: String(err.message || err) });
        }
      }

      log({ stage: 'eta-fetch', route: routeNo, stopId, usedUrl, count: raw.length });

      const matched = raw.filter(x => String(x?.route || '').toUpperCase() === routeNo && x?.eta);
      const etas = matched.slice(0, 3).map((x, idx) => ({
        label: idx === 0 ? '下 1 班' : idx === 1 ? '下 2 班' : '下 3 班',
        time: appRef.formatTime(x.eta),
        status: appRef.etaStatus(x),
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
          time: x.eta ? appRef.formatTime(x.eta) : '-',
          status: appRef.etaStatus(x)
        });
        if (sameStopRoutes.length >= 3) break;
      }

      return { raw, etas, sameStopRoutes, usedUrl };
    }
  };

  app.providers = app.providers || {};
  app.providers.ctb = ctb;

  const originalGetProvider = app.getProvider?.bind(app);
  app.getProvider = function () {
    if (String(this.state.providerKey || '') === 'ctb') return this.providers.ctb;
    return originalGetProvider ? originalGetProvider() : null;
  };

  const originalHandleSearch = app.handleSearch?.bind(app);
  app.handleSearch = async function (q) {
    const parsed = this.parseQuery(q);

    if (String(this.state.providerKey || '') !== 'ctb') {
      return originalHandleSearch ? originalHandleSearch(q) : null;
    }

    this.debug = this.debug || {};
    this.debug.citybus = [];
    this.state.providerKey = 'ctb';
    this.state.transportType = 'bus';
    this.state.transportSelected = true;
    resetCitybusState();
    this.state.route = parsed.route;
    this.state.stopText = parsed.stopText;

    try {
      this.stopAutoRefresh();
      this.renderLoading();
      const provider = this.getProvider();
      const routeMeta = await provider.fetchRouteMeta(parsed.route, this);
      const found = await provider.resolveAllDirections(parsed.route, parsed.stopText, routeMeta, this);
      if (!found.length) throw new Error('找不到相符路線或站點');
      this.state.availableDirections = found.map(x => x.chosenDirection);
      await this.applyAndFetch(found[0], found, provider);
      this.startAutoRefresh();
    } catch (err) {
      this.renderError(err);
    }
  };

  return app;
}
