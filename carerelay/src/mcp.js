import { randomUUID } from "node:crypto";

export const PROTOCOL_VERSION = "2025-11-25";

export const toolDefinitions = [
  {
    name: "record_caregiver_update",
    description: "Record a non-medical caregiver update, extracting sourced facts and unowned coordination tasks.",
    inputSchema: {
      type: "object",
      required: ["caregiver", "text"],
      properties: {
        caregiver: { type: "string" }, person: { type: "string" }, text: { type: "string" }, occurredAt: { type: "string" }
      }
    }
  },
  {
    name: "request_task_assignment_consent",
    description: "Create a single-use, actor-bound consent request before assigning a care coordination task.",
    inputSchema: {
      type: "object", required: ["taskId", "owner", "requestedBy"],
      properties: { taskId: { type: "string" }, owner: { type: "string" }, requestedBy: { type: "string" } }
    }
  },
  {
    name: "confirm_task_assignment",
    description: "Assign a pending task only after explicit human confirmation.",
    inputSchema: {
      type: "object",
      required: ["consentId", "taskId", "owner", "confirmedBy", "confirmed"],
      properties: {
        consentId: { type: "string" }, taskId: { type: "string" }, owner: { type: "string" }, confirmedBy: { type: "string" }, confirmed: { const: true }
      }
    }
  },
  {
    name: "get_caregiver_handoff",
    description: "Generate a later caregiver handoff from persisted facts and confirmed tasks.",
    inputSchema: {
      type: "object", required: ["nextCaregiver"], properties: { nextCaregiver: { type: "string" } }
    }
  },
  { name: "get_audit_trail", description: "Return consent and provenance records for transparent review.", inputSchema: { type: "object", properties: {} } },
  { name: "health_check", description: "Report local model readiness and the non-medical boundary.", inputSchema: { type: "object", properties: {} } }
];

export class McpHandler {
  constructor(service, conversation = null) {
    this.conversation = conversation;
    this.service = service;
    this.sessions = new Map();
  }

  createSession() {
    const id = randomUUID();
    this.sessions.set(id, { initialized: false });
    return id;
  }

  deleteSession(id) { return this.sessions.delete(id); }
  hasSession(id) { return this.sessions.has(id); }

  async handle(message, sessionId) {
    const { id, method, params = {} } = message;
    try {
      if (method === "initialize") {
        if (params.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Unsupported protocol version: ${params.protocolVersion}`);
        return {
          sessionId,
          response: rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "carerelay", title: "CareRelay", version: "1.0.0" },
            instructions: "Non-medical care coordination only. Side effects require explicit confirmation."
          })
        };
      }
      if (method === "notifications/initialized") {
        this.sessions.get(sessionId).initialized = true;
        return { notification: true };
      }
      if (!this.sessions.get(sessionId)?.initialized) throw new Error("Session is not initialized.");
      if (method === "tools/list") return { response: rpcResult(id, { tools: this.conversation ? toolDefinitions.map(t => ({...t, description: t.description + " Optional mode=dynamic uses session-bound proposals; see README.md.", inputSchema: { ...t.inputSchema, required: [], properties: { ...t.inputSchema.properties, mode: {enum:["dynamic"]}, operation:{type:"string"}, proposalId:{type:"string"}, version:{type:"integer"}, intent:{type:"string"}, targetId:{type:"string"} } }})) : toolDefinitions }) };
      if (method === "tools/call") {
        const value = await this.callTool(params.name, params.arguments ?? {}, sessionId);
        return { response: rpcResult(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }) };
      }
      return { response: rpcError(id, -32601, `Method not found: ${method}`) };
    } catch (error) {
      return { response: rpcError(id ?? null, -32602, error.message, { code: error.code, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }) };
    }
  }

  async callTool(name, args, sessionId) {
    const wireSessionId=sessionId;
    if (args.mode === "dynamic") {
      if (!this.conversation || !sessionId) throw new Error("Dynamic controller unavailable");
      const c = this.conversation;
      sessionId=this.sessions.get(sessionId)?.conversationId??sessionId;
      if (name === "record_caregiver_update") {
        if (args.operation === "open") return c.open(sessionId, args.caregiver);
        if (["connectWorkspace","prepareMessage","sendMessage","enableConversation","recordProductAction","history"].includes(args.operation)) {if(typeof c[args.operation]!=="function")throw new Error("Product operation unavailable");return c[args.operation](sessionId,args);}
        if(args.operation==="resumeWorkspace") {const result=await c.resumeWorkspace(sessionId,args);this.sessions.set(wireSessionId,{initialized:true,conversationId:result.resumeSessionId});return result;}

        if (["manual", "review", "refuse", "manualCorrection", "prepareAi", "approveAi", "recoverAi", "cancelAi", "establishAllowance", "lockAllowance", "costStatus"].includes(args.operation)) { if (typeof c[args.operation] !== "function") throw new Error("Human review unavailable in this mode"); return c[args.operation](sessionId, args); }
        if (args.operation === "snapshot") return c.snapshot(sessionId);
        if (args.operation === "dismiss") return c.cancel(sessionId, args);
        return c.turn(sessionId, args);
      }
      if (name === "request_task_assignment_consent") return c.preview(sessionId, args);
      if (name === "confirm_task_assignment") return c.confirm(sessionId, args);
      if (name === "get_caregiver_handoff") return c.handoff(sessionId);
      if (name === "get_audit_trail") return c.proof(sessionId);
      if (name === "health_check") return c.provider.health();
    }
    if (name === "record_caregiver_update") return this.service.recordUpdate(args);
    if (name === "request_task_assignment_consent") return this.service.requestAssignmentConsent(args);
    if (name === "confirm_task_assignment") return this.service.confirmAssignment(args);
    if (name === "get_caregiver_handoff") return this.service.getHandoff(args);
    if (name === "get_audit_trail") return this.service.getAudit();
    if (name === "health_check") return this.service.health();
    throw new Error(`Unknown tool: ${name}`);
  }
}

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }; }
