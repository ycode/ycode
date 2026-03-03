import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateToken } from '@/lib/repositories/mcpTokenRepository';
import { createMcpServer } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
}

const sessions = new Map<string, McpSession>();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

async function authenticateToken(token: string): Promise<boolean> {
  try {
    const result = await validateToken(token);
    return result !== null;
  } catch {
    return false;
  }
}

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-protocol-version');
  headers.set('Access-Control-Expose-Headers', 'mcp-session-id');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createSessionTransport() {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, { transport, server, lastActivity: Date.now() });
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  return { server, transport };
}

/**
 * Auto-initialize a fresh server+transport so it can handle non-init requests.
 * This is needed on serverless (Vercel) where in-memory sessions are lost
 * between requests that hit different instances.
 */
async function autoInitialize(
  transport: WebStandardStreamableHTTPServerTransport,
  url: string,
): Promise<void> {
  const initReq = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
  });

  await transport.handleRequest(initReq, {
    parsedBody: {
      jsonrpc: '2.0',
      id: '_auto_init',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'ycode-auto', version: '1.0.0' },
      },
    },
  });

  const notifReq = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': transport.sessionId!,
    },
  });

  await transport.handleRequest(notifReq, {
    parsedBody: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
}

/**
 * Ensure the Accept header includes both required MIME types.
 * Some MCP clients (e.g., Claude Code) don't send text/event-stream,
 * but the SDK enforces it even when enableJsonResponse is true.
 */
function ensureAcceptHeader(request: Request): Request {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/json') && accept.includes('text/event-stream')) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set('Accept', 'application/json, text/event-stream');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-expect-error duplex is needed for streaming body but not in all TS defs
    duplex: 'half',
  });
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const normalized = ensureAcceptHeader(request);
  const sessionId = normalized.headers.get('mcp-session-id');

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    return session.transport.handleRequest(normalized);
  }

  if (normalized.method !== 'POST') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session expired. Send a new initialize request.' },
      id: null,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await normalized.json();
  const isInit = !Array.isArray(body) && body.method === 'initialize';

  const { server, transport } = createSessionTransport();
  await server.connect(transport);

  if (isInit) {
    const req = new Request(normalized.url, {
      method: 'POST',
      headers: normalized.headers,
    });
    return transport.handleRequest(req, { parsedBody: body });
  }

  // Session was lost (serverless instance recycled) — auto-initialize
  await autoInitialize(transport, normalized.url);

  const actualReq = new Request(normalized.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': transport.sessionId!,
    },
  });

  return transport.handleRequest(actualReq, { parsedBody: body });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const isValid = await authenticateToken(token);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid MCP token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    cleanupStaleSessions();
    const response = await handleMcpRequest(request);
    return addCorsHeaders(response);
  } catch (error) {
    console.error('[MCP POST] Error:', error);
    return addCorsHeaders(new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32603, message: error instanceof Error ? error.message : 'Internal server error' },
      id: null,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const isValid = await authenticateToken(token);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid MCP token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionId = request.headers.get('mcp-session-id');
    if (!sessionId || !sessions.has(sessionId)) {
      return addCorsHeaders(new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session not found. Send a POST initialize first.' },
        id: null,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    const response = await session.transport.handleRequest(request);
    return addCorsHeaders(response);
  } catch (error) {
    console.error('[MCP GET] Error:', error);
    return addCorsHeaders(new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32603, message: error instanceof Error ? error.message : 'Internal server error' },
      id: null,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const isValid = await authenticateToken(token);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid MCP token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      sessions.delete(sessionId);
      return addCorsHeaders(new Response(null, { status: 204 }));
    }

    return addCorsHeaders(new Response(null, { status: 204 }));
  } catch (error) {
    console.error('[MCP DELETE] Error:', error);
    return addCorsHeaders(new Response(null, { status: 204 }));
  }
}

export async function OPTIONS() {
  return addCorsHeaders(new Response(null, { status: 204 }));
}
