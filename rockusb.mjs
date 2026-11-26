import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function resolveImage(root, filename) {
  const dir = await realpath(root);
  const file = await realpath(path.resolve(dir, filename));
  const relative = path.relative(dir, file);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Image is outside the configured firmware directory.');
  }
  if (!(await stat(file)).isFile()) throw new Error('Select a regular firmware file.');
  return file;
}

export async function inspectImage(file) {
  const handle = await open(file, 'r');
  try {
    const {size} = await handle.stat();
    const header = Buffer.alloc(102);
    const {bytesRead} = await handle.read(header, 0, header.length, 0);
    if (bytesRead < header.length || header.toString('ascii', 0, 4) !== 'RKFW') {
      throw new Error('Expected an unpacked Rockchip RKFW update.img. Raw disk, partition and compressed images use different workflows.');
    }
    const headerSize = header.readUInt16LE(4);
    const bootStart = header.readUInt32LE(25);
    const bootSize = header.readUInt32LE(29);
    const fwStart = header.readUInt32LE(33);
    let fwSize = header.readUInt32LE(37);
    if (header.toString('ascii', 55, 57) === 'HI') fwSize += header.readUInt32LE(57) * 2 ** 32;
    if (headerSize < header.length || bootStart < headerSize || !bootSize || fwStart < bootStart + bootSize ||
        fwSize < 4 || !Number.isSafeInteger(fwStart + fwSize) || fwStart + fwSize > size) {
      throw new Error('Invalid or unsupported RKFW layout. Check the firmware download and packer version.');
    }
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, 4, fwStart);
    if (magic.toString('ascii') !== 'RKAF') throw new Error('This prototype expects an RKAF partition package inside RKFW.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file, {fd:handle.fd, autoClose:false, start:0})) hash.update(chunk);
    return {file, bytes:size, format:'RKFW/RKAF', headerChipCode:'0x' + header.readUInt32LE(21).toString(16), sha256:hash.digest('hex')};
  } finally {
    await handle.close();
  }
}

export function parseDevices(output) {
  const lines = output.split(/\r?\n/);
  const devices = [];
  for (const line of lines.filter(s => /\bDevNo\s*=/i.test(s))) {
    const fields = line.match(/\bVid=(0x[\da-f]+),\s*Pid=(0x[\da-f]+),\s*LocationID=([\da-f]+)\s+(?:Mode=)?(\w+)/i);
    if (!fields) throw new Error('Unrecognized upgrade_tool device row. Inspect upgrade_tool ld on the host.');
    const [,vid,pid,location,mode] = fields;
    const serial = line.match(/\bSerialNo=([^\s]*)/i)?.[1] ?? '';
    devices.push({vid:vid.toLowerCase(),pid:pid.toLowerCase(),location:location.toLowerCase(),mode:mode.toLowerCase(),serial});
  }
  const count = output.match(/List of rockusb connected\s*\((\d+)\)/i);
  if (count && Number(count[1]) !== devices.length) throw new Error('Incomplete device list from upgrade_tool.');
  if (!devices.length && !count && !/no .*device|not found any rockusb/i.test(output)) throw new Error('Unrecognized device list; check USB permissions and upgrade_tool version.');
  return devices;
}

export function parseWindowsDevices(output) {
  const devices = [];
  for (const block of output.split(/\r?\n[ \t]*\r?\n/)) {
    // Match the full PnP instance ID, not a hardware or compatible ID.
    const match = block.match(/\b(USB\\VID_2207&PID_([0-9a-f]{4})(?:&[\w]+)*\\[^\s]+)\s*$/im);
    if (!match) continue;
    let mode = 'unknown';
    if (/\brockusb(?:\b|\.sys)/i.test(block)) mode = 'rockusb';
    else if (/\bADB\b|AndroidUsbDeviceClass/i.test(block)) mode = 'adb';
    devices.push({vid:'0x2207', pid:'0x' + match[2].toLowerCase(), mode, instanceId:match[1]});
  }
  return devices;
}

export async function listDevices(backend) {
  if (process.platform === 'win32' && !backend) {
    const pnp = path.join(process.env.SystemRoot, 'System32', 'pnputil.exe');
    const result = await run(pnp, ['/enum-devices', '/connected', '/deviceids', '/services'], {
      encoding:'buffer', windowsHide:true, timeout:20000, maxBuffer:8*1024*1024
    }).catch(()=>null);
    if(!result) {
      const ps=path.join(path.dirname(pnp),'WindowsPowerShell/v1.0/powershell.exe');
      const script="$ErrorActionPreference='Stop'; Get-CimInstance Win32_PnPEntity | Where-Object { $_.Present -and $_.PNPDeviceID -like 'USB\\VID_2207*' } | ForEach-Object { $_.PNPDeviceID; $_.Service; $_.Name; '' }";
      const {stdout}=await run(ps,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:20000});
      return parseWindowsDevices(stdout);
    }
    const {stdout}=result;
    // Identifiers and driver names are ASCII even in localized console output.
    const encoding = stdout[0] === 0xff || stdout[1] === 0 ? 'utf16le' : 'latin1';
    return parseWindowsDevices(stdout.toString(encoding));
  }
  if (!['linux','win32'].includes(process.platform)) throw new Error('Configure a Linux or Windows USB host.');
  if (!backend || !path.isAbsolute(backend)) throw new Error('Configure an absolute --upgrade-tool path on the USB host.');
  await access(backend, constants.X_OK);
  const {stdout, stderr} = await run(backend, ['ld'], {cwd:path.dirname(backend), windowsHide:true, timeout:15000, maxBuffer:128*1024});
  return parseDevices(stdout + '\n' + stderr);
}

export function selectDevice(devices, location) {
  const matches = devices.filter(device => device.location === location.toLowerCase());
  if (matches.length !== 1) throw new Error('The selected RockUSB location is absent or ambiguous. List devices and identify the intended USB port.');
  const [device] = matches;
  if (device.vid !== '0x2207' || !['loader','maskrom'].includes(device.mode)) {
    throw new Error('The selected RockUSB port or boot mode does not match.');
  }
  return device;
}
