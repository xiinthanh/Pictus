import { describe, expect, it } from 'vitest';
import { Editor } from '../src/lib/core/editor';
import { VoxelGrid } from '../src/lib/core/grid';
import { defaultPalette } from '../src/lib/core/palette';
import {
  CACHE_TTL_MS,
  handleHttp,
  decodeHeader,
  LEGACY_VERSIONS,
  START_MARGIN_MS,
  type HttpIn,
} from '../src/lib/mcp/protocol';
import { TOOLS, type AppInfo, type Tool, type ToolCtx } from '../src/lib/mcp/tools';

const V = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': V,
  'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' },
};

const INFO: AppInfo = { name: 'Untitled', isDirty: false, isBusy: false, isLayerMode: false, layer: 0, color: 1 };

function makeCtx(editor = new Editor(), info = INFO): ToolCtx & { notified: string[] } {
  const notified: string[] = [];
  return {
    editor,
    notified,
    info: () => info,
    newModel: () => {
      throw new Error('newModel is not used by these tests');
    },
    aiSteps: [],
    notify: (t) => notified.push(t),
  };
}

const echo: Tool = {
  name: 'echo',
  title: 'Echo',
  description: 'Echoes text',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  run: (args) => {
    if (args.text === 'boom') throw new Error('bad text');
    return [{ type: 'text', text: String(args.text) }];
  },
};

/** A modern request with matching headers. */
function modern(method: string, params: Record<string, unknown> = {}, id: number | null = 1): HttpIn {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method, params: { ...params, _meta: META } };
  if (id !== null) msg.id = id;
  return {
    body: JSON.stringify(msg),
    protocolVersion: V,
    method,
    name: typeof params.name === 'string' ? params.name : null,
  };
}

function legacy(method: string, params: Record<string, unknown> = {}, id: number | null = 1): HttpIn {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (id !== null) msg.id = id;
  return { body: JSON.stringify(msg) };
}

async function call(req: HttpIn, ctx = makeCtx()) {
  const r = await handleHttp(req, [echo], ctx);
  return { status: r.status, msg: r.body ? JSON.parse(r.body) : null };
}

describe('MCP protocol (modern)', () => {
  it('answers server/discover', async () => {
    const { status, msg } = await call(modern('server/discover'));
    expect(status).toBe(200);
    expect(msg.result.supportedVersions).toEqual([V]);
    expect(msg.result.capabilities.tools).toEqual({});
    expect(msg.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('pictus');
  });

  it.each(['server/discover', 'tools/list'])('gives %s the caching hints the spec requires', async (method) => {
    const { msg } = await call(modern(method));
    expect(msg.result).toMatchObject({ ttlMs: CACHE_TTL_MS, cacheScope: 'public' });
  });

  it('lists the tools', async () => {
    const list = await call(modern('tools/list'));
    expect(list.msg.result.tools.map((t: Tool) => t.name)).toEqual(['echo']);
  });

  it('calls a tool and returns its content', async () => {
    const r = await call(modern('tools/call', { name: 'echo', arguments: { text: 'hi' } }));
    expect(r.status).toBe(200);
    expect(r.msg.result).toMatchObject({
      resultType: 'complete',
      isError: false,
      content: [{ type: 'text', text: 'hi' }],
    });
  });

  it('tells the user which tool ran', async () => {
    const ctx = makeCtx();
    await call(modern('tools/call', { name: 'echo', arguments: { text: 'hi' } }), ctx);
    expect(ctx.notified).toEqual(['echo']);
  });

  it('reports tool failures as isError results', async () => {
    const r = await call(modern('tools/call', { name: 'echo', arguments: { text: 'boom' } }));
    expect(r.status).toBe(200);
    expect(r.msg.result.isError).toBe(true);
    expect(r.msg.result.content[0].text).toBe('bad text');
  });

  it('rejects an unknown tool', async () => {
    expect((await call(modern('tools/call', { name: 'nope' }))).msg.error.code).toBe(-32602);
  });

  it('answers an unknown method with 404', async () => {
    const m = await call(modern('resources/list'));
    expect([m.status, m.msg.error.code]).toEqual([404, -32601]);
  });

  it('rejects an unsupported version and lists the supported ones', async () => {
    const req = modern('ping');
    const v = await call({ ...req, body: req.body.replace(V, '1900-01-01'), protocolVersion: '1900-01-01' });
    expect([v.status, v.msg.error.code]).toEqual([400, -32022]);
    expect(v.msg.error.data).toEqual({ supported: [V], requested: '1900-01-01' });
  });

  const base = modern('tools/call', { name: 'echo', arguments: {} });

  it.each([
    ['a missing version header', { protocolVersion: null }],
    ['a different method header', { method: 'tools/list' }],
    ['a different name header', { name: 'other' }],
  ])('rejects %s', async (_case, bad) => {
    const r = await call({ ...base, ...bad });
    expect([r.status, r.msg.error.code]).toEqual([400, -32020]);
  });

  it('accepts a base64-encoded name header', async () => {
    expect((await call({ ...base, name: '=?base64?ZWNobw==?=' })).status).toBe(200);
  });

  it('accepts notifications with 202 and no body', async () => {
    expect(await call(modern('notifications/whatever', {}, null))).toEqual({ status: 202, msg: null });
  });
});

describe('MCP protocol (legacy)', () => {
  it('initializes with the version the client asked for', async () => {
    const r = await call(
      legacy('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'c', version: '1' },
      }),
    );
    expect(r.msg.result.protocolVersion).toBe('2025-06-18');
    expect(r.msg.result.serverInfo.name).toBe('pictus');
  });

  it('falls back to the newest legacy version for an unknown one', async () => {
    const newer = await call(legacy('initialize', { protocolVersion: '2099-01-01' }));
    expect(newer.msg.result.protocolVersion).toBe(LEGACY_VERSIONS[0]);
  });

  it('serves tools without _meta or resultType', async () => {
    const r = await call(legacy('tools/call', { name: 'echo', arguments: { text: 'x' } }));
    expect(r.msg.result.content[0].text).toBe('x');
    expect(r.msg.result.resultType).toBeUndefined();
  });

  it('accepts notifications with 202', async () => {
    expect((await call(legacy('notifications/initialized', {}, null))).status).toBe(202);
  });

  it('answers an unknown method with 200, as older clients expect', async () => {
    const unknown = await call(legacy('nope'));
    expect([unknown.status, unknown.msg.error.code]).toEqual([200, -32601]);
  });
});

describe('MCP protocol (relay deadline)', () => {
  const NOW = 1_000_000;
  const withDeadline = (expiresAt: number): HttpIn => ({
    ...modern('tools/call', { name: 'echo', arguments: { text: 'hi' } }),
    expiresAt,
  });

  it('does not run a tool whose request is about to expire', async () => {
    const ctx = makeCtx();
    const r = await handleHttp(withDeadline(NOW + START_MARGIN_MS - 1), [echo], ctx, NOW);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toMatchObject({ id: 1, error: { code: -32603 } });
    expect(ctx.notified).toEqual([]);
  });

  it('runs a tool when enough time is left', async () => {
    const r = await handleHttp(withDeadline(NOW + START_MARGIN_MS + 1), [echo], makeCtx(), NOW);
    expect(r.status).toBe(200);
  });
});

describe('MCP protocol (internal errors)', () => {
  it('answers 500 with the request id when the server itself fails', async () => {
    const ctx = makeCtx();
    ctx.notify = () => {
      throw new Error('ui gone');
    };
    const r = await handleHttp(modern('tools/call', { name: 'echo', arguments: { text: 'hi' } }, 7), [echo], ctx);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toMatchObject({ id: 7, error: { code: -32603, message: 'Internal error: ui gone' } });
  });
});

describe('MCP protocol (malformed)', () => {
  it('rejects invalid JSON', async () => {
    expect((await call({ body: '{' })).msg.error.code).toBe(-32700);
  });

  it('rejects a body that is not a request object', async () => {
    expect((await call({ body: '[]' })).msg.error.code).toBe(-32600);
  });

  it('rejects a request without a method, keeping its id', async () => {
    expect((await call({ body: '{"jsonrpc":"2.0","id":3}' })).msg).toMatchObject({ id: 3, error: { code: -32600 } });
  });

  it.each([
    ['decodes a base64 value', '=?base64?SGVsbG8sIOS4lueVjA==?=', 'Hello, 世界'],
    ['passes a plain value through', 'plain', 'plain'],
    ['keeps a missing header as null', null, null],
  ])('decodeHeader %s', (_case, input, expected) => {
    expect(decodeHeader(input)).toBe(expected);
  });
});

function tool(name: string): Tool {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} is not registered`);
  return t;
}

/** A 3 × 2 × 2 model: (0,0,0)=1, (2,1,0)=4, (1,0,1)=255. */
function smallEditor(): Editor {
  const grid = new VoxelGrid(3, 2, 2);
  grid.set(0, 0, 0, 1);
  grid.set(2, 1, 0, 4);
  grid.set(1, 0, 1, 255);
  return new Editor({ grid, palette: defaultPalette(), voxelSize: 2 });
}

async function runText(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const [first] = await tool(name).run(args, ctx);
  if (first.type !== 'text') throw new Error(`${name} returned ${first.type}, expected text`);
  return first.text;
}

describe('MCP tools (registry)', () => {
  it('registers the read and edit tools in a fixed order', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'get_model',
      'get_layer',
      'set_voxels',
      'fill_box',
      'new_model',
      'set_color',
      'undo',
    ]);
  });
});

describe('MCP tool get_model', () => {
  it('reports size, voxel count and voxel size', async () => {
    const m = JSON.parse(await runText('get_model', {}, makeCtx(smallEditor())));
    expect(m).toMatchObject({ size: { x: 3, y: 2, z: 2 }, voxelCount: 3, voxelSizeMm: 2 });
  });

  it('lists the palette from index 1 as #rrggbb', async () => {
    const m = JSON.parse(await runText('get_model', {}, makeCtx(smallEditor())));
    expect(m.palette).toHaveLength(defaultPalette().length - 1);
    expect(m.palette[0]).toEqual({ index: 1, hex: '#f5f5f5' });
  });

  it('includes the editor state from the app', async () => {
    const info: AppInfo = { name: 'boat.pictus', isDirty: true, isBusy: false, isLayerMode: false, layer: 5, color: 3 };
    const m = JSON.parse(await runText('get_model', {}, makeCtx(smallEditor(), info)));
    expect(m).toMatchObject({ name: 'boat.pictus', hasUnsavedChanges: true, currentColor: 3 });
  });

  it('reports the layer view as off without a stale layer number', async () => {
    const info: AppInfo = { ...INFO, isLayerMode: false, layer: 5 };
    const m = JSON.parse(await runText('get_model', {}, makeCtx(smallEditor(), info)));
    expect(m.layerView).toEqual({ isOn: false });
  });

  it('reports the open layer as 0-based z and as the number the UI shows', async () => {
    const info: AppInfo = { ...INFO, isLayerMode: true, layer: 5 };
    const m = JSON.parse(await runText('get_model', {}, makeCtx(smallEditor(), info)));
    expect(m.layerView).toEqual({ isOn: true, z: 5, shownInUiAs: 6 });
  });

  it('reports zero voxels for an empty model', async () => {
    const m = JSON.parse(await runText('get_model', {}, makeCtx()));
    expect(m.voxelCount).toBe(0);
  });
});

describe('MCP tool get_layer', () => {
  it('prints rows from the highest y down, two hex digits per cell', async () => {
    const out = await runText('get_layer', { z: 0 }, makeCtx(smallEditor()));
    expect(out.split('\n')).toEqual(['Layer z=0 (3 × 2):', 'y=1: 000004', 'y=0: 010000']);
  });

  it('prints color 255 as ff', async () => {
    const out = await runText('get_layer', { z: 1 }, makeCtx(smallEditor()));
    expect(out.split('\n')[2]).toBe('y=0: 00ff00');
  });

  it.each([
    ['a negative z', -1],
    ['z past the top layer', 2],
    ['a fractional z', 0.5],
    ['z as a string', '0'],
    ['a missing z', undefined],
  ])('rejects %s with the valid range', async (_case, z) => {
    await expect(runText('get_layer', { z }, makeCtx(smallEditor()))).rejects.toThrow(
      /'z' must be a whole number from 0 to 1/,
    );
  });

  it('reports a bad z as an isError result over MCP', async () => {
    const req = modern('tools/call', { name: 'get_layer', arguments: { z: 99 } });
    const r = await handleHttp(req, TOOLS, makeCtx(smallEditor()));
    expect(JSON.parse(r.body).result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('0 to 1') }],
    });
  });
});
