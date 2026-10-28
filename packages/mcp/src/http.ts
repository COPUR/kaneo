import { createServer, type IncomingMessage, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { isAllowedHost } from "./utils/allowed-host.js";

export type HttpOptions = {
  host: string;
  port: number;
  allowedHosts: string[];
};

export function httpOptionsFromEnv(): HttpOptions {
  return {
    host: process.env.KANEO_MCP_HOST || "127.0.0.1",
    port: Number(process.env.KANEO_MCP_PORT || 3100),
    allowedHosts: (process.env.KANEO_MCP_ALLOWED_HOSTS || "localhost,127.0.0.1")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  };
}

// Streamable HTTP at /mcp, stateless: every request gets its own server and
// transport, acting as the KANEO_API_KEY this process was started with. The
// endpoint carries that key's access, so keep it on loopback or a private
// network, never on a public interface.
export function startHttpServer(options: HttpOptions): Server {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    // A browser page cannot reach the agent's key through DNS rebinding.
    if (!isAllowedHost(req.headers.host, options.allowedHosts)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }

    const mcp = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, await readJson(req));
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Invalid request" },
            id: null,
          }),
        );
      }
    }
  });
  server.listen(options.port, options.host);
  return server;
}

const MAX_BODY = 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
