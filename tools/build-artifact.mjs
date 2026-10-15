// Produces dist/artifact/index.html: the same page without the document
// skeleton tags (the claude.ai artifact host adds its own). The JS files are
// published alongside it unchanged.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

let html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
// title must lead the file
const title = html.match(/<title>.*?<\/title>\s*/)[0];
html = title + html.replace(title, '');
mkdirSync(new URL('../dist/artifact/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/artifact/index.html', import.meta.url), html);
console.log('wrote dist/artifact/index.html', html.length, 'bytes');
