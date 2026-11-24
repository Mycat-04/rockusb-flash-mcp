import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { inspectImage, parseDevices, parseWindowsDevices, resolveImage, selectDevice } from '../rockusb.mjs';
import { checkUpgradeResult, runJob } from '../jobs.mjs';

const server = fileURLToPath(new URL('../server.mjs', import.meta.url));
const listing = 'List of rockusb connected(1)\nDevNo=1 Vid=0x2207,Pid=0x350e,LocationID=1a2    Mode=Maskrom    SerialNo=';
const [device] = parseDevices(listing);
async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rockusb-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('rockusb-test-'));
    return rm(dir, {recursive:true, force:true});
  });
  return dir;
}
function fixture() {
  const data = Buffer.alloc(256);
  data.write('RKFW');
  data.writeUInt16LE(102, 4);
  data.writeUInt32LE(102, 25);
  data.writeUInt32LE(32, 29);
  data.writeUInt32LE(134, 33);
  data.writeUInt32LE(90, 37);
  data.write('RKAF', 134);
  return data;
}
test('parse current and older discovery formats, reject ambiguous devices and missing rows', () => {
  assert.equal(selectDevice([device], '1A2').mode, 'maskrom');
  assert.equal(parseDevices(listing.replace('Mode=Maskrom', 'Loader'))[0].mode, 'loader');
  assert.deepEqual(parseDevices('List of rockusb connected(0)'), []);
  assert.throws(() => parseDevices(listing.replace('(1)', '(2)')), /Incomplete/);
  assert.throws(() => selectDevice([device,device], '1a2'), /exactly one/);
  assert.throws(() => selectDevice([device], 'fff'), /does not match/);
});
test('exit status and the explicit final success message must agree', () => {
  assert.doesNotThrow(() => checkUpgradeResult(0, null, 'Download Firmware Success\nUpgrade firmware ok.'));
  assert.throws(() => checkUpgradeResult(1,null,'Upgrade firmware ok.'), /stopped/);
  assert.throws(() => checkUpgradeResult(0,null,'Download Image... (100%)'), /without/);
});
test('Windows PnP distinguishes ADB and Rockusb without guessing boot mode from a PID', () => {
  const blocks = [
    'Instance ID: USB\\VID_2207&PID_0006\\board1\nDescription: Android ADB Interface\nService: WinUSB',
    '实例 ID: USB\\VID_2207&PID_350E\\board2\n服务: rockusb',
    'Instance ID: USB\\VID_2207&PID_350E\\board3\nDescription: Unknown Device',
    'Instance ID: USB\\VID_1234&PID_0006\\other\nDescription: ADB'
  ];
  const devices = parseWindowsDevices(blocks.join('\r\n\r\n'));
  assert.deepEqual(devices.map(device => device.mode), ['adb','rockusb','unknown']);
  assert.equal(devices[1].pid, '0x350e');
});
test('inspect envelope, extended sizes, SHA and firmware-directory boundary', async t => {
  const root = await temp(t);
  const sub = path.join(root, 'allowed');
  await mkdir(sub);
  const file = path.join(root, 'vendor-firmware.img');
  const data = fixture();
  await writeFile(file, data);
  await assert.rejects(resolveImage(sub, file), /outside/);
  assert.equal((await inspectImage(file)).sha256, createHash('sha256').update(data).digest('hex'));
  data.write('HI', 55);
  data.writeUInt32LE(1, 57);
  await writeFile(file, data);
  await assert.rejects(inspectImage(file), /layout/);
  await writeFile(file, Buffer.alloc(256));
  await assert.rejects(inspectImage(file), /RKFW/);
});
test('worker verifies staged image and USB identity before one write', async t => {
  const root = await temp(t);
  const dir = path.join(root, 'job');
  await mkdir(dir);
  const file = path.join(root, 'vendor.img');
  await writeFile(file, fixture());
  const plan = {image:await inspectImage(file), device, backend:'/mock'};
  let calls = 0;
  const write = async (_tool, target, staged) => {
    assert.equal(target.location, '1a2');
    assert.notEqual(staged, file);
    assert.deepEqual(await readFile(staged), fixture());
    calls++;
  };
  const status = async () => JSON.parse(await readFile(path.join(dir,'status.json'),'utf8'));
  await runJob(dir, plan, async () => [device], write);
  assert.equal((await status()).state, 'backend_succeeded');
  await runJob(dir, plan, async () => [{...device, pid:'0x330c'}], write);
  assert.match((await status()).message, /identity/);
  await runJob(dir, plan, async () => [device], async () => { throw Error('USB disconnected'); });
  assert.equal((await status()).state, 'failed');
  const changed = fixture();
  changed[180] = 5;
  await writeFile(file, changed);
  await runJob(dir, plan, async () => [device], write);
  assert.match((await status()).message, /contents changed/);
  assert.equal(calls, 1);
});
test('stdio client discovers tools, inspects image and cannot flash in read-only mode', async t => {
  const root = await temp(t);
  await writeFile(path.join(root,'demo.img'), fixture());
  const client = new Client({name:'smoke',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[server,'--firmware-dir',root]}));
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'list_firmware'));
  const result = await client.callTool({name:'inspect_firmware',arguments:{file:'demo.img'}});
  assert.equal(JSON.parse(result.content[0].text).format, 'RKFW/RKAF');
  const denied = await client.callTool({name:'flash_firmware',arguments:{plan_id:'feedbeef-cafe-4abc-8abc-000000000001'}});
  assert.equal(denied.isError, true);
});
test('directory selection lists exact choices and needs one human grant for an extra folder', async t => {
  const root = await temp(t);
  const other = await temp(t);
  await writeFile(path.join(other, 'debian.img'), fixture());
  await writeFile(path.join(other, 'ubuntu.IMG'), fixture());
  await writeFile(path.join(other, 'notes.txt'), 'not a firmware file');
  await mkdir(path.join(other, 'nested'));
  const client = new Client({name:'folder-test',version:'1'}, {capabilities:{elicitation:{form:{}}}});
  let grant = false;
  let prompts = 0;
  client.setRequestHandler(ElicitRequestSchema, async () => {
    prompts++;
    return grant ? {action:'accept', content:{allow:true}} : {action:'decline'};
  });
  await client.connect(new StdioClientTransport({command:process.execPath, args:[server,'--firmware-dir',root,'--ask-directory']}));
  t.after(() => client.close());
  const list = directory => client.callTool({name:'list_firmware',arguments:{directory}});
  const empty = await list(root);
  assert.deepEqual(JSON.parse(empty.content[0].text).files, []);
  assert.equal(prompts, 0);
  assert.equal((await list(other)).isError, true);
  grant = true;
  const result = JSON.parse((await list(other)).content[0].text);
  assert.deepEqual(result.files.map(file => path.basename(file)), ['debian.img','ubuntu.IMG']);
  const selected = await client.callTool({name:'inspect_firmware',arguments:{file:result.files[1]}});
  assert.equal(JSON.parse(selected.content[0].text).file, result.files[1]);
  assert.equal(prompts, 2);
  grant = false;
  assert.equal((await list(path.join(other, 'nested'))).isError, true);
});
test('Linux MCP client confirms or declines a mock upgrade and checks backend result', {skip:process.platform !== 'linux'}, async t => {
  const root = await temp(t);
  const backend = path.join(root, 'fake-tool');
  const image = path.join(root,'vendor.img');
  await writeFile(image, fixture());
  const script = '#!/bin/sh\nif [ "$1" = "ld" ]; then\necho "' + listing + '"\nexit 0\nfi\n[ "$1 $2 $3" = "-s 1a2 uf" ] && [ -f "$4" ] || exit 9\n';
  await writeFile(backend, script + 'echo "Upgrade firmware ok."\n', {mode:0o700});
  const client = new Client({name:'smoke',version:'1'}, {capabilities:{elicitation:{form:{}}}});
  let accept = false;
  client.setRequestHandler(ElicitRequestSchema, async () => accept ? {action:'accept',content:{authorize:true}} : {action:'decline'});
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[server,'--firmware-dir',root,'--upgrade-tool',backend,'--allow-flash'],env:{...process.env,XDG_STATE_HOME:root}}));
  t.after(() => client.close());
  const call = async (name,args) => {
    const result = await client.callTool({name,arguments:args});
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const go = async () => {
    const plan = await call('prepare_flash',{file:image,location:'1a2'});
    return call('flash_firmware',{plan_id:plan.plan_id});
  };
  assert.equal((await go()).state, 'cancelled');
  accept = true;
  for (const state of ['backend_succeeded','failed']) {
    const {job_id} = await go();
    let result;
    for (let i = 0; i < 150; i++) {
      result = await call('flash_status',{job_id});
      if (['failed','backend_succeeded'].includes(result.state)) break;
      await new Promise(done => setTimeout(done,100));
    }
    assert.equal(result.state, state, JSON.stringify(result));
    await writeFile(backend, script + 'echo "incomplete"\n');
  }
});
