import { describe, expect, it } from 'vitest';
import { Editor } from '../src/lib/core/editor';
import { handleHttp, decodeHeader, LEGACY_VERSIONS, type HttpIn } from '../src/lib/mcp/protocol';
import type { Tool, ToolCtx } from '../src/lib/mcp/tools';

const V = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': V,
  'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' },
};

function makeCtx(editor = new Editor()): ToolCtx & { notified: string[] } {
  const notified: string[] = [];
  return {
    editor,
    notified,
    info: () => ({ name: 'Untitled', dirty: false, layer: 0, color: 1 }),
    newModel: () => {},
    highlight: () => {},
    snapshot: () => null,
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

  it('lists and calls tools', async () => {
    const list = await call(modern('tools/list'));
    expect(list.msg.result.tools.map((t: Tool) => t.name)).toEqual(['echo']);
    const ctx = makeCtx();
    const r = await call(modern('tools/call', { name: 'echo', arguments: { text: 'hi' } }), ctx);
    expect(r.status).toBe(200);
    expect(r.msg.result).toMatchObject({
      resultType: 'complete',
      isError: false,
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(ctx.notified).toEqual(['echo']);
  });

  it('reports tool failures as isError results', async () => {
    const r = await call(modern('tools/call', { name: 'echo', arguments: { text: 'boom' } }));
    expect(r.status).toBe(200);
    expect(r.msg.result.isError).toBe(true);
    expect(r.msg.result.content[0].text).toBe('bad text');
  });

  it('rejects unknown tools, methods and versions', async () => {
    expect((await call(modern('tools/call', { name: 'nope' }))).msg.error.code).toBe(-32602);
    const m = await call(modern('resources/list'));
    expect([m.status, m.msg.error.code]).toEqual([404, -32601]);
    const req = modern('ping');
    const v = await call({ ...req, body: req.body.replace(V, '1900-01-01'), protocolVersion: '1900-01-01' });
    expect([v.status, v.msg.error.code]).toEqual([400, -32022]);
    expect(v.msg.error.data).toEqual({ supported: [V], requested: '1900-01-01' });
  });

  it('rejects headers that do not match the body', async () => {
    const base = modern('tools/call', { name: 'echo', arguments: {} });
    for (const bad of [{ protocolVersion: null }, { method: 'tools/list' }, { name: 'other' }]) {
      const r = await call({ ...base, ...bad });
      expect([r.status, r.msg.error.code]).toEqual([400, -32020]);
    }
    expect((await call({ ...base, name: '=?base64?ZWNobw==?=' })).status).toBe(200);
  });

  it('accepts notifications with 202 and no body', async () => {
    expect(await call(modern('notifications/whatever', {}, null))).toEqual({ status: 202, msg: null });
  });
});

describe('MCP protocol (legacy)', () => {
  it('negotiates initialize', async () => {
    const r = await call(
      legacy('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'c', version: '1' },
      }),
    );
    expect(r.msg.result.protocolVersion).toBe('2025-06-18');
    expect(r.msg.result.serverInfo.name).toBe('pictus');
    const newer = await call(legacy('initialize', { protocolVersion: '2099-01-01' }));
    expect(newer.msg.result.protocolVersion).toBe(LEGACY_VERSIONS[0]);
  });

  it('serves tools without _meta and accepts notifications', async () => {
    const r = await call(legacy('tools/call', { name: 'echo', arguments: { text: 'x' } }));
    expect(r.msg.result.content[0].text).toBe('x');
    expect(r.msg.result.resultType).toBeUndefined();
    expect((await call(legacy('notifications/initialized', {}, null))).status).toBe(202);
    const unknown = await call(legacy('nope'));
    expect([unknown.status, unknown.msg.error.code]).toEqual([200, -32601]);
  });
});

describe('MCP protocol (malformed)', () => {
  it('rejects bad JSON and non-requests', async () => {
    expect((await call({ body: '{' })).msg.error.code).toBe(-32700);
    expect((await call({ body: '[]' })).msg.error.code).toBe(-32600);
    expect((await call({ body: '{"jsonrpc":"2.0","id":3}' })).msg).toMatchObject({ id: 3, error: { code: -32600 } });
  });

  it('decodes base64 header values', () => {
    expect(decodeHeader('=?base64?SGVsbG8sIOS4lueVjA==?=')).toBe('Hello, 世界');
    expect(decodeHeader('plain')).toBe('plain');
    expect(decodeHeader(null)).toBeNull();
  });
});
