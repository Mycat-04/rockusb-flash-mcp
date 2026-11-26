import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './setup-windows.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Build this package with x64 Node on Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.argv[2] || 'dist');
const system = path.join(process.env.SystemRoot, 'System32');
const tar = path.join(system, 'tar.exe');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const prefix = path.join(out, pkg.name + '-' + pkg.version);
const appFiles = [
  'server.mjs', 'rockusb.mjs', 'loader.mjs', 'console-loader.mjs', 'jobs.mjs', 'operations.mjs', 'sd.mjs',
  'package.json', 'package-lock.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD-PARTY.md'
];

async function checksum(file) {
  const hash = await digest(file);
  await writeFile(file + '.sha256', hash + '  ' + path.basename(file) + '\n');
  console.log(path.basename(file) + '  ' + hash);
}

await mkdir(out, {recursive: true});
const work = await mkdtemp(path.join(out, 'bundle-'));
try {
  const app = path.join(work, 'app');
  const zipRoot = path.join(work, 'windows');
  await mkdir(app);
  await mkdir(zipRoot);
  for (const name of appFiles) await copyFile(path.join(root, name), path.join(app, name));

  // Release only locked registry packages; never copy a developer's local node_modules.
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  execFileSync(process.execPath, [npm, 'ci', '--omit=dev', '--include=optional', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'],
    {cwd: app, stdio: 'inherit'});
  execFileSync(process.execPath, ['-e', "require('@serialport/bindings-cpp').autoDetect(); require('node-pty')"], {cwd: app});

  const archive = path.join(zipRoot, 'app.tgz');
  execFileSync(tar, ['-czf', archive, '--exclude', 'node_modules/.bin', '--exclude', '*.pdb',
    '--exclude', 'node_modules/node-pty/prebuilds/darwin-*', '--exclude', 'node_modules/node-pty/prebuilds/win32-arm64',
    '--exclude', 'node_modules/node-pty/third_party/conpty/*/win10-arm64', '-C', app, ...appFiles, 'node_modules']);
  await copyFile(process.execPath, path.join(zipRoot, 'node.exe'));
  const license = path.join(zipRoot, 'NODE-LICENSE.txt');
  if (process.argv[3]) await copyFile(path.resolve(process.argv[3]), license);
  else execFileSync(path.join(system, 'curl.exe'), ['-fLsS', '--retry', '2', '--connect-timeout', '20', '--max-time', '120',
    '--proto', '=https', '--proto-redir', '=https', 'https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE', '-o', license]);
  await copyFile(path.join(root, 'scripts', 'setup-windows.mjs'), path.join(zipRoot, 'setup-windows.mjs'));
  for (const name of ['README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD-PARTY.md']) {
    await copyFile(path.join(app, name), path.join(zipRoot, name));
  }
  const launcher = [
    '@echo off', 'setlocal DisableDelayedExpansion', '"%~dp0node.exe" "%~dp0setup-windows.mjs" %*',
    'set "result=%errorlevel%"', 'if "%~1"=="" pause', 'exit /b %result%', ''
  ].join('\r\n');
  await writeFile(path.join(zipRoot, 'Install-RockUSB.cmd'), launcher);
  await writeFile(path.join(zipRoot, 'release.json'), JSON.stringify({
    version: pkg.version, node: process.version, payload: await digest(archive), runtime: await digest(process.execPath)
  }) + '\n');
  const windowsZip = prefix + '-windows-x64.zip';
  execFileSync(tar, ['-acf', windowsZip, '-C', zipRoot, '.']);
  await checksum(windowsZip);

  const sources = [...appFiles, '.gitignore'];
  for (const dir of ['scripts', 'tests']) {
    for (const entry of await readdir(path.join(root, dir), {withFileTypes: true})) {
      if (entry.isFile() && entry.name.endsWith('.mjs')) sources.push(dir + '/' + entry.name);
    }
  }
  const sourceZip = prefix + '-source.zip';
  execFileSync(tar, ['-acf', sourceZip, '-C', root, ...sources]);
  await checksum(sourceZip);
} finally {
  if (path.dirname(work) !== out) throw Error('Unexpected build staging directory.');
  await rm(work, {recursive: true, force: true, maxRetries: 3});
}
