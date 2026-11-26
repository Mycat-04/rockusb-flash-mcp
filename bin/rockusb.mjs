#!/usr/bin/env node
import {mkdir, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {installWindows} from './windows-release.mjs';

const {version} = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const help = `RockUSB Flash MCP ${version}

  rockusb-flash-mcp install [--client auto|codex|claude|none] [--firmware-dir DIR]
      Install the verified Windows x64 release and register the selected clients.
      Optional: --target DIR, --cache DIR, --stage-only (prepare an offline cache).

  rockusb-flash-mcp [serve] [--firmware-dir DIR] [--read-only]
      Start the local stdio server. Firmware defaults to your Firmware folder or the
      path saved by Windows setup. Optional: --target DIR (Windows installation),
      --upgrade-tool FILE, --sd-tool FILE, --adb FILE (native tool overrides).
      On Linux set --upgrade-tool or ROCKUSB_UPGRADE_TOOL to the Linux executable.

  rockusb-flash-mcp --version`;

async function savedFirmwareDir(target) {
  let config;
  try {
    config = JSON.parse(await readFile(path.join(target, 'mcp-config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw Error(`Could not read the RockUSB configuration in ${target}: ${error.message}`);
  }
  const args = config.mcpServers?.rockusb?.args;
  if (!Array.isArray(args)) return;
  const index = args.indexOf('--firmware-dir');
  if (index !== -1 && typeof args[index + 1] === 'string' && path.isAbsolute(args[index + 1])) return args[index + 1];
}

async function serve(args) {
  if (!['win32', 'linux'].includes(process.platform)) throw Error('RockUSB supports Windows x64 and Linux USB hosts.');
  const {values} = parseArgs({args, options:{target:{type:'string'}, 'firmware-dir':{type:'string'},
    'read-only':{type:'boolean'}, 'upgrade-tool':{type:'string'}, 'sd-tool':{type:'string'}, adb:{type:'string'}}});
  const serverURL = new URL('../server.mjs', import.meta.url);
  const serverArgs = [];
  let firmware = values['firmware-dir'] || process.env.ROCKUSB_FIRMWARE_DIR;
  let managed = {};
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') throw Error('Use 64-bit x64 Node.js for RockUSB on Windows.');
    const {defaultWindowsTarget, windowsToolPaths} = await import('../scripts/setup-windows.mjs');
    const target = path.resolve(values.target || defaultWindowsTarget());
    firmware ||= await savedFirmwareDir(target);
    managed = windowsToolPaths(target);
    serverArgs.push('--auto-tools-dir', target);
  } else if (values.target) {
    throw Error('--target selects a Windows installation. On Linux use --firmware-dir and --upgrade-tool.');
  }
  const directory = path.resolve(firmware || path.join(homedir(), 'Firmware'));
  await mkdir(directory, {recursive:true});
  serverArgs.push('--firmware-dir', directory, '--ask-directory');
  const backends = {'upgrade-tool':values['upgrade-tool'] || process.env.ROCKUSB_UPGRADE_TOOL || managed.usb,
    'sd-tool':values['sd-tool'] || managed.sd, adb:values.adb || managed.adb};
  for (const [name, file] of Object.entries(backends)) {
    if (!file) continue;
    if (!path.isAbsolute(file)) throw Error(`--${name} requires an absolute path.`);
    serverArgs.push('--' + name, file);
  }
  if (!values['read-only']) serverArgs.push('--allow-flash');
  // Keep the MCP transport attached to the client process's actual stdin and stdout.
  process.argv = [process.execPath, fileURLToPath(serverURL), ...serverArgs];
  await import(serverURL.href);
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...args] = argv;
  if (command === '--version' || command === '-v') return console.log(version);
  if (['--help','-h','help'].includes(command) || args.includes('--help')) return console.log(help);
  if (command === undefined || command.startsWith('-')) return serve(argv);
  if (command === 'serve') return serve(args);
  if (command === 'install') {
    const {values} = parseArgs({args, options:{target:{type:'string'}, cache:{type:'string'},
      'firmware-dir':{type:'string'}, 'stage-only':{type:'boolean'}, client:{type:'string'}}});
    if (values.client && !['auto','codex','claude','none'].includes(values.client)) throw Error('Unknown --client. Choose auto, codex, claude or none.');
    return installWindows(version, args);
  }
  throw Error(`Unknown command: ${command}. Run rockusb-flash-mcp --help.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
