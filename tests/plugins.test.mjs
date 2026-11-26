import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = async (base, filename) =>
  JSON.parse(await readFile(new URL(filename, base), 'utf8'));

test('Codex and Claude install the same RockUSB release from their marketplaces', async () => {
  const codexMarket = await readJson(root, '.agents/plugins/marketplace.json');
  const claudeMarket = await readJson(root, '.claude-plugin/marketplace.json');
  const codexEntry = codexMarket.plugins.find(plugin => plugin.name === 'rockusb');
  const claudeEntry = claudeMarket.plugins.find(plugin => plugin.name === 'rockusb');
  assert.equal(codexMarket.name, claudeMarket.name);
  assert.equal(codexEntry.source.path, claudeEntry.source);

  const plugin = new URL(claudeEntry.source + '/', root);
  const codex = await readJson(plugin, '.codex-plugin/plugin.json');
  const claude = await readJson(plugin, '.claude-plugin/plugin.json');
  const pkg = await readJson(root, 'package.json');
  for (const manifest of [codex, claude]) {
    assert.equal(manifest.name, 'rockusb');
    assert.equal(manifest.version, pkg.version);
  }

  // Claude discovers .mcp.json at the plugin root. Codex points to the same file.
  assert.equal(codex.mcpServers, './.mcp.json');
  const { mcpServers } = await readJson(plugin, codex.mcpServers);
  assert.equal(mcpServers.rockusb.command, 'npx');
  assert.deepEqual(mcpServers.rockusb.args, ['-y', `${pkg.name}@${pkg.version}`]);
});
