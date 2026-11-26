// Release step: copy every script and stylesheet to /assets/<name>.<content-hash>.<ext> and point the
// pages and the service worker at those files. Old hashed files are never deleted, so a tab or a
// cache from an earlier release always gets exactly the bytes it was built with, and a new page
// can never be handed an old script. Run it before every deploy (`npm run release`; `npm run deploy`
// and `npm run dev` run it for you). Edit files in src/ and the .css files, never in assets/.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
mkdirSync(assets, { recursive: true });
const hashOf = text => createHash('sha256').update(text).digest('hex').slice(0, 10);
const out = {};   // 'main.js' -> 'main.<hash>.js'

// leaves first, so a file's hash covers the hashes of everything it imports
const JS = ['config.js', 'core.js', 'queue.js', 'api.js', 'main.js', 'admin.js'];
for (const name of JS) {
  let text = readFileSync(join(root, 'src', name), 'utf8');
  text = text.replace(/from '\.\/([a-z]+\.js)'/g, (m, dep) => {
    if (!out[dep]) throw new Error(`${name} imports ${dep}, which isn't built yet: fix the order in release.mjs`);
    return `from './${out[dep]}'`;
  });
  const file = name.replace(/\.js$/, `.${hashOf(text)}.js`);
  if (!existsSync(join(assets, file))) writeFileSync(join(assets, file), text);
  out[name] = file;
}
for (const name of ['styles.css', 'doc.css']) {
  const text = readFileSync(join(root, name), 'utf8');
  const file = name.replace(/\.css$/, `.${hashOf(text)}.css`);
  if (!existsSync(join(assets, file))) writeFileSync(join(assets, file), text);
  out[name] = file;
}

// any earlier form of a reference: /src/main.js, /src/main.js?v=11, /assets/main.<hash>.js, /styles.css?v=11 ...
const ref = (name) => {
  const [base, ext] = name.split('.');
  const dir = ext === 'js' ? '(?:/src/|/assets/)' : '/(?:assets/)?';
  return new RegExp(`${dir}${base}(?:\\.[0-9a-f]{10})?\\.${ext}(?:\\?v=\\d+)?`, 'g');
};
const rewrite = (file, names) => {
  const p = join(root, file);
  let text = readFileSync(p, 'utf8');
  for (const n of names) text = text.replace(ref(n), `/assets/${out[n]}`);
  writeFileSync(p, text);
};
rewrite('index.html', ['main.js', 'styles.css']);
rewrite('admin.html', ['admin.js', 'styles.css', 'doc.css']);
rewrite('privacy.html', ['styles.css', 'doc.css']);
rewrite('sw.js', ['main.js', 'core.js', 'api.js', 'queue.js', 'config.js', 'styles.css', 'doc.css']);

// the service worker's cache name follows the release, so each release installs cleanly
const release = hashOf(JSON.stringify(out));
const swPath = join(root, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'r-${release}';`));

// a record of every release's files, so old ones can be pruned deliberately one day
const logPath = join(assets, 'releases.json');
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
if (!log.length || log[log.length - 1].release !== release) log.push({ release, at: new Date().toISOString(), files: out });
writeFileSync(logPath, JSON.stringify(log, null, 1) + '\n');
console.log(`release r-${release}`, out);
