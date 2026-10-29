import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
const revision = 'b8f84f0b80c529de40b4fbb3544b84fa7233a513';
const base = `https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/${revision}/`;
await mkdir('build/models/paddle-v6', { recursive: true });
const sources=[];
for(const [remote,local] of [['inference.onnx','rec.onnx'],['inference.yml','inference.yml']]) {
 const response=await fetch(base+remote);
 if(!response.ok) throw new Error(`Model download failed: ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 await writeFile('build/models/paddle-v6/'+local,bytes);
 sources.push({url:base+remote,sha256:createHash('sha256').update(bytes).digest('hex')});
 if(remote.endsWith('.yml')) {
  const config=parse(bytes.toString('utf8'));
  await writeFile('build/models/paddle-v6/dictionary.json',JSON.stringify(['',...config.PostProcess.character_dict,' ']));
 }
}
await writeFile('build/models/paddle-v6/source.json',JSON.stringify({revision,sources},null,2));
console.log('PP-OCRv6 small recognition model and dictionary ready.');
const license=await fetch('https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/LICENSE');
if(!license.ok) throw new Error('Model license download failed');
await writeFile('build/models/paddle-v6/LICENSE',await license.text());
const ortLicense=await fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/LICENSE');
if(!ortLicense.ok) throw new Error('Runtime license download failed');
await writeFile('build/models/ORT-LICENSE',await ortLicense.text());
