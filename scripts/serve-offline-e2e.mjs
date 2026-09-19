import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = spawnSync(process.execPath, [
  resolve(projectRoot, 'node_modules/@angular/cli/bin/ng.js'),
  'build', '--configuration=production,offline-e2e', '--output-path=.angular/offline-e2e',
], { cwd: projectRoot, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const buildRoot = resolve(projectRoot, '.angular/offline-e2e/browser');
const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const path = resolve(buildRoot, '.' + (extname(pathname) ? pathname : '/index.html'));
    if (!path.startsWith(buildRoot + sep)) {
      response.writeHead(403).end();
      return;
    }
    const contents = await readFile(path);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(4201, '127.0.0.1', () => console.log('Offline production test app: http://127.0.0.1:4201'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
