// Exercise the same npm/stdio entry point a client uses, with an empty firmware directory.
import assert from 'node:assert/strict';
import {copyFile, mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
// Without a tarball, exercise the exact unversioned npx invocation from the client instructions.
const temporary = await mkdtemp(path.join(tmpdir(), 'rockusb-npx-'));
const firmware = path.join(temporary, 'Firmware');
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const client = new Client({name:'rockusb-package-check', version:'1'});
try {
  await mkdir(firmware);
  let packageSpec = process.argv[2] ?? pkg.name;
  if (packageSpec !== pkg.name && !packageSpec.startsWith('https://')) {
    await copyFile(path.resolve(packageSpec), path.join(temporary, 'candidate.tgz'));
    packageSpec = 'file:./candidate.tgz';
  }
  const transport = new StdioClientTransport({
    command:process.execPath,
    args:[npm, 'exec', '--', packageSpec],
    cwd:temporary,
    env:{...process.env, ROCKUSB_FIRMWARE_DIR:firmware, npm_config_cache:path.join(temporary, 'npm-cache')},
    stderr:'inherit'
  });
  await client.connect(transport, {timeout:240_000});
  const {tools} = await client.listTools();
  for (const name of ['server_status','list_firmware','execute_plan']) assert.ok(tools.some(tool => tool.name === name), name);
  const status = JSON.parse((await client.callTool({name:'server_status',arguments:{}})).content[0].text);
  assert.equal(status.version, pkg.version);
  assert.equal(status.firmware_directory, firmware);
  const listing = JSON.parse((await client.callTool({name:'list_firmware',arguments:{}})).content[0].text);
  assert.deepEqual(listing.files, []);
  console.log('Verified RockUSB %s via npm stdio: %s tools, server_status, list_firmware.', status.version, tools.length);
} finally {
  await client.close();
  await rm(temporary, {recursive:true, force:true, maxRetries:4, retryDelay:300});
}
