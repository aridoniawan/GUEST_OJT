const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

export function wrap(fn) {
  return async (req, ctx) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      return await fn(req, ctx);
    } catch (e) {
      console.error(e);
      return json(500, { error: 'Terjadi kesalahan server' });
    }
  };
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
