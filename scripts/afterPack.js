const fs = require('fs');
const path = require('path');

module.exports = async function (context) {
  const platform = context.electronPlatformName;

  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    resourcesDir = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(context.appOutDir, 'resources');
  }

  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');
  if (!fs.existsSync(unpackedDir)) return;

  const platformSuffix = { darwin: 'darwin', linux: 'linux', win32: 'win32' }[platform];
  if (!platformSuffix) return;

  const allPlatformDirs = ['x64-darwin', 'arm64-darwin', 'x64-linux', 'arm64-linux', 'x64-win32', 'arm64-win32'];
  const toRemove = allPlatformDirs.filter(d => !d.endsWith(`-${platformSuffix}`));

  const ripgrepParents = [
    '@anthropic-ai/claude-code/vendor/ripgrep',
    '@anthropic-ai/claude-agent-sdk/vendor/ripgrep',
  ];

  let removed = 0;
  for (const parent of ripgrepParents) {
    for (const dir of toRemove) {
      const fullPath = path.join(unpackedDir, parent, dir);
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true });
        removed++;
        console.log(`  afterPack: removed ${parent}/${dir}`);
      }
    }
  }

  if (removed > 0) {
    console.log(`  afterPack: cleaned ${removed} non-${platformSuffix} ripgrep directories`);
  }
};
