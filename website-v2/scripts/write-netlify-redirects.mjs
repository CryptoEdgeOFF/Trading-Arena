import { writeFile } from 'node:fs/promises';

const target = String(process.env.API_PROXY_TARGET || '').replace(/\/+$/, '');
const rules = [];

if (target) {
  rules.push(`/api/* ${target}/api/:splat 200`);
  rules.push(`/uploads/* ${target}/uploads/:splat 200`);
  rules.push(`/spectate/* ${target}/spectate/:splat 200`);
}

rules.push('/* /index.html 200');
await writeFile(new URL('../dist/_redirects', import.meta.url), `${rules.join('\n')}\n`);

if (!target) {
  console.warn('[deploy] API_PROXY_TARGET absent: seules les routes SPA seront configurées.');
}
