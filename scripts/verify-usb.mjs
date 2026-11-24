// End-to-end test against the same stdio registration used by Codex. Requires a human confirmation.
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';

const [cli, location, file, sha256] = process.argv.slice(2);
if (!cli || !file || !location || !/^[a-f0-9]{64}$/i.test(sha256 ?? '')) {
  throw Error('Usage: node scripts/verify-usb.mjs <codex executable> <USB location> <firmware path> <SHA-256>');
}
const {transport} = JSON.parse(execFileSync(cli,['mcp','get','rockusb','--json'],{encoding:'utf8'}));
const input = createInterface({input:process.stdin, output:process.stdout});
const client = new Client({name:'operator-usb-check',version:'1'}, {capabilities:{elicitation:{form:{}}}});
client.setRequestHandler(ElicitRequestSchema, async ({params}) => {
  console.log(params.message);
  if (!params.requestedSchema?.properties?.authorize) return {action:'decline'};
  const answer = await input.question('Type FLASH to authorize this exact target, or CANCEL: ');
  return answer.trim() === 'FLASH' ? {action:'accept',content:{authorize:true}} : {action:'decline'};
});
async function call(name, args) {
  const response = await client.callTool({name,arguments:args}, undefined, {timeout:600000});
  if (response.isError) throw Error(response.content[0].text);
  return JSON.parse(response.content[0].text);
}
try {
  await client.connect(new StdioClientTransport({command:transport.command,args:transport.args}));
  console.log(await call('list_devices', {}));
  const plan = await call('prepare_flash',{file,location,expected_sha256:sha256});
  console.log(plan);
  const job = await call('flash_firmware',{plan_id:plan.plan_id});
  console.log(job);
  let last = '';
  while (job.job_id) {
    const result = await call('flash_status',{job_id:job.job_id});
    const status = [result.state,result.message,result.log_tail.slice(-300)].join(' ');
    if (status !== last) console.log(status);
    last = status;
    if (result.state === 'failed') { process.exitCode=1; break; }
    if (result.state === 'backend_succeeded') break;
    await delay(3000);
  }
} finally {
  input.close();
  await client.close();
}
