import { cp, mkdir, access, writeFile, rename } from 'node:fs/promises';
await access('build/models/paddle-v6/rec.onnx').catch(()=>{throw new Error('Run npm run setup:model before building.');});
// Retain the old output locally; never mix obsolete OCR assets into a new release.
await mkdir('build',{recursive:true});
try { await rename('dist',`build/dist-previous-${Date.now()}`); } catch(e) { if(e.code!=='ENOENT') throw e; }
await mkdir('dist/vendor/ort',{recursive:true});
await cp('web','dist',{recursive:true});
for(const name of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) await cp(`node_modules/onnxruntime-web/dist/${name}`,`dist/vendor/ort/${name}`);
await cp('build/models/ORT-LICENSE','dist/vendor/ort/LICENSE');
await mkdir('dist/vendor/paddle-v6',{recursive:true});
for(const name of ['rec.onnx','dictionary.json','source.json','LICENSE']) await cp(`build/models/paddle-v6/${name}`,`dist/vendor/paddle-v6/${name}`);
await writeFile('dist/_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(self), microphone=()\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\n/sw.js\n  Cache-Control: no-cache\n`);
console.log('Built dist/ — static website with local PP-OCRv6 recognition.');
