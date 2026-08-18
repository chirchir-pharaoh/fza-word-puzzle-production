const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { handleRequest } = require('./http');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 8080);

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function setStaticSecurityHeaders(res, filePath){
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");

  // The HTML shell and runtime config should not be cached because challenge
  // dates and branding may change without rebuilding the Docker image.
  if (filePath.endsWith('index.html') || filePath.endsWith('config.json')){
    res.setHeader('Cache-Control', 'no-store');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}

function resolveStaticPath(urlPath){
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  const candidate = path.join(distDir, normalized || 'index.html');
  const relative = path.relative(distDir, candidate);

  // Prevent path traversal such as /../server/db.js from escaping dist/.
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

function sendFile(req, res, filePath){
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(ext) || 'application/octet-stream';

  setStaticSecurityHeaders(res, filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);

  if (req.method === 'HEAD'){
    res.end();
    return;
  }

  fs.createReadStream(filePath).on('error', () => {
    res.statusCode = 500;
    res.end('Unable to read static file.');
  }).pipe(res);
}

function serveStatic(req, res){
  if (!['GET', 'HEAD'].includes(String(req.method || 'GET').toUpperCase())){
    res.statusCode = 405;
    res.setHeader('Allow', 'GET,HEAD');
    res.end('Method not allowed.');
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const staticPath = resolveStaticPath(url.pathname);

  if (!staticPath){
    res.statusCode = 400;
    res.end('Invalid path.');
    return;
  }

  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()){
    sendFile(req, res, staticPath);
    return;
  }

  // Single-page app fallback for /leaderboard and other client routes.
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)){
    sendFile(req, res, indexPath);
    return;
  }

  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('dist/index.html was not found. Run npm run build before starting the server.');
}

const server = http.createServer(async (req, res) => {
  try {
    if (String(req.url || '').startsWith('/api')){
      await handleRequest(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Internal server error.');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Fun Zone Arena challenge server listening on http://0.0.0.0:${port}`);
});
