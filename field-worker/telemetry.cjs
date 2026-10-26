const { timingSafeEqual } = require('node:crypto');

function authorized(request, secret) {
  if (!secret || request.method !== 'GET') return false;
  const received = Buffer.from(request.headers.get('x-api-key') || '');
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function response(request, secret, metrics, health) {
  if (!authorized(request, secret)) return Response.json({ message: 'Não autorizado' }, { status: 403 });
  return Response.json({ metrics: metrics.snapshot(), health }, { headers: { 'Cache-Control': 'no-store' } });
}
module.exports = { authorized, response };
