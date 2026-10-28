#!/usr/bin/env node
// Seeds a Kaneo instance for agent squads: one tribe workspace, one board per
// squad, a tribe Decisions board, one agent account per squad and a single
// CI/CD agent. Writes each agent's API key and MCP config to .generated/.
//
//   node seed.mjs            # reads .env next to this file
//
// Safe to re-run: existing workspace, projects, labels and agents are reused.
// API keys are only created for agents that do not have one in .generated/.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { client, loadEnv, required, signIn, urls, waitForApi } from "./lib.mjs";
import { squads, tribe } from "./squads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, ".env"));

const { clientUrl, apiUrl } = urls();
const owner = {
  email: required("KANEO_OWNER_EMAIL"),
  password: required("KANEO_OWNER_PASSWORD"),
  name: process.env.KANEO_OWNER_NAME || "Product Owner",
};
const outDir = join(here, ".generated");
const agentsFile = join(outDir, "agents.json");
const CICD_ROLE = "cicd-agent";
// Each agent's HTTP MCP endpoint: the CI/CD agent on the base port, squads after.
const mcpBasePort = Number(process.env.KANEO_MCP_BASE_PORT || 7100);

async function ensureWorkspace(call) {
  const { data: workspaces } = await call("GET", "/workspace");
  const list = Array.isArray(workspaces)
    ? workspaces
    : (workspaces?.items ?? []);
  const existing = list.find((w) => w.slug === tribe.slug);
  if (existing) return existing;
  const { data } = await call("POST", "/auth/organization/create", {
    name: tribe.name,
    slug: tribe.slug,
    metadata: { description: tribe.description },
  });
  return data;
}

async function ensureCicdRole(call, workspaceId) {
  const { data: roles } = await call(
    "GET",
    `/auth/organization/list-roles?organizationId=${workspaceId}`,
  );
  if ((roles ?? []).some((r) => r.role === CICD_ROLE)) return;
  await call("POST", "/auth/organization/create-role", {
    organizationId: workspaceId,
    role: CICD_ROLE,
    permission: {
      project: ["read"],
      task: ["create", "read", "update", "close"],
      label: ["read", "update"],
      workspace: ["read"],
    },
  });
}

async function ensureLabels(call, workspaceId) {
  const { data: labels } = await call("GET", `/label/workspace/${workspaceId}`);
  const names = new Set((labels ?? []).map((l) => l.name));
  for (const label of tribe.labels) {
    if (names.has(label.name)) continue;
    await call("POST", "/label", { ...label, workspaceId });
  }
}

async function ensureProject(call, workspaceId, board) {
  const { data: projects } = await call(
    "GET",
    `/project?workspaceId=${workspaceId}`,
  );
  const list = Array.isArray(projects) ? projects : (projects?.items ?? []);
  let project = list.find((p) => p.slug === board.key);
  const isNew = !project;
  if (!project) {
    ({ data: project } = await call("POST", "/project", {
      name: board.name,
      workspaceId,
      icon: board.icon,
      slug: board.key,
    }));
  }
  if (isNew) {
    await shapeColumns(call, project.id, board.columns);
    for (const field of board.fields) {
      await call("POST", "/custom-field", { projectId: project.id, ...field });
    }
  }
  return project;
}

// New projects start with To Do, In Progress, In Review and Done (final).
// Rename the ones a column names in `from`, add the rest, then put every
// column in board order.
async function shapeColumns(call, projectId, columns) {
  const { data: existing } = await call("GET", `/column/${projectId}`);
  const bySlug = new Map(existing.map((column) => [column.slug, column]));
  const ids = [];
  for (const { from, ...column } of columns) {
    const current = from ? bySlug.get(from) : undefined;
    if (current) {
      await call("PUT", `/column/${current.id}`, column);
      ids.push(current.id);
    } else {
      const { data } = await call("POST", `/column/${projectId}`, column);
      ids.push(data.id);
    }
  }
  await call("PUT", `/column/reorder/${projectId}`, {
    columns: ids.map((id, position) => ({ id, position })),
  });
}

async function ensureAgent(adminCall, workspaceId, agent, saved) {
  const password = saved?.password ?? randomBytes(18).toString("base64url");
  const { data: users } = await adminCall(
    "GET",
    `/admin/users?search=${encodeURIComponent(agent.email)}`,
  );
  const list = Array.isArray(users)
    ? users
    : (users?.users ?? users?.items ?? []);
  let user = list.find((u) => u.email === agent.email);
  if (!user) {
    ({
      data: { user },
    } = await adminCall("POST", "/auth/admin/create-user", {
      email: agent.email,
      password,
      name: agent.name,
      role: "user",
    }));
  }

  const { data: members } = await adminCall(
    "GET",
    `/admin/workspaces/${workspaceId}/members`,
  );
  const memberList = Array.isArray(members) ? members : (members?.items ?? []);
  if (!memberList.some((m) => (m.userId ?? m.user?.id) === user.id)) {
    await adminCall("POST", `/admin/workspaces/${workspaceId}/members`, {
      userId: user.id,
      role: agent.role,
    });
  }

  if (agent.projectIds) {
    await adminCall(
      "PUT",
      `/workspace/${workspaceId}/members/${user.id}/project-access`,
      { projectAccess: "selected", projectIds: agent.projectIds },
    );
  }

  let apiKey = saved?.apiKey;
  if (!apiKey) {
    if (!saved?.password) {
      // Created before this run without a saved password: reset it so the
      // script can sign in and mint the key.
      await adminCall("POST", "/auth/admin/set-user-password", {
        userId: user.id,
        newPassword: password,
      });
    }
    const agentCall = client();
    await signIn(agentCall, { email: agent.email, password });
    const { data } = await agentCall("POST", "/auth/api-key/create", {
      name: `${agent.id} (seed)`,
    });
    apiKey = data.key;
  }
  return { ...agent, userId: user.id, password, apiKey };
}

function mcpHttpConfig(agent) {
  return {
    mcpServers: {
      kaneo: { type: "http", url: `http://localhost:${agent.mcpPort}/mcp` },
    },
  };
}

// One MCP container per agent, published on loopback only: whoever reaches
// the port acts as that agent.
function mcpCompose(agents) {
  const lines = [
    "# Generated by seed.mjs. Contains API keys; keep private.",
    "services:",
  ];
  for (const agent of agents) {
    lines.push(
      `  mcp-${agent.id}:`,
      "    image: kaneo-agent-squads:local",
      '    command: ["node", "/app/packages/mcp/dist/index.js", "serve-http"]',
      "    environment:",
      "      - KANEO_API_URL=http://kaneo:5173",
      `      - KANEO_API_KEY=${agent.apiKey}`,
      "      - KANEO_MCP_HOST=0.0.0.0",
      "    ports:",
      `      - "127.0.0.1:${agent.mcpPort}:3100"`,
      "    depends_on: [kaneo]",
      "    restart: unless-stopped",
    );
  }
  return `${lines.join("\n")}\n`;
}

function mcpConfig(agent) {
  return {
    mcpServers: {
      kaneo: {
        command: "npx",
        args: ["-y", "@kaneo/mcp", "serve"],
        env: {
          KANEO_API_URL: apiUrl.replace(/\/api$/, ""),
          KANEO_API_KEY: agent.apiKey,
        },
      },
    },
  };
}

async function main() {
  await waitForApi();
  const call = client();
  await signIn(call, owner, { signUp: true });
  const workspace = await ensureWorkspace(call);
  console.log(`Workspace ${workspace.name} (${workspace.id})`);

  await ensureCicdRole(call, workspace.id);
  await ensureLabels(call, workspace.id);

  const squadProjects = [];
  for (const squad of squads) {
    const project = await ensureProject(call, workspace.id, squad);
    squadProjects.push({ squad, project });
    console.log(`  squad ${squad.key.padEnd(4)} ${squad.name}`);
  }
  const decisions = await ensureProject(call, workspace.id, tribe.decisions);
  console.log(
    `  board ${tribe.decisions.key.padEnd(4)} ${tribe.decisions.name}`,
  );

  const saved = existsSync(agentsFile)
    ? JSON.parse(readFileSync(agentsFile, "utf8"))
    : {};
  const domain = tribe.agentEmailDomain;
  const roster = [
    ...squadProjects.map(({ squad }, i) => ({
      id: `${squad.id}-agent`,
      name: `${squad.name} agent`,
      email: `${squad.id}-agent@${domain}`,
      role: "member",
      squad: squad.id,
      mcpPort: mcpBasePort + 1 + i,
    })),
    {
      // The only agent allowed to close tasks and (on GitHub) to push.
      id: "cicd-agent",
      name: "CI/CD agent",
      email: `cicd-agent@${domain}`,
      role: CICD_ROLE,
      squad: null,
      mcpPort: mcpBasePort,
      // Every squad board, but not the Decisions board: only the product
      // owner accepts decisions.
      projectIds: squadProjects.map(({ project }) => project.id),
    },
  ];

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const result = {};
  for (const agent of roster) {
    result[agent.id] = await ensureAgent(
      call,
      workspace.id,
      agent,
      saved[agent.id],
    );
    writeFileSync(
      join(outDir, `${agent.id}.mcp.json`),
      `${JSON.stringify(mcpConfig(result[agent.id]), null, 2)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(outDir, `${agent.id}.mcp-http.json`),
      `${JSON.stringify(mcpHttpConfig(agent), null, 2)}\n`,
    );
    console.log(
      `  agent ${agent.id.padEnd(17)} ${agent.role.padEnd(10)} MCP http://localhost:${agent.mcpPort}/mcp`,
    );
  }
  writeFileSync(agentsFile, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(
    join(outDir, "compose.mcp.yml"),
    mcpCompose(Object.values(result)),
    { mode: 0o600 },
  );

  console.log(`\nOpen ${clientUrl} and sign in as ${owner.email}.`);
  console.log(`Decisions board: ${decisions.id}`);
  console.log(`Agent API keys and MCP configs: ${outDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
