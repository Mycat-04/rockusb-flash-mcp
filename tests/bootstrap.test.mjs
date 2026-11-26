import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {findReleasePageAssets, findWindowsRelease, verifyWindowsRelease} from '../bin/windows-release.mjs';

const cli = fileURLToPath(new URL('../bin/rockusb.mjs', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const filename = `rockusb-flash-mcp-${version}-windows-x64.zip`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contents = Buffer.from('test bundle');
const checksum = `${hash(contents)}  ${filename}\n`;

function manifest() {
  return {tag_name:`v${version}`, draft:false, assets:[
    [filename, contents], [filename + '.sha256', Buffer.from(checksum)]
  ].map(([name, file]) => ({name, size:file.length, digest:'sha256:' + hash(file),
    browser_download_url:`https://github.com/Mycat-04/rockusb-flash-mcp/releases/download/v${version}/${name}`}))};
}

test('the bootstrap selects only exact release and checksum assets for the pinned CLI version', () => {
  assert.equal(findWindowsRelease(manifest(), version).archive.hash, hash(contents));
  assert.throws(() => findWindowsRelease(manifest(), '1.0.0'), /published/);
  for (const change of [m => m.assets.pop(), m => m.assets.push(m.assets[0]), m => delete m.assets[0].digest,
    m => {m.assets[0].browser_download_url='https://example.com/bundle.zip';}]) {
    const release=manifest();
    change(release);
    assert.throws(() => findWindowsRelease(release, version), /release asset/);
  }
});

test('the public GitHub release page fallback requires exact asset names and SHA-256 digests', () => {
  const page=manifest().assets.map(asset =>
    `<a href="${new URL(asset.browser_download_url).pathname}"></a>` +
    `<clipboard-copy aria-label="Copy to clipboard digest for ${asset.name}" value="${asset.digest}"></clipboard-copy>`
  ).join('\n');
  const result=findReleasePageAssets(page,version);
  assert.equal(result.archive.hash, hash(contents));
  assert.equal(result.checksum.hash,hash(checksum));
  assert.throws(() => findReleasePageAssets(page,'1.0.0'), /digest/);
  assert.throws(() => findReleasePageAssets(page+page,version), /digest/);
  assert.throws(() => findReleasePageAssets(page.replace('value="sha256:', 'value="bad:'),version), /release asset/);
});

test('bootstrap rejects a modified archive or checksum before setup', async t => {
  const dir=await mkdtemp(path.join(tmpdir(), 'rockusb-bootstrap-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const zip=path.join(dir, filename), sum=zip+'.sha256';
  const spec=findWindowsRelease(manifest(), version);
  await writeFile(zip, contents);
  await writeFile(sum, checksum);
  await verifyWindowsRelease(zip, sum, spec);
  await writeFile(sum, checksum.replace(filename, 'other.zip'));
  await assert.rejects(verifyWindowsRelease(zip, sum, spec), /checksum mismatch/);
  await writeFile(sum, checksum);
  await writeFile(zip, Buffer.alloc(contents.length));
  await assert.rejects(verifyWindowsRelease(zip, sum, spec), /checksum mismatch/);
});

test('serve starts stdio and lists firmware without installing or registering anything', async t => {
  const dir=await mkdtemp(path.join(tmpdir(), 'rockusb-stdio-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const firmware=path.join(dir, 'firmware');
  await mkdir(firmware);
  await writeFile(path.join(firmware,'test.img'), contents);
  const args=[cli, 'serve', '--firmware-dir',firmware, '--read-only'];
  if (process.platform === 'win32') args.push('--target', path.join(dir, 'install'));
  const client=new Client({name:'bootstrap-test', version:'1.0'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath, args}));
    const call=async name => {
      const result=await client.callTool({name, arguments:{}});
      assert.ok(!result.isError, result.content[0].text);
      return JSON.parse(result.content[0].text);
    };
    const status=await call('server_status');
    assert.equal(status.version, version);
    assert.equal(status.write_enabled,false);
    assert.equal(path.basename((await call('list_firmware')).files[0]), 'test.img');
    assert.deepEqual(await readdir(dir), ['firmware']);
  } finally {await client.close();}
});
