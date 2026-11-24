import { randomUUID } from 'node:crypto';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { inspectImage, listDevices, resolveImage, selectDevice } from './rockusb.mjs';
import { jobStatus, launchJob } from './jobs.mjs';
import {queries, query, fileDigest, operations, partitionTable, storageMenu} from './operations.mjs';
import {checkCardSize, listCards} from './sd.mjs';

const {values} = parseArgs({options:{
  'firmware-dir':{type:'string'}, 'upgrade-tool':{type:'string'}, 'allow-flash':{type:'boolean'},
  'ask-directory':{type:'boolean'}, 'sd-tool':{type:'string'}
}});
const root = values['firmware-dir'];
if (!root || !path.isAbsolute(root)) throw new Error('Provide --firmware-dir with an absolute directory path.');
const backend = values['upgrade-tool'];
const plans = new Map();
const approvedDirs = new Set();
const server = new McpServer({name:'rockusb-flash-mcp', version:'0.2.0'}, {
  instructions:'When the user names a directory, call list_firmware. If several candidates match, ask which file to use; never guess by filename or date. Use the selected absolute path for inspection and prepare_flash. Firmware paths refer to the USB host. Confirm board and boot storage. Never repeat an ambiguous write automatically.'
});

function tool(name, description, inputSchema, readOnly, action) {
  server.registerTool(name, {description, inputSchema, annotations:{readOnlyHint:readOnly, destructiveHint:!readOnly}}, async (args, extra) => {
    try {
      const data = await action(args, extra);
      return {content:[{type:'text', text:JSON.stringify(data, null, 2)}]};
    } catch (error) {
      return {isError:true, content:[{type:'text', text:error.message}]};
    }
  });
}

// A new grant covers only the selected folder. Relative paths always use the configured root.
async function directoryAccess(input, extra) {
  const rootDir = await realpath(root);
  const directory = await realpath(path.resolve(rootDir, input));
  const relative = path.relative(rootDir, directory);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) {
    return {directory, allowedRoot:rootDir};
  }
  if (!values['ask-directory'] || !path.isAbsolute(input)) {
    throw new Error('Outside the configured firmware directory. For another folder use its absolute host path with --ask-directory enabled.');
  }
  if (!approvedDirs.has(directory)) {
    const reply = await server.server.elicitInput({
      message:'Allow this MCP session to list and inspect firmware files directly in this folder? This does not approve flashing.\n' + directory,
      requestedSchema:{type:'object', properties:{allow:{type:'boolean', title:'Allow this folder', default:false}}, required:['allow']}
    }, {relatedRequestId:extra.requestId, signal:extra.signal});
    if (reply.action !== 'accept' || reply.content?.allow !== true) throw new Error('Folder access was not approved.');
    if (!(await stat(directory)).isDirectory()) throw new Error('Select a directory.');
    approvedDirs.add(directory);
  }
  return {directory, allowedRoot:directory};
}

async function selectedImage(file, extra) {
  const {directory, allowedRoot} = await directoryAccess(path.dirname(file), extra);
  const resolved = await resolveImage(allowedRoot, path.join(directory, path.basename(file)));
  // In an extra folder a symlink cannot extend the grant into a subdirectory.
  if (approvedDirs.has(directory) && path.relative(directory, path.dirname(resolved)) !== '') {
    throw new Error('The selected link points into another folder. Specify its full target path.');
  }
  return resolved;
}

const filename = z.string().min(1).describe('Filename relative to --firmware-dir, or absolute firmware path on the USB host.');
const port = z.string().regex(/^[0-9a-f]+$/i).describe('LocationID returned by list_devices.');
tool('list_firmware', 'List .img filenames directly in the requested folder. This does not validate images or write to the device. Ask the user to choose if several match.', {
  directory:z.string().min(1).optional().describe('Absolute host folder or a subdirectory relative to --firmware-dir. Defaults to the configured directory.')
}, true, async ({directory:input}, extra) => {
  const {directory} = await directoryAccess(input ?? '.', extra);
  const entries = await readdir(directory, {withFileTypes:true});
  const files = entries.filter(entry => (entry.isFile() || entry.isSymbolicLink()) && /\.img$/i.test(entry.name))
    .map(entry => path.join(directory, entry.name)).sort();
  return {directory, files};
});
tool('list_devices', 'Identify Loader or Maskrom devices using the native backend. Windows also reports PnP diagnostics when no flashable device is visible.', {}, true, async () => {
  const devices = await listDevices(backend);
  if (process.platform === 'win32') {
    return {devices, pnp:backend && !devices.length ? await listDevices() : undefined, host:'windows', backend:backend ? 'upgrade_tool' : 'PnP', write_enabled:!!backend && !!values['allow-flash']};
  }
  return {devices};
});
tool('inspect_firmware', 'Check the RKFW/RKAF envelope and compute SHA-256 without using USB.', {file:filename}, true,
  async ({file}, extra) => inspectImage(await selectedImage(file, extra)));

function remember(plan) {
  const now=Date.now();
  for(const [key,p] of plans) if(p.expires<=now) plans.delete(key);
  const id=randomUUID();
  plans.set(id,{...plan,expires:now+600000});
  const {backend,sdTool,...details}=plan;
  return {plan_id:id,expires_in_seconds:600,...details,write_enabled:!!values['allow-flash']};
}
async function attached(location) {
  if (!backend) throw Error('Configure the native USB backend.');
  return selectDevice(await listDevices(backend),location);
}
async function activeStorage(device) {
  return (await storageMenu(backend,device)).find(row=>row.current).name;
}
tool('prepare_flash', 'Prepare a whole-firmware write to the single device at this USB location. No device writes.', {
  file:filename, location:port, expected_sha256:z.string().regex(/^[0-9a-f]{64}$/i).optional().describe('Publisher SHA-256 if available.')
}, true, async ({file, location, expected_sha256}, extra) => {
  if (!backend) throw new Error('Configure --upgrade-tool on the USB host for hardware operations.');
  const device = selectDevice(await listDevices(backend), location);
  const image = await inspectImage(await selectedImage(file, extra));
  if (expected_sha256 && image.sha256 !== expected_sha256.toLowerCase()) throw new Error('SHA-256 differs from the supplied checksum.');
  const storage=device.mode==='loader' ? await activeStorage(device) : undefined;
  return remember({operation:'flash',image,device,backend,storage,target:storage || 'Boot medium selected by firmware in Maskrom; confirm hardware before writing.'});
});

tool('device_info','Read connection, chip, storage, partitions or capabilities from one RockUSB device.',{location:port,kind:z.enum([...Object.keys(queries),'storage_menu'])},true,async ({location,kind})=>{
  const device=await attached(location);
  return kind==='storage_menu' ? await storageMenu(backend,device) : await query(backend,device,kind);
});
tool('prepare_device_action','Plan a USB action for this device. For partitions, use the exact name from device_info. Supply a board-matched .bin Loader for download_boot/write_loader or a unified firmware for erase_flash.',{
  location:port,operation:z.enum(operations),file:filename.optional(),partition:z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/).optional(),
  storage:z.string().regex(/^[A-Z0-9_-]+$/).optional()
},true,async ({location,operation,file,partition,storage:requested_storage},extra)=>{
  const device=await attached(location);
  const maskrom=['download_boot','erase_flash'].includes(operation);
  if(maskrom && device.mode!=='maskrom') throw Error('This operation requires Maskrom.');
  if(!maskrom && !['reboot','write_loader'].includes(operation) && device.mode!=='loader') throw Error('This operation requires a running Loader.');
  const partitionJob=['backup_partition','write_partition'].includes(operation);
  const needsFile=maskrom || ['write_loader','write_partition'].includes(operation);
  if(needsFile!==!!file || partitionJob!==!!partition || (operation==='switch_storage')!==!!requested_storage) throw Error('Supply only the file, partition or storage required by this operation.');
  const plan={operation,backend,device};
  if(device.mode==='loader') plan.storage=await activeStorage(device);
  if(requested_storage) {
    if(!(await storageMenu(backend,device)).some(row=>row.name===requested_storage && !row.current)) throw Error('Select a different storage listed by this Loader.');
    plan.requested_storage=requested_storage;
  }
  if(partitionJob) {
    const rows=partitionTable(await query(backend,device,'partitions')).filter(p=>p.name===partition);
    if(rows.length!==1 || !rows[0].sectors || rows[0].sectors===0xffffffff) throw Error('No unique partition with a known length.');
    plan.partition=rows[0];
  }
  if(file) {
    const src=await selectedImage(file,extra);
    if(operation==='erase_flash') plan.image=await inspectImage(src);
    else {
      if(!partitionJob && !/\.bin$/i.test(src)) throw Error('Select a board-specific Rockchip Loader .bin file.');
      plan.image=await fileDigest(src);
      if(partitionJob) {
        if(plan.image.bytes>plan.partition.sectors*512) throw Error('Image exceeds the partition capacity.');
        const fh=await open(src,'r');
        try {
          const head=Buffer.alloc(4); await fh.read(head,0,4,0);
          if(head.readUInt32LE()===0xed26ff3a || head.toString()==='RKFW') throw Error('Select a raw partition image.');
        } finally {await fh.close();}
      }
    }
  }
  return remember(plan);
});
tool('list_sd_cards','List eligible removable cards connected to a Windows host reader, excluding system disks.',{},true,listCards);
tool('prepare_sd_card','Plan to overwrite one removable host card with a boot card or a recovery-based firmware update card. Use the disk number and ID returned by list_sd_cards.',{
  file:filename,number:z.number().int().nonnegative(),id:z.string().min(1),mode:z.enum(['boot','upgrade'])
},true,async ({file,number,id,mode},extra)=>{
  const sdTool=values['sd-tool'];
  if(!sdTool || !path.isAbsolute(sdTool)) throw Error('Configure --sd-tool through the Windows installer.');
  const card=(await listCards()).find(c=>c.number===number && c.id===id);
  if(!card) throw Error('Selected removable card is absent.');
  const image=await inspectImage(await selectedImage(file,extra));
  checkCardSize(mode,image.bytes,card.bytes);
  return remember({operation:'make_sd',card,cardMode:mode,image,sdTool});
});
async function execute(plan_id, extra, flashOnly) {
  if (!values['allow-flash']) throw new Error('Read-only configuration. Enable --allow-flash on the USB host to write.');
  const plan = plans.get(plan_id);
  if (!plan || plan.expires <= Date.now()) throw new Error('Plan expired or already used. Run prepare_flash again.');
  if(flashOnly && plan.operation!=='flash') throw Error('Use execute_plan for this operation.');
  plans.delete(plan_id);
  const approval = await server.server.elicitInput({
    message:[
      'Authorize operation: '+plan.operation,
      plan.card ? 'Overwrite entire SD card: '+JSON.stringify(plan.card)+' | card mode: '+plan.cardMode : 'USB target: '+JSON.stringify(plan.device),
      plan.card ? undefined : 'Storage: '+(plan.storage || 'board/firmware default'),
      plan.requested_storage && 'Switch to: '+plan.requested_storage, plan.partition && 'Partition: '+JSON.stringify(plan.partition),
      plan.image && 'File: '+plan.image.file, plan.image && 'SHA-256: '+plan.image.sha256,
      ['flash','write_partition','write_loader','erase_flash','make_sd'].includes(plan.operation) && 'Existing data on the selected target will be overwritten or erased.'
    ].filter(Boolean).join('\n'),
    requestedSchema:{type:'object', properties:{authorize:{type:'boolean', title:'Authorize this firmware write', default:false}}, required:['authorize']}
  }, {relatedRequestId:extra.requestId, signal:extra.signal});
  if (approval.action !== 'accept' || approval.content?.authorize !== true) return {state:'cancelled'};
  if (plan.expires <= Date.now()) throw new Error('Plan expired during confirmation. Run prepare_flash again.');
  return launchJob(plan_id, plan);
}
tool('flash_firmware','Confirm and execute a whole-firmware USB write.',{plan_id:z.string().uuid()},false,({plan_id},extra)=>execute(plan_id,extra,true));
tool('execute_plan','Request human confirmation and execute the single approved USB or card operation.',{plan_id:z.string().uuid()},false,({plan_id},extra)=>execute(plan_id,extra,false));
tool('flash_status', 'Read the job result and recent backend log from this host, including after reconnecting.', {
  job_id:z.string().uuid()
}, true, async ({job_id}) => jobStatus(job_id));

await server.connect(new StdioServerTransport());
