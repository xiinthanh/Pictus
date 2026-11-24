// MCP over Streamable HTTP, "dual-era":
// - modern (2026-07-28+): every request carries its protocol version in
//   params._meta, mirrored in HTTP headers that must match the body;
// - legacy (2025-03-26 .. 2025-11-25): an `initialize` handshake first.
// The Rust relay has already checked path, Origin, token and size.
import type { Tool, ToolCtx } from './tools';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SERVER_INFO = { name: 'pictus', version: '0.1.0' };

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

export const INSTRUCTIONS = [
  'Pictus is a voxel editor for 3D printing. These tools edit the model that is open in the app; the user watches every edit live.',
  'Coordinates are integers: x and y are horizontal, z points up (z is the layer). Cell (0,0,0) is a corner; each axis runs from 0 to size-1.',
  'Colors are palette indices starting at 1; 0 means empty. Call get_model first to learn the size and the palette.',
  'Every tool call is one undo step for the user. One voxel prints as voxelSize millimetres.',
].join('\n');

/** What the Rust relay forwards: the body plus the MCP headers it saw. */
export interface HttpIn {
  body: string;
  protocolVersion?: string | null;
  method?: string | null;
  name?: string | null;
}

export interface HttpOut {
  status: number;
  /** Empty for 202 Accepted. */
  body: string;
}

type Id = string | number | null;
interface RpcError { code: number; message: string; data?: unknown }

const accepted: HttpOut = { status: 202, body: '' };

function out(status: number, id: Id, payload: { result: unknown } | { error: RpcError }): HttpOut {
  return { status, body: JSON.stringify({ jsonrpc: '2.0', id, ...payload }) };
}

const fail = (status: number, id: Id, code: number, message: string, data?: unknown) =>
  out(status, id, { error: data === undefined ? { code, message } : { code, message, data } });

/** Decodes the `=?base64?...?=` sentinel used for non-ASCII header values. */
export function decodeHeader(v: string | null | undefined): string | null {
  if (v == null) return null;
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export async function handleHttp(req: HttpIn, tools: Tool[], ctx: ToolCtx): Promise<HttpOut> {
  let msg: unknown;
  try {
    msg = JSON.parse(req.body);
  } catch {
    return fail(400, null, -32700, 'Parse error');
  }
  if (!isObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    const id = isObject(msg) ? toId(msg.id) : null;
    return fail(400, id, -32600, 'Invalid request: expected a single JSON-RPC 2.0 request or notification');
  }
  const method = msg.method;
  const isNotification = !('id' in msg);
  const id = toId(msg.id);
  const params = isObject(msg.params) ? msg.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  const version = meta[META_VERSION];

  if (typeof version === 'string') {
    // ---- modern: stateless, versioned per request
    if (!MODERN_VERSIONS.includes(version)) {
      return fail(400, id, -32022, 'Unsupported protocol version', { supported: MODERN_VERSIONS, requested: version });
    }
    if (isNotification) return accepted;
    const mismatch = headerMismatch(req, version, method, params);
    if (mismatch) return fail(400, id, -32020, `Header mismatch: ${mismatch}`);
    const complete = (result: object) => out(200, id, { result: { resultType: 'complete', ...result } });
    switch (method) {
      case 'server/discover':
        return complete({
          supportedVersions: MODERN_VERSIONS,
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return complete({});
      case 'tools/list':
        return complete({ tools: tools.map(definition) });
      case 'tools/call': {
        const r = await callTool(params, tools, ctx);
        return 'error' in r ? fail(200, id, r.error.code, r.error.message) : complete(r.result);
      }
      default:
        return fail(404, id, -32601, `Method not found: ${method}`);
    }
  }

  // ---- legacy: initialize handshake; errors use HTTP 200 (a legacy 404 means "session expired")
  if (isNotification) return accepted;
  if (method !== 'initialize' && req.protocolVersion && !LEGACY_VERSIONS.includes(req.protocolVersion)) {
    return fail(400, id, -32600, `Unsupported MCP-Protocol-Version: ${req.protocolVersion}`);
  }
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const protocolVersion = typeof asked === 'string' && LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0];
      return out(200, id, {
        result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS },
      });
    }
    case 'ping':
      return out(200, id, { result: {} });
    case 'tools/list':
      return out(200, id, { result: { tools: tools.map(definition) } });
    case 'tools/call': {
      const r = await callTool(params, tools, ctx);
      return 'error' in r ? fail(200, id, r.error.code, r.error.message) : out(200, id, r);
    }
    default:
      return fail(200, id, -32601, `Method not found: ${method}`);
  }
}

function headerMismatch(req: HttpIn, version: string, method: string, params: Record<string, unknown>): string | null {
  if (req.protocolVersion !== version) return `MCP-Protocol-Version header '${req.protocolVersion ?? ''}' does not match body '${version}'`;
  if (req.method !== method) return `Mcp-Method header '${req.method ?? ''}' does not match body '${method}'`;
  if (method === 'tools/call') {
    const name = decodeHeader(req.name);
    if (name !== params.name) return `Mcp-Name header '${name ?? ''}' does not match body '${String(params.name)}'`;
  }
  return null;
}

function definition(t: Tool) {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema };
}

async function callTool(
  params: Record<string, unknown>,
  tools: Tool[],
  ctx: ToolCtx,
): Promise<{ result: object } | { error: RpcError }> {
  const tool = tools.find((t) => t.name === params.name);
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${String(params.name)}` } };
  const args = isObject(params.arguments) ? params.arguments : {};
  ctx.notify(tool.name);
  try {
    return { result: { content: await tool.run(args, ctx), isError: false } };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    return { result: { content: [{ type: 'text', text }], isError: true } };
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toId(v: unknown): Id {
  return typeof v === 'string' || typeof v === 'number' ? v : null;
}
