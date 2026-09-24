// Packs the built demo into one self-contained HTML body for publishing as an
// Artifact: CSS and JS are inlined, and the document wrapper tags are dropped
// (the host supplies <!doctype>, <html>, <head> and <body>).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, file) => {
  const css = readFileSync(join(dist, file), 'utf8');
  return `<style>\n${css}\n</style>`;
});
let scripts = '';
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  scripts += `<script type="module">\n${js}\n</script>\n`;
  return '';
});

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keepHead = head
  .split('\n')
  .filter((line) => !/<meta charset|<meta name="viewport"/.test(line))
  .join('\n');
const out = `${keepHead.trim()}\n${body.trim()}\n${scripts}`;
writeFileSync(join(dist, 'artifact.html'), out);
console.log(`artifact.html: ${(out.length / 1024).toFixed(0)} KB`);
