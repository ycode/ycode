// Development-only gateway: deliberately no request/header/body logging.
import http from 'node:http';
const routes = [['/auth/v1/', 'auth', 9999], ['/rest/v1/', 'rest', 3000], ['/storage/v1/', 'storage', 5000]];
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,accept-profile,content-profile,x-upsert,cache-control');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const route = routes.find(([prefix]) => req.url.startsWith(prefix));
  if (!route) { res.writeHead(404); return res.end(); }
  const [prefix, hostname, port] = route;
  const upstream = http.request({ hostname, port, path: '/' + req.url.slice(prefix.length),
    method: req.method, headers: {...req.headers, host: hostname} }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(503); res.end(); });
  req.pipe(upstream);
}).listen(8000, '0.0.0.0');
