import { readFile, writeFile } from 'node:fs/promises';

const files = ['engine.js', 'data.js', 'app.js', 'prompt.txt', 'styles.css'];
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(`dist/${file}`, 'utf8')])));
const archive = await readFile('dist/project.zip');
const script = `${sources['data.js'].replace('export const SAMPLE', 'const SAMPLE')}\n${sources['engine.js'].replace('export function buildSummary', 'function buildSummary')}\n${sources['app.js'].replace(/^import .*;\r?\n/gm, '')}`;
new Function(script); // Parse the combined browser script without executing it.
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
let html = await readFile('dist/index.html', 'utf8');
html = html.replace(/<link rel="stylesheet" href="styles\.css(?:\?[^"]*)?">/, `<style>${sources['styles.css'].replace(/^@import[^\n]+\n/, '')}</style>`);
html = html.replace(/<script type="module" src="app\.js(?:\?[^"]*)?"><\/script>/, '');
html = html.replace('</body>', `<script>globalThis.__DEMO_SOURCES__=${safeJson(sources)};globalThis.__DEMO_ARCHIVE__=${safeJson(archive.toString('base64'))};</script><script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script></body>`);
if (!html.includes('<style>:root')) throw new Error('Portable stylesheet was not embedded correctly');
await writeFile('../Russmarket_Demo.html', html);
console.log(`Portable demo: ${Buffer.byteLength(html)} bytes; includes source project archive.`);
