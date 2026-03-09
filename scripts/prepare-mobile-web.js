const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'mobile-web');

const copyTargets = [
  'index.html',
  'manifest.json',
  'sw.js',
  'mobile-config.js',
  'pwa-icon.svg'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

ensureDir(outDir);
emptyDir(outDir);

for (const file of copyTargets) {
  fs.copyFileSync(path.join(projectRoot, file), path.join(outDir, file));
}

fs.cpSync(path.join(projectRoot, 'icons'), path.join(outDir, 'icons'), { recursive: true });
fs.cpSync(path.join(projectRoot, 'runners'), path.join(outDir, 'runners'), { recursive: true });

console.log(`Prepared mobile web assets in ${outDir}`);
