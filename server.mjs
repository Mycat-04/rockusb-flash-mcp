import { randomUUID } from 'node:crypto';
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { inspectImage, listDevices, resolveImage, selectDevice } from './rockusb.mjs';
import { jobStatus, launchJob } from './jobs.mjs';
import {queries, query, fileDigest, operations, selectPartition, storageMenu, checkFlashStorage} from './operations.mjs';
import {checkCardSize, listCards} from './sd.mjs';
import {identifyAdb, listAdbDevices} from './loader.mjs';
import {identifyConsole, listConsoles} from './console-loader.mjs';

const {values} = parseArgs({options:{
  'firmware-dir':{type:'string'}, 'upgrade-tool':{type:'string'}, 'allow-flash':{type:'boolean'},
  'ask-directory':{type:'boolean'}, 'sd-tool':{type:'string'}, adb:{type:'string'},
  'auto-tools-dir':{type:'string'}
}});
const root = values['firmware-dir'];
if (!root || !path.isAbsolute(root)) throw new Error('Provide --firmware-dir with an absolute directory path.');
const backend = values['upgrade-tool'];
if (values.adb && !path.isAbsolute(values.adb)) throw Error('--adb requires an absolute executable path.');
const adb = values.adb || (process.platform === 'win32' ? 'adb.exe' : 'adb');
const toolsDir = values['auto-tools-dir'];
if (toolsDir && (process.platform !== 'win32' || !path.isAbsolute(toolsDir))) {
  throw Error('--auto-tools-dir requires an absolute Windows directory.');
}
const windowsSetup = toolsDir ? await import('./scripts/setup-windows.mjs') : null;
const managedPaths = windowsSetup?.windowsToolPaths(toolsDir);
async function toolPath(component, configuredPath) {
  if (managedPaths && managedPaths[component] === configuredPath) {
    return windowsSetup.ensureWindowsBackend(component, toolsDir);
  }
  return configuredPath;
}
async function usbDevices() {
  const executable = await toolPath('usb', backend);
  try {
    return await listDevices(executable);
  } catch (error) {
    if (windowsSetup && executable === managedPaths.usb) {
      const prerequisites = await windowsSetup.checkWindowsPrerequisites();
      if (!prerequisites.runtime_installed) {
        throw Error('The Windows USB tool needs the Visual C++ runtime. Run the RockUSB installer with --client none, then list devices again.', {cause:error});
      }
    }
    throw error;
  }
}
const plans = new Map();
const approvedDirs = new Set();
const {name, version} = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const server = new McpServer({name, version}, {
  instructions:[
    'Handle ordinary Rockchip board requests in the user’s language, including requests without the word rockusb. Use the tools yourself.',
    'Resolve ambiguity conversationally. Enumerate first. If multiple boards are plausible (including mixed ADB/Loader/Maskrom), ask which one BEFORE any reboot, switch or write. Show options using actual serial suffixes and USB locations; use a model name only when verified. A filename, board order or USB mode alone does not identify the intended board. Reuse a clear choice from this conversation and recheck it against the current devices. Ask only about unresolved details. Show paths for duplicate image names. If board/image compatibility or the requested medium remains unclear, explain what is missing and ask.',
    'For a Loader or flash request, call list_devices. Use an existing Loader first. For a running board prefer authorized USB ADB (enter_loader); otherwise, if a USB debug console is available, call enter_loader_from_console for the selected port before suggesting physical recovery buttons. A single adapter can be probed to identify the board. Ask about ambiguous ports. An adapter is not proof of an OTG connection. Use execute_plan and flash_status to confirm and verify the reboot.',
    '“帮我烧录 xx 固件到板子” / “flash <image> to my board”: resolve the image and identify the board. Use a supplied file path directly. For a bare filename, use list_firmware with name. When given a folder, list it. Use the single matching file; ask if several match or the file or board is unclear. Never guess by date.',
    'For a flash request, validate the selected image before rebooting. After a verified Loader transition continue directly with the ORIGINAL firmware path and requested medium: prepare_flash, confirmation and status. Do not wait for the user to repeat “烧录固件”. For a Loader-only request stop after verification. If the reboot job returns needs_device_confirmation ask which physical target appeared. In Loader use the active storage by default. In Maskrom, if the medium is unknown, explain that the firmware selects it and ask whether this is intended before writing.',
    '“烧录到 eMMC” / “flash to eMMC”: always pass expected_storage=EMMC to prepare_flash. Honor any other named medium likewise. If storage differs, use device_info(storage_menu) and a separately confirmed switch_storage if supported, then replan with the same expected_storage. Never omit the requested medium to make a plan succeed.',
    'For an action request, proceed to the interactive confirmation form without asking for the same approval in chat. Track the returned job_id with flash_status to completion. For a listing, question, preview or “先给我看计划”, stop before reboot, switching or writing. On cancellation or uncertain results, stop; never retry a write automatically.'
  ].join('\n')
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

function supportsConfirmation() {
  return Boolean(server.server.getClientCapabilities()?.elicitation?.form);
}

function requireConfirmationSupport() {
  if (!supportsConfirmation()) {
    throw Error('This MCP client did not advertise interactive confirmation forms. Use a client with form elicitation enabled, then retry.');
  }
}

tool('server_status', 'Check installation, version, host configuration and whether this MCP client advertises confirmation forms. This does not open a device or request approval.', {}, true, async () => ({
  version, host:process.platform, firmware_directory:root, write_enabled:!!values['allow-flash'],
  usb_backend_configured:!!backend, sd_backend_configured:!!values['sd-tool'],
  interactive_forms_supported:supportsConfirmation()
}));

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
    requireConfirmationSupport();
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
tool('list_firmware', 'Find the firmware the user named (“帮我烧录 xx 固件”). With name, search by exact filename under the configured firmware directory; a separate folder grant covers that folder only. Without name, list .img files directly in the requested folder. Ask when multiple paths match.', {
  directory:z.string().min(1).optional().describe('Absolute host folder or a subdirectory relative to --firmware-dir. Defaults to the configured directory.'),
  name:z.string().min(1).regex(/^[^/\\\x00]+$/).optional().describe('Filename only, with or without .img; no path or wildcards.')
}, true, async ({directory:input, name}, extra) => {
  const {directory,allowedRoot} = await directoryAccess(input ?? '.', extra);
  const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const wanted = name && key(/\.img$/i.test(name) ? name : name+'.img');
  const recursive = wanted && allowedRoot === await realpath(root);
  const pending = [directory];
  const files = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await readdir(current,{withFileTypes:true})) {
      const fullPath = path.join(current,entry.name);
      if (recursive && entry.isDirectory()) pending.push(fullPath);
      if ((entry.isFile() || entry.isSymbolicLink()) && /\.img$/i.test(entry.name) && (!wanted || key(entry.name) === wanted)) files.push(fullPath);
    }
  }
  return {directory, files:files.sort()};
});
tool('list_devices', 'Find RockUSB, USB ADB and USB serial adapters for “帮我烧录固件到板子”. When only a debug console is available, use enter_loader_from_console as part of the flash request.', {}, true, async () => {
  const [devices,adbInfo,consoleInfo] = await Promise.all([usbDevices(),
    toolPath('adb', adb).then(listAdbDevices).then(adb_devices => ({adb_devices}), error => ({adb_devices:[],adb_diagnostic:error.code === 'ENOENT' ? 'Install Android platform-tools or configure --adb.' : error.message})),
    listConsoles().then(serial_ports=>({serial_ports}),error=>({serial_ports:[],serial_diagnostic:error.message}))]);
  const found = {devices,...adbInfo,...consoleInfo};
  if (!devices.some(d=>['loader','maskrom'].includes(d.mode)) && !adbInfo.adb_devices.some(d=>d.state==='device') && consoleInfo.serial_ports.length)
    found.loader_hint = 'For a flash or Loader request: identify the intended debug console with enter_loader_from_console. After verified Loader, continue the original request.';
  if (process.platform === 'win32') {
    if (windowsSetup && !devices.length) {
      found.windows_prerequisites = await windowsSetup.checkWindowsPrerequisites();
      const prerequisites = found.windows_prerequisites;
      if (prerequisites.driver_installed === false || prerequisites.runtime_installed === false) {
        found.host_setup_hint = 'Run the Windows installer with --client none to install missing drivers or runtime libraries. Then reconnect the board and list devices again.';
      }
    }
    return {...found, pnp:backend && !devices.length ? await listDevices() : undefined, host:'windows', backend:backend ? 'upgrade_tool' : 'PnP', write_enabled:!!backend && !!values['allow-flash']};
  }
  return found;
});
tool('inspect_firmware', 'Check the RKFW/RKAF envelope and compute SHA-256 without using USB.', {file:filename}, true,
  async ({file}, extra) => inspectImage(await selectedImage(file, extra)));

function remember(plan) {
  const now=Date.now();
  for(const [key,p] of plans) if(p.expires<=now) plans.delete(key);
  const id=randomUUID();
  plans.set(id,{...plan,expires:now+600000});
  const {backend,sdTool,adb,...details}=plan;
  return {plan_id:id,expires_in_seconds:600,...details,write_enabled:!!values['allow-flash']};
}
async function attached(location) {
  if (!backend) throw Error('Configure the native USB backend.');
  return selectDevice(await usbDevices(),location);
}
async function activeStorage(device) {
  return (await storageMenu(backend,device)).find(row=>row.current).name;
}
tool('enter_loader','Handle “帮我进入 Loader 模式” / “put my board in Loader mode”. Prepare a reboot-only plan for the authorized USB ADB serial from list_devices, then use execute_plan and flash_status to confirm and verify Loader. Stop here for a Loader-only request.',{
  serial:z.string().min(1).describe('Exact USB ADB serial from list_devices.adb_devices.')
},true,async ({serial})=>{
  if (!backend) throw Error('Configure --upgrade-tool to verify Loader mode.');
  const [device] = await Promise.all([toolPath('adb', adb).then(exe => identifyAdb(exe,serial)),usbDevices()]);
  return {...remember({operation:'enter_loader',backend,adb,device}),next_tool:'execute_plan'};
});
tool('enter_loader_from_console','When flashing a running Rockchip Linux board with no usable ADB, identify its logged-in systemd root console, e.g. CH340 on COM4. Prepare a confirmation plan for systemctl reboot loader. Keep OTG connected. After verification use the original firmware path for a flash request.',{
  port:z.string().min(1).describe('Exact port from list_devices.serial_ports.'),
  baud:z.number().int().min(1200).max(4000000).default(1500000)
},true,async ({port,baud})=>{
  if (!backend) throw Error('Configure --upgrade-tool to verify Loader on the OTG port.');
  await usbDevices();
  const device = await identifyConsole(port,baud);
  return {...remember({operation:'enter_console_loader',backend,device}),next_tool:'execute_plan'};
});
tool('prepare_flash', 'Plan the USB write for “帮我烧录 xx 固件到板子” / “flash this image to my board”. If multiple boards could be intended, ask which serial or USB port to use. If the user names a medium, supply expected_storage. Otherwise show the detected target in the write confirmation.', {
  file:filename, location:port, expected_sha256:z.string().regex(/^[0-9a-f]{64}$/i).optional().describe('Publisher SHA-256 if available.'),
  expected_storage:z.string().regex(/^[a-z0-9_-]+$/i).optional().describe('Storage explicitly named by the user, e.g. EMMC. Blocks a plan if the active medium differs or cannot be verified.')
}, true, async ({file, location, expected_sha256, expected_storage}, extra) => {
  const device = await attached(location);
  const storage=device.mode==='loader' ? await activeStorage(device) : undefined;
  checkFlashStorage(storage,expected_storage);
  const image = await inspectImage(await selectedImage(file, extra));
  if (expected_sha256 && image.sha256 !== expected_sha256.toLowerCase()) throw new Error('SHA-256 differs from the supplied checksum.');
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
    plan.partition=selectPartition(await query(backend,device,'partitions'),partition);
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
  await toolPath('sd', sdTool);
  return remember({operation:'make_sd',card,cardMode:mode,image,sdTool});
});
async function execute(plan_id, extra, flashOnly) {
  if (!values['allow-flash']) throw new Error('Read-only configuration. Enable --allow-flash on the USB host to write.');
  const plan = plans.get(plan_id);
  if (!plan || plan.expires <= Date.now()) throw new Error('Plan expired or already used. Prepare a new plan.');
  if(flashOnly && plan.operation!=='flash') throw Error('Use execute_plan for this operation.');
  requireConfirmationSupport();
  plans.delete(plan_id);
  const reboot = ['enter_loader','enter_console_loader'].includes(plan.operation);
  const label = {
    flash:'Authorize this firmware write', make_sd:'Authorize overwriting this card',
    erase_flash:'Authorize erasing this storage', backup_partition:'Authorize reading this partition to the host',
    write_partition:'Authorize writing this partition', write_loader:'Authorize writing the Loader',
    download_boot:'Authorize loading the Loader into RAM', switch_storage:'Authorize switching storage',
    enter_maskrom:'Authorize reboot to Maskrom', reboot:'Authorize device reboot',
    enter_loader:'Authorize reboot to Loader', enter_console_loader:'Authorize reboot to Loader'
  }[plan.operation];
  if (!label) throw Error('Unsupported confirmation operation.');
  const approval = await server.server.elicitInput({
    message:[
      'Authorize operation: '+plan.operation,
      plan.card ? 'Overwrite entire SD card: '+JSON.stringify(plan.card)+' | card mode: '+plan.cardMode : 'USB target: '+JSON.stringify(plan.device),
      plan.cardMode === 'upgrade' && 'Starting a compatible board from this upgrade card can automatically overwrite its internal storage.',
      reboot ? 'The running OS will restart. No firmware or storage is written.' : !plan.card && 'Storage: '+(plan.storage || plan.target || 'board/firmware default'),
      plan.requested_storage && 'Switch to: '+plan.requested_storage, plan.partition && 'Partition: '+JSON.stringify(plan.partition),
      plan.image && 'File: '+plan.image.file, plan.image && 'SHA-256: '+plan.image.sha256,
      ['flash','write_partition','write_loader','erase_flash','make_sd'].includes(plan.operation) && 'Existing data on the selected target will be overwritten or erased.'
    ].filter(Boolean).join('\n'),
    requestedSchema:{type:'object', properties:{authorize:{type:'boolean', title:label, default:false}}, required:['authorize']}
  }, {relatedRequestId:extra.requestId, signal:extra.signal}).catch(error=>{
    throw Error('No job started. The client could not complete the confirmation form: '+error.message);
  });
  if (approval.action !== 'accept' || approval.content?.authorize !== true) {
    const reasons = {decline:'client_declined',cancel:'client_cancelled',accept:'authorization_unchecked'};
    return {state:'cancelled',reason:reasons[approval.action] || 'no_authorization',message:'No job started. Report the client response without assuming who cancelled. If no form appeared, check the chat approval settings before preparing a new plan.'};
  }
  if (plan.expires <= Date.now()) throw new Error('Plan expired during confirmation. Prepare a new plan.');
  return launchJob(plan_id, plan);
}
tool('flash_firmware','Confirm and execute a whole-firmware USB write.',{plan_id:z.string().uuid()},false,({plan_id},extra)=>execute(plan_id,extra,true));
tool('execute_plan','Request human confirmation and execute the single approved USB or card operation.',{plan_id:z.string().uuid()},false,({plan_id},extra)=>execute(plan_id,extra,false));
tool('flash_status', 'Read the job result and recent backend log from this host, including after reconnecting.', {
  job_id:z.string().uuid()
}, true, async ({job_id}) => jobStatus(job_id));

await server.connect(new StdioServerTransport());
