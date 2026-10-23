import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

async function running(context){const server=createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));context.after(()=>server.close());return `http://127.0.0.1:${server.address().port}`;}

test("browser responses include defensive headers",async context=>{const origin=await running(context);const response=await fetch(origin);assert.match(response.headers.get("content-security-policy"),/frame-ancestors 'none'/);assert.equal(response.headers.get("x-content-type-options"),"nosniff");assert.equal(response.headers.get("referrer-policy"),"no-referrer");});
test("MCP rejects missing protocol version after initialization",async context=>{const origin=await running(context);const init=await fetch(`${origin}/mcp`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25"}})});const session=init.headers.get("mcp-session-id");const response=await fetch(`${origin}/mcp`,{method:"POST",headers:{"Content-Type":"application/json","MCP-Session-Id":session},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list"})});assert.equal(response.status,400);});
test("unknown sessions are rejected",async context=>{const origin=await running(context);const response=await fetch(`${origin}/mcp`,{method:"POST",headers:{"Content-Type":"application/json","MCP-Session-Id":"forged","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});assert.equal(response.status,404);});
