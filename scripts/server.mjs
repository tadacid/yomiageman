import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const baseline = path.resolve('build/ocr-baseline');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname);
    // Development-only fixtures. They are never copied into the deployable dist/.
    const fixtures = { '/__test/vision.html': 'tests/vision.html', '/__test/reference.webp': 'build/reference-dialogue.webp', '/__test/heldout.png':'build/ocr-v04/heldout.png', '/__test/corpus.html':'tests/corpus.html' };
    const isBaseline=name.startsWith('/__baseline/') || name.startsWith('/__v03/');
    const baselineRoot=name.startsWith('/__v03/')?path.resolve('build/ocr-v04/dist-v03'):baseline;
    const file = isBaseline ? path.resolve(baselineRoot,name.replace(/^\/__(?:baseline|v03)\//,'')) : fixtures[name] ? path.resolve(fixtures[name]) : path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
    if (isBaseline ? !file.startsWith(baselineRoot+path.sep) : !fixtures[name] && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173'));
