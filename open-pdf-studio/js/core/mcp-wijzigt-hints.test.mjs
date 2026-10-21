// Tools that write client-chosen files, start background automation or
// record irreversible audit events must carry the destructive hint, so MCP
// clients ask before every call (convention in src-tauri/src/mcp_tool_meta.rs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const meta = readFileSync(new URL('../../src-tauri/src/mcp_tool_meta.rs', import.meta.url), 'utf8');
const tools = JSON.parse(readFileSync(new URL('../../../mcp-stdio/tools.json', import.meta.url), 'utf8'));

function assertModifying(name) {
  assert.match(meta, new RegExp(`^\\s*wijzigt\\("${name}",`, 'm'), `${name} is wijzigt in mcp_tool_meta.rs`);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} in tools.json`);
  assert.equal(tool.annotations.destructiveHint, true, `${name} destructiveHint`);
  assert.equal(tool.annotations.readOnlyHint, false, `${name} readOnlyHint`);
}

test('app_portfolio writes component files and reads local files: modifying', () => {
  assertModifying('app_portfolio');
});
