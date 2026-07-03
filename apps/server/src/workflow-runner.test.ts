import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DbRepository, WorkflowDefinition } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { installTestDb } from "@nyxel/db/test-utils";
import { runWorkflowAndWait } from "./workflow-runner";

let ctx: Awaited<ReturnType<typeof installTestDb>>;
let db: DbRepository;
let originalFetch: typeof fetch;
let originalFlag: string | undefined;

beforeEach(async () => {
  ctx = await installTestDb();
  db = getDb();
  originalFetch = globalThis.fetch;
  originalFlag = process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalFlag === undefined) delete process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP;
  else process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP = originalFlag;
  await ctx.cleanup();
});

function httpWorkflowDefinition(url: string): WorkflowDefinition {
  return {
    nodes: [
      {
        id: "n1",
        type: "http_request",
        position: { x: 0, y: 0 },
        data: { url, method: "GET" },
      },
    ],
    edges: [],
  };
}

async function seedWorkflow(url: string) {
  const user = await db.getOrCreateDemoUser();
  const workspace = await db.createWorkspace({ userId: user.id, name: "Workflow SSRF test" });
  const workflow = await db.createWorkflow({
    workspaceId: workspace.id,
    name: "HTTP test workflow",
    definition: httpWorkflowDefinition(url),
  });
  return { workspace, workflow };
}

describe("workflow HTTP request node — trigger-aware gating", () => {
  it("runs a safe request for a manual trigger regardless of the automation-HTTP flag", async () => {
    process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP = "false";
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const { workspace, workflow } = await seedWorkflow("http://93.184.216.34/");

    const { run, nodes } = await runWorkflowAndWait(workflow.id, workspace.id, "manual");

    expect(run.status).toBe("completed");
    expect(nodes[0]?.status).toBe("completed");
  });

  it("blocks an automation-triggered run when ENABLE_WORKFLOW_AUTOMATION_HTTP is off", async () => {
    process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP = "false";
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const { workspace, workflow } = await seedWorkflow("http://93.184.216.34/");

    const { run, nodes } = await runWorkflowAndWait(workflow.id, workspace.id, "automation");

    expect(run.status).toBe("failed");
    expect(nodes[0]?.status).toBe("failed");
    expect(nodes[0]?.errorMessage).toMatch(/ENABLE_WORKFLOW_AUTOMATION_HTTP/);
    expect(fetchCalled).toBe(false);
  });

  it("allows an automation-triggered run once ENABLE_WORKFLOW_AUTOMATION_HTTP is on", async () => {
    process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP = "true";
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const { workspace, workflow } = await seedWorkflow("http://93.184.216.34/");

    const { run, nodes } = await runWorkflowAndWait(workflow.id, workspace.id, "automation");

    expect(run.status).toBe("completed");
    expect(nodes[0]?.status).toBe("completed");
  });

  it("still blocks a private-network target even when automation HTTP is enabled (SSRF stays enforced)", async () => {
    process.env.ENABLE_WORKFLOW_AUTOMATION_HTTP = "true";
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const { workspace, workflow } = await seedWorkflow("http://127.0.0.1:9999/internal");

    const { run, nodes } = await runWorkflowAndWait(workflow.id, workspace.id, "automation");

    expect(run.status).toBe("failed");
    expect(nodes[0]?.status).toBe("failed");
    expect(fetchCalled).toBe(false);
  });
});
