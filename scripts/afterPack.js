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

  const sdks = [
    '@anthropic-ai/claude-code',
    '@anthropic-ai/claude-agent-sdk',
  ];

  let removed = 0;

  for (const sdk of sdks) {
    // Remove non-target-platform ripgrep binaries
    for (const dir of toRemove) {
      const fullPath = path.join(unpackedDir, sdk, 'vendor', 'ripgrep', dir);
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true });
        removed++;
        console.log(`  afterPack: removed ${sdk}/vendor/ripgrep/${dir}`);
      }
    }

    // Remove non-target-platform audio-capture binaries
    for (const dir of toRemove) {
      const fullPath = path.join(unpackedDir, sdk, 'vendor', 'audio-capture', dir);
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true });
        removed++;
        console.log(`  afterPack: removed ${sdk}/vendor/audio-capture/${dir}`);
      }
    }

    // Remove seccomp (Linux-only) on non-Linux builds
    if (platform !== 'linux') {
      const seccompPath = path.join(unpackedDir, sdk, 'vendor', 'seccomp');
      if (fs.existsSync(seccompPath)) {
        fs.rmSync(seccompPath, { recursive: true });
        removed++;
        console.log(`  afterPack: removed ${sdk}/vendor/seccomp`);
      }
    }
  }

  if (removed > 0) {
    console.log(`  afterPack: cleaned ${removed} non-${platformSuffix} entries`);
  }
};
