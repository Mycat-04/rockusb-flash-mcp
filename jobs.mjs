import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inspectImage, listDevices, selectDevice } from './rockusb.mjs';
import {fileDigest, partitionTable, query, runUsbOperation, storageMenu} from './operations.mjs';
import {writeCard} from './sd.mjs';

const jobs = path.join(process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state'), 'rockusb-flash-mcp');
const worker = fileURLToPath(import.meta.url);

export function checkUpgradeResult(code, signal, tail) {
  if (code !== 0) throw new Error('upgrade_tool stopped (' + (signal || code) + '). Inspect upgrade.log before reconnecting.');
  if (!/^\s*Upgrade firmware ok[.!]?\s*$/im.test(tail)) throw new Error('Backend exited without a recognized success message. Check the board and the log before retrying.');
}

async function setStatus(dir, state, message) {
  const file = path.join(dir, 'status.json');
  await writeFile(file + '.new', JSON.stringify({state, message, updated:new Date().toISOString()}), {mode:0o600});
  await rename(file + '.new', file);
}

async function writeFirmware(tool, device, image, dir) {
  const log = await open(path.join(dir, 'upgrade.log'), 'wx', 0o600);
  try {
    const child = spawn(tool, ['-s', device.location, 'uf', image], {
      cwd:path.dirname(tool), windowsHide:true, stdio:['ignore', log.fd, log.fd]
    });
    const [code, signal] = await once(child, 'close');
    checkUpgradeResult(code, signal, await logTail(dir));
  } finally {
    await log.close();
  }
}

async function logTail(dir) {
  let file;
  try {
    file = await open(path.join(dir, 'upgrade.log'));
    const {size} = await file.stat();
    const buf = Buffer.alloc(Math.min(size, 4096));
    await file.read(buf, 0, buf.length, size - buf.length);
    return buf.toString().replace(/\r/g, '\n').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  } finally {
    await file?.close();
  }
}

export async function runJob(dir, plan, enumerate = listDevices, flash = writeFirmware) {
  const staged = path.join(dir, 'firmware.img');
  try {
    await setStatus(dir, 'checking', 'Rechecking the approved input and target.');
    if (plan.image) {
      await copyFile(plan.image.file, staged, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
      const copy = await (plan.image.format ? inspectImage : fileDigest)(staged);
      if (copy.sha256 !== plan.image.sha256) throw new Error('Firmware contents changed after preflight.');
    }
    if (plan.operation==='make_sd') {
      await setStatus(dir,'writing','Waiting for Windows permission to write and verify the selected card.');
      await writeCard(plan,staged);
      await setStatus(dir,'backend_succeeded','SD backend completed writing and verification.');
      return;
    }
    const device = selectDevice(await enumerate(plan.backend), plan.device.location);
    if (Object.keys(device).some(key => device[key] !== plan.device[key])) throw new Error('Device identity or mode changed after preflight.');
    if (plan.storage && !(await storageMenu(plan.backend,device)).some(row=>row.current && row.name===plan.storage)) throw Error('Active storage changed after preflight.');
    if (plan.partition) {
      const rows=partitionTable(await query(plan.backend,device,'partitions'));
      if(!rows.some(p=>p.name===plan.partition.name && p.start===plan.partition.start && p.sectors===plan.partition.sectors)) throw Error('Partition geometry changed after preflight.');
    }
    await setStatus(dir, 'writing', 'Running '+(plan.operation || 'firmware upgrade')+'.');
    if (!plan.operation || plan.operation==='flash') await flash(plan.backend, device, staged, dir);
    else await runUsbOperation(plan,staged,dir);
    await setStatus(dir,'backend_succeeded',plan.operation==='backup_partition' ? 'Backup: '+path.join(dir,'partition.img') : 'Rockchip backend reported success.');
  } catch (error) {
    await setStatus(dir, 'failed', error.message);
  } finally {
    await unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function launchJob(id, plan) {
  const dir = path.join(jobs, id);
  await mkdir(jobs, {recursive:true, mode:0o700});
  await mkdir(dir, {mode:0o700});
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan), {mode:0o600});
  await setStatus(dir, 'queued', 'Waiting for the USB writer.');
  // The worker survives a closed client. flock serializes writers across client sessions.
  try {
    const child = spawn(process.execPath, [worker, '--worker', dir], {detached:true, windowsHide:true, stdio:'ignore'});
    await once(child, 'spawn');
    child.unref();
  } catch (error) {
    await setStatus(dir, 'failed', error.message);
    throw error;
  }
  return {job_id:id};
}

export async function jobStatus(id) {
  const dir = path.join(jobs, id);
  return {...JSON.parse(await readFile(path.join(dir, 'status.json'), 'utf8')), job_id:id, log_tail:await logTail(dir)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === worker) {
  const [mode, dir] = process.argv.slice(2);
  if (mode === '--worker') {
    try {
      if (process.platform === 'win32') {
        const lock = path.join(jobs,'writer.exclusive');
        const handle = await open(lock, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({pid:process.pid, job:path.basename(dir)}));
          await runJob(dir, JSON.parse(await readFile(path.join(dir,'plan.json'),'utf8')));
        } finally {
          await handle.close();
          await unlink(lock);
        }
      } else {
        await promisify(execFile)('flock', ['--nonblock','--conflict-exit-code','75',path.join(jobs, 'writer.lock'),process.execPath,worker,'--locked',dir]);
      }
    } catch (error) {
      await setStatus(dir, 'failed', error.code === 75 || error.code === 'EEXIST' ? 'Writer locked. Check the existing job and hardware before retrying.' : error.message);
    }
  } else if (mode === '--locked') {
    await runJob(dir, JSON.parse(await readFile(path.join(dir, 'plan.json'), 'utf8')));
  }
}
