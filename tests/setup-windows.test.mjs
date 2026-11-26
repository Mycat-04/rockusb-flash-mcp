import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {components, registerClaude, registerCodex, selectFirmwareDirectory, windowsToolPaths} from '../scripts/setup-windows.mjs';

const target=path.resolve('sample user','RockUSB');
const previous={type:'stdio',command:path.join(target,'app-0123456789abcdef-01234567','node.exe'),
  args:['server.mjs'],env:{ROCKUSB_TEST:'retained'}};
const updated={type:'stdio',command:path.join(target,'app-aaaaaaaaaaaaaaaa-bbbbbbbb','node.exe'),args:['new-server.mjs']};
const conflict=Object.assign(Error('duplicate'),{stderr:'MCP server rockusb already exists in user config'});

test('re-install keeps a previously chosen absolute firmware directory unless explicitly overridden',()=>{
  const firmware=path.resolve('downloads with spaces');
  const prior=args=>({mcpServers:{rockusb:{args}}});
  assert.equal(selectFirmwareDirectory(undefined,prior(['--firmware-dir',firmware])),firmware);
  assert.equal(selectFirmwareDirectory('new',prior(['--firmware-dir',firmware])),path.resolve('new'));
  assert.equal(selectFirmwareDirectory(undefined,prior(['--firmware-dir','--allow-flash']),firmware),firmware);
});

test('backend paths point to pinned executables tracked by the manifest',()=>{
  const paths=windowsToolPaths(target);
  assert.deepEqual(Object.keys(paths).sort(),['adb','sd','usb']);
  for (const [name,exe] of Object.entries(paths)) {
    const spec=components[name];
    const dir=path.join(target,'tools',name+'-'+spec.hash.slice(0,12));
    assert.ok(Object.hasOwn(spec.files,path.relative(dir,exe).split(path.sep).join('/')));
  }
});

test('an unchanged Claude Code transport is already registered',()=>{
  registerClaude(()=>assert.fail('must not alter user config'),previous,previous,target);
});

test('Codex can upgrade an owned transport and refuses to overwrite a user setting',()=>{
  const config={name:'rockusb',transport:{command:previous.command,args:previous.args}};
  let calls=[];
  const invoke=args=>{calls.push(args); if(args[1]==='list')return JSON.stringify([config]);};
  registerCodex(invoke,updated,target);
  assert.deepEqual(calls.map(call=>call[1]),['list','add']);
  calls=[];
  config.startup_timeout_sec=150;
  assert.throws(()=>registerCodex(invoke,updated,target),/custom rockusb registration/);
  assert.deepEqual(calls.map(call=>call[1]),['list']);
  calls=[];
  registerCodex(invoke,previous,target);
  assert.deepEqual(calls.map(call=>call[1]),['list']);
});

test('a collision with a different user registration preserves it',()=>{
  const calls=[];
  const external={...previous,command:path.join(target,'custom','node.exe')};
  assert.throws(()=>registerClaude(args=>{calls.push(args);throw conflict;},updated,external,target),/already has a different/);
  assert.deepEqual(calls.map(call=>call[1]),['add-json']);
});

test('upgrading an owned Claude Code registration preserves additional MCP settings',()=>{
  const calls=[];
  registerClaude(args=>{calls.push(args);if(calls.length===1)throw conflict;},updated,previous,target);
  assert.deepEqual(calls.map(call=>call[1]),['add-json','remove','add-json']);
  assert.deepEqual(JSON.parse(calls.at(-1).at(-1)),{...previous,...updated});
});

test('a failed Claude Code upgrade restores the prior entry',()=>{
  const calls=[];
  assert.throws(()=>registerClaude(args=>{
    calls.push(args);
    if(calls.length===1)throw conflict;
    if(calls.length===3)throw Error('registration failed');
  },updated,previous,target),/registration failed/);
  assert.deepEqual(JSON.parse(calls.at(-1).at(-1)),previous);
});
