import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const repository = 'Mycat-04/rockusb-flash-mcp';

// Resolve assets against the release for *this CLI version*, even if a newer tag exists.
export function findWindowsRelease(release, version) {
  const tag = `v${version}`;
  const filename = `rockusb-flash-mcp-${version}-windows-x64.zip`;
  if (release.tag_name !== tag || release.draft || !Array.isArray(release.assets)) {
    throw Error(`GitHub did not return the published RockUSB ${tag} release.`);
  }
  function find(name) {
    const assets = release.assets.filter(asset => asset.name === name);
    const url = `https://github.com/${repository}/releases/download/${tag}/${name}`;
    if (assets.length !== 1 || assets[0].browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(assets[0].digest)) {
      throw Error(`Missing or invalid release asset: ${name}`);
    }
    return {url, hash:assets[0].digest.slice(7), size:assets[0].size};
  }
  return {filename, archive:find(filename), checksum:find(filename + '.sha256')};
}

// GitHub publishes the same asset digests on its release page when its anonymous API quota is exhausted.
export function findReleasePageAssets(html, version) {
  const prefix = `/${repository}/releases/download/v${version}/`;
  const filename = `rockusb-flash-mcp-${version}-windows-x64.zip`;
  const tags = html.match(/<clipboard-copy\b[^>]*>/gi) || [];
  const assets = [filename, filename + '.sha256'].map(name => {
    const urlPath = prefix + name;
    const matches = tags.filter(tag => tag.includes(`aria-label="Copy to clipboard digest for ${name}"`));
    if (matches.length !== 1 || !html.includes(`href="${urlPath}"`)) {
      throw Error(`Could not verify the GitHub release digest for ${name}.`);
    }
    const digest = /\bvalue="(sha256:[0-9a-f]{64})"/.exec(matches[0])?.[1];
    return {name, digest, browser_download_url:'https://github.com' + urlPath};
  });
  return findWindowsRelease({tag_name:`v${version}`, assets}, version);
}

export async function verifyWindowsRelease(archive, checksum, spec) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha = hash.digest('hex');
  const checkBytes = await readFile(checksum);
  const words = checkBytes.toString('utf8').trim().split(/\s+/);
  if (sha !== spec.archive.hash || (spec.archive.size !== undefined && (await stat(archive)).size !== spec.archive.size) ||
      createHash('sha256').update(checkBytes).digest('hex') !== spec.checksum.hash ||
      words.length !== 2 || words[0] !== sha || words[1] !== spec.filename) {
    throw Error('Windows package checksum mismatch. Setup was stopped before extraction.');
  }
}

export async function installWindows(version, args) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw Error('Automatic installation requires Windows x64. For a Linux USB host use serve --upgrade-tool /absolute/path/to/upgrade_tool.');
  }
  const system = path.join(process.env.SystemRoot, 'System32');
  const curl = path.join(system, 'curl.exe');
  const tar = path.join(system, 'tar.exe');
  const curlOptions = ['--disable', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '2', '--connect-timeout', '20', '--max-time', '300'];
  console.error(`Downloading the verified Windows installer for RockUSB ${version}…`);
  async function getRelease() {
    try {
      const {stdout} = await exec(curl, [...curlOptions, `https://api.github.com/repos/${repository}/releases/tags/v${version}`], {windowsHide:true});
      return findWindowsRelease(JSON.parse(stdout), version);
    } catch (error) {
      if (error.code !== 22 || !/\b(?:403|429)\b/.test(error.stderr || '')) throw error;
      const page = `https://github.com/${repository}/releases/expanded_assets/v${version}`;
      const {stdout} = await exec(curl, [...curlOptions, page], {windowsHide:true});
      return findReleasePageAssets(stdout, version);
    }
  }
  const spec = await getRelease();
  const stage = await mkdtemp(path.join(tmpdir(), 'rockusb-release-'));
  try {
    const archive = path.join(stage, spec.filename);
    const checksum = archive + '.sha256';
    await exec(curl, [...curlOptions, '-o', checksum, spec.checksum.url], {windowsHide:true});
    await exec(curl, [...curlOptions, '-o', archive, spec.archive.url], {windowsHide:true});
    await verifyWindowsRelease(archive, checksum, spec);
    await exec(tar, ['-xf', archive, '-C', stage, './node.exe', './setup-windows.mjs', './release.json', './app.tgz', './NODE-LICENSE.txt'], {windowsHide:true});
    const manifest = JSON.parse(await readFile(path.join(stage, 'release.json'), 'utf8'));
    if (manifest.version !== version) throw Error('Installer version differs from the requested release.');
    // Run with the matching bundled Node; setup checks both runtime and payload before use.
    const child = spawn(path.join(stage, 'node.exe'), [path.join(stage, 'setup-windows.mjs'), ...args], {stdio:'inherit', windowsHide:true});
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`RockUSB setup failed (${signal || code}).`)));
    });
  } finally {
    await rm(stage, {recursive:true, force:true, maxRetries:3});
  }
}
