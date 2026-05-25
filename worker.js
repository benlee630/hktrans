export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const path = url.pathname.replace(/^\/kmb/, '');
    const target = `https://data.etabus.gov.hk/v1/transport/kmb${path}${url.search}`;
    const res = await fetch(target, {
      headers: { Accept: 'application/json' }
    });
    const body = await res.text();

    return cors(new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
};

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}
