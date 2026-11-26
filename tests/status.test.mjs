import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = fileURLToPath(new URL('../server.mjs', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const interactive of [false, true]) {
  test('server_status reports negotiated form support: ' + interactive, async t => {
    const capabilities = interactive ? {elicitation:{form:{}}} : {};
    const client = new Client({name:'config-check', version:'1'}, {capabilities});
    t.after(() => client.close());
    await client.connect(new StdioClientTransport({command:process.execPath, args:[entry, '--firmware-dir', tmpdir()]}));
    const response = await client.callTool({name:'server_status', arguments:{}});
    assert.ok(!response.isError);
    const status = JSON.parse(response.content[0].text);
    assert.equal(status.version, pkg.version);
    assert.equal(client.getServerVersion().version, pkg.version);
    assert.equal(status.interactive_forms_supported, interactive);
    assert.equal(status.usb_backend_configured, false);
    assert.equal(status.write_enabled, false);
  });
}
