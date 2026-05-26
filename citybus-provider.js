// citybus-provider.js
export function createCitybusProvider(app) {
  return {
    key: 'ctb',
    label: 'Citybus',

    async search(routeText) {
      const routeNo = String(routeText || '').trim().toUpperCase();
      const metaUrl = `https://rt.data.gov.hk/v2/transport/citybus/route/ctb/${encodeURIComponent(routeNo)}`;
      const meta = await app.fetchJson(metaUrl);

      const stopUrl = `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${encodeURIComponent(routeNo)}/outbound`;
      const stopList = app.normalizeList(await app.fetchJson(stopUrl));

      const chosenStop = stopList[0];
      if (!chosenStop) throw new Error('搵唔到 Citybus 站點');

      const stopId = chosenStop.stop || chosenStop.stop_id || chosenStop.id;
      const etaUrl = `https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${encodeURIComponent(stopId)}/${encodeURIComponent(routeNo)}/1`;
      const etaList = app.normalizeList(await app.fetchJson(etaUrl));

      return { meta, stopList, etaList };
    }
  };
}
