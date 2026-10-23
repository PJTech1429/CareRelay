import http from "node:http";
import {BUILD_ID,verifyBuild} from "./release/build.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./store.js";
import { CareRelayService } from "./service.js";
import { McpHandler, PROTOCOL_VERSION } from "./mcp.js";
import { ConversationController } from "./conversation.js";
import { createModel } from "./model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = process.env.CARERELAY_DATA ?? path.join(root, "data", "state.json");
const port = Number(process.env.PORT ?? 8787);
const store = new JsonStore(dataFile);
const dynamicStore = new JsonStore(process.env.CARERELAY_DYNAMIC_DATA ?? `${dataFile}.dynamic.json`);
const conversation = new ConversationController(dynamicStore);
const handler = new McpHandler(new CareRelayService(store, { model: createModel() }), conversation);

export function createServer(options = {}) {
  const activeConversation = options.conversation ?? (options.provider ? new ConversationController(options.dynamicStore ?? dynamicStore, {...options.conversationOptions,provider:options.provider}) : conversation);
  const activeHandler = (options.provider || options.conversation) ? new McpHandler(handler.service, activeConversation) : handler;
  return http.createServer(async (request, response) => {
    try {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      response.setHeader("X-CareRelay-Build", BUILD_ID);
      const requestPath = request.url.split("?")[0];
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      const actualPort = request.socket.localPort;
      const previewOrigin=options.preview===true?'http://terminal.local:4173':null;
      const origin = request.headers.origin;
      const allowed = new Set([`http://127.0.0.1:${request.socket.localPort}`, `http://localhost:${request.socket.localPort}`]);
      if (previewOrigin)allowed.add(previewOrigin);
      if (origin && !allowed.has(origin)) return json(response, 403, {error:"Invalid Origin"});
      if (request.headers.host && !new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`,...(previewOrigin?['terminal.local:4173']:[])]).has(request.headers.host)) return json(response,403,{error:"Invalid Host"});
      setCors(request, response);
      if (options.isReady && !options.isReady()) return json(response,503,{error:"CareRelay is starting; no AWS request was made."});
      if (requestPath === "/api/release" && request.method === "GET") return json(response,200,await verifyBuild(root));
      if (requestPath === "/boot.js") return file(response,"public/boot.js","text/javascript; charset=utf-8");
      if (options.route && await options.route(request, response)) return;
      if (requestPath === "/mcp") return await handleMcp(request, response, activeHandler,previewOrigin);
      if (requestPath === "/api/reset" && request.method === "POST") {
        await store.reset();
        return json(response, 200, { reset: true });
      }
      if (requestPath === "/api/dynamic-health" && request.method === "GET") return json(response, 200, activeConversation.provider.health());
      if (requestPath === "/api/health" && request.method === "GET") return json(response, 200, await handler.service.health());
      if (["/","/index.html","/handoff","/history","/settings"].includes(requestPath)) return file(response, "public/index.html", "text/html; charset=utf-8");
      if(requestPath==='/product.js')return file(response,'public/product.js','text/javascript; charset=utf-8');
      if(requestPath==='/product.css')return file(response,'public/product.css','text/css; charset=utf-8');
      if(requestPath==='/product-layout.css')return file(response,'public/product-layout.css','text/css; charset=utf-8');
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 500, { error: error.message });
    }
  });
}

async function handleMcp(request, response, handler, previewOrigin=null) {
  if (process.env.UPSTREAM_MCP_URL) return proxyMcp(request, response);
  if (request.method === "GET") {
    response.writeHead(405, { Allow: "POST, DELETE" });
    return response.end();
  }
  const origin = request.headers.origin;
  if (origin && !new Set([`http://127.0.0.1:${request.socket.localPort}`, `http://localhost:${request.socket.localPort}`,...(previewOrigin?[previewOrigin]:[])]).has(origin)) {
    return json(response, 403, { jsonrpc: "2.0", error: { code: -32000, message: "Invalid Origin" } });
  }
  if (request.method === "DELETE") {
    const sessionId = request.headers["mcp-session-id"];
    handler.deleteSession(sessionId);
    response.writeHead(204);
    return response.end();
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST, DELETE" });
    return response.end();
  }
  const message = JSON.parse(await readBody(request));
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return json(response, 400, { error: "Invalid JSON-RPC request" });
  const isInitialize = message.method === "initialize";
  const protocolHeader = request.headers["mcp-protocol-version"];
  if (!isInitialize && protocolHeader !== PROTOCOL_VERSION) return json(response, 400, { error: "Missing or unsupported MCP-Protocol-Version" });
  let sessionId = request.headers["mcp-session-id"];
  if (isInitialize) sessionId = handler.createSession();
  else if (!sessionId || !handler.hasSession(sessionId)) return json(response, 404, { error: "Unknown MCP session" });
  const result = await handler.handle(message, sessionId);
  if (result.notification) {
    response.writeHead(202);
    return response.end();
  }
  return json(response, 200, result.response, { "MCP-Session-Id": sessionId });
}

async function proxyMcp(request, response) {
  const body = request.method === "POST" ? await readBody(request) : undefined;
  const upstreamHeaders = { "Content-Type": "application/json", Accept: request.headers.accept ?? "application/json, text/event-stream" };
  for (const name of ["mcp-protocol-version", "mcp-session-id"]) if (request.headers[name]) upstreamHeaders[name] = request.headers[name];
  const upstream = await fetch(process.env.UPSTREAM_MCP_URL, { method: request.method, headers: upstreamHeaders, ...(body ? { body } : {}) });
  const headers = { "Content-Type": upstream.headers.get("content-type") ?? "application/json" };
  const session = upstream.headers.get("mcp-session-id");
  if (session) headers["MCP-Session-Id"] = session;
  response.writeHead(upstream.status, headers);
  response.end(await upstream.text());
}

function setCors(request, response) {
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? `http://127.0.0.1:${port}`);
  response.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
}

async function file(response, relative, contentType) {
  response.writeHead(200, { "Content-Type": contentType });
  response.end(await readFile(path.join(root, relative)));
}
function json(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) request.destroy(); });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, "127.0.0.1", () => console.log(`CareRelay local app: http://127.0.0.1:${port}`));
}
