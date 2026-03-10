const WEBAPP_EXEC_URL = 'https://script.google.com/macros/s/AKfycbx1g2DPypXbyEPwKYrWuhO1Zvc9cBZFtjRvLNpRd-O5xxPawSmuvUu5xtJUM4UOAB4/exec?api=1';

export async function onRequestPost(context) {
  try {
    const payload = await context.request.text();
    const upstream = await fetch(WEBAPP_EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: 'Cloudflare proxy error: ' + String(err) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export function onRequestGet() {
  return Response.json(
    { ok: false, error: 'Use POST /api.' },
    { status: 405, headers: { 'Cache-Control': 'no-store' } }
  );
}
