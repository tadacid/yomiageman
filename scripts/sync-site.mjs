import { cp, access, readdir } from 'node:fs/promises';
import path from 'node:path';
// This folder is the only source. sites/yomiageman is the ChatGPT Sites copy that gets published.
const site = 'sites/yomiageman';
await access(`${site}/.openai/hosting.json`).catch(()=>{throw new Error(`${site} is not the ChatGPT Sites project.`);});
await access('dist/index.html').catch(()=>{throw new Error('Run npm run build before syncing.');});
const dirs = ['web','dist','docs','scripts','tests'], files = ['README.md','package.json','package-lock.json'];
for(const dir of dirs) await cp(dir,`${site}/${dir}`,{recursive:true});
for(const file of files) await cp(file,`${site}/${file}`);
// Never delete in the published copy; report leftovers so they can be moved to the trash by hand.
async function list(dir) {
  const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);
  return (await Promise.all(entries.map(e=>e.isDirectory()?list(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();
}
const stale=[];
for(const dir of dirs) for(const file of await list(`${site}/${dir}`)) {
  if(!await access(path.relative(site,file)).then(()=>true,()=>false)) stale.push(file);
}
console.log(`Synced to ${site}.`+(stale.length?` Not in this folder (left as is):\n${stale.join('\n')}`:''));
