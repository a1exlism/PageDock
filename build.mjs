import { packager } from '@electron/packager';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Usage: npm run build -- <output-directory>');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build requires macOS on Apple silicon.');
const out = path.resolve(output);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtimeFiles = ['package.json', pkg.main, ...pkg.files].map(file => `/${file}`);
const finalDir = path.join(out, `${pkg.productName}-darwin-arm64`);
if (existsSync(finalDir)) throw new Error(`Output already exists: ${finalDir}`);
mkdirSync(out, { recursive: true });
const assets = path.join(out, '.build-assets');
mkdirSync(assets, { recursive: true });
execFileSync('/usr/bin/xcrun', ['swift', '-module-cache-path', path.join(assets, 'swift-cache'), path.join(root, 'icon.swift'), assets], { stdio: 'inherit' });
const [directory] = await packager({
  dir: root, out, name: pkg.productName, platform: 'darwin', arch: 'arm64',
  electronVersion: pkg.devDependencies.electron, appBundleId: 'local.webpage.app',
  download: { cacheRoot: process.env.electron_config_cache || path.join(assets, 'electron-cache') },
  appVersion: pkg.version, buildVersion: pkg.version, appCategoryType: 'public.app-category.productivity',
  icon: path.join(assets, 'AppIcon.icns'),
  ignore: entry => entry !== '' && !runtimeFiles.some(file => file === entry || file.startsWith(`${entry}/`)),
  prune: false, overwrite: false,
  extendInfo: { NSCameraUsageDescription: '在您允许后，网页可以使用摄像头。', NSMicrophoneUsageDescription: '在您允许后，网页可以使用麦克风。', NSLocalNetworkUsageDescription: '打开您保存的局域网网页和本地服务。' }
});
const bundle = path.join(directory, `${pkg.productName}.app`);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
rmSync(assets, { recursive: true });
console.log(bundle);
