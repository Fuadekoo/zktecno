/**
 * electron-builder config. The backend's node_modules is copied selectively: only the packages the
 * server needs at runtime (its dependencies and theirs), without the Prisma CLI and its engines
 * (migrations run from the app itself) and without build tools.
 */
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..', 'backend');
const NM = path.join(BACKEND, 'node_modules');
/** Not needed at runtime: the CLI is only used in development (`prisma migrate`, `prisma generate`). */
const SKIP = new Set(['prisma']);

function runtimePackages() {
  const root = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const seen = new Set();
  const queue = Object.keys(root.dependencies || {}).filter((d) => !SKIP.has(d));
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkgFile = path.join(NM, name, 'package.json');
    if (!fs.existsSync(pkgFile)) continue; // optional dependency not installed on this platform
    seen.add(name);
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    for (const dep of [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {})]) {
      if (!seen.has(dep) && !SKIP.has(dep)) queue.push(dep);
    }
  }
  return [...seen].sort();
}

const packages = runtimePackages();

module.exports = {
  appId: 'com.zkteco.attendance.desktop',
  productName: 'ZK Attendance',
  directories: { output: 'release' },
  files: ['main.js', 'preload.js', 'setup.html', 'package.json', 'assets/**'],
  extraResources: [
    { from: '../backend/dist', to: 'backend/dist', filter: ['**/*', '!**/*.map'] },
    { from: '../backend/package.json', to: 'backend/package.json' },
    { from: '../backend/prisma/migrations', to: 'backend/prisma/migrations' },
    {
      from: '../backend/node_modules',
      to: 'backend/node_modules',
      filter: [
        ...packages.map((p) => `${p}/**/*`),
        '!**/*.map', '!**/*.md', '!**/*.d.ts', '!**/*.d.mts', '!**/*.d.cts',
        // Prisma ships a query compiler for every database; this app only uses MySQL
        '!@prisma/client/runtime/*{postgresql,sqlite,sqlserver,cockroachdb}*',
      ],
    },
    { from: '../frontend/out', to: 'frontend' },
  ],
  icon: 'build/icon.png',
  win: { target: 'nsis', icon: 'build/icon.png' },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'ZK Attendance',
    // Start the app (and its server) when the installer finishes
    runAfterFinish: true,
  },
};
