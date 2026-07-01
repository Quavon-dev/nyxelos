---
tags: [adr, agents, orchestration]
created: 2026-07-01
status: accepted
---

# ADR-0011: Super-Agents Delegate Only to an Explicit Whitelist, One Level Deep

## Context

ARCHITECTURE.md section 6 describes super-agents as orchestrators that "break a complex request into subtasks, assign each subtask to a specialized sub-agent or skill, collect the intermediate results, and merge them." This needed a concrete tool the model can call, plus a way to stop that from turning into an open-ended or cyclical delegation graph — two agents delegating to each other, or a chain many levels deep, either of which could spin unboundedly against real model API costs with no natural stopping point.

## Decision

`agent.delegateAgentIds` (`packages/db`) is an explicit list of other agent ids, set by the user when configuring a `super_agent`-level agent — there is no "delegate to any agent" option. `buildDelegateToAgentTool` (`apps/server/src/delegation.ts`) resolves that list against agents that actually still exist in the same workspace (and excludes the agent's own id, in case of a self-reference), and exposes a single `delegate_to_agent(agentId, task)` tool whose `agentId` parameter is a Zod enum over exactly that resolved whitelist — the model cannot pass an id that wasn't explicitly granted, satisfying the same "nothing should silently gain more permissions than the user allowed" principle already applied to skills and MCP servers.

Calling it runs the sub-agent headlessly — one full `streamChat` completion, its text result returned as the tool's output — with the sub-agent's own tools built via the same `buildToolsForAgent`, but with `allowDelegation: false` passed down. That flag is what keeps this a tree instead of a graph: a delegated sub-agent's own `buildToolsForAgent` call skips adding `delegate_to_agent` entirely, regardless of whether that sub-agent is itself configured as a `super_agent` with its own `delegateAgentIds`. Delegation is therefore always exactly one level deep from wherever it's triggered (a live chat or a scheduled automation) — no chains, no cycles.

## Consequences

A genuinely useful multi-level pipeline (super-agent A delegates to super-agent B, which further delegates to C) isn't possible yet — B's delegation ability is switched off the moment it's invoked as someone else's sub-agent, even if B is configured as a super-agent in its own right when used directly. That's an intentional, conservative first cut rather than an oversight: the alternative (allowing bounded-depth chains) needs a depth counter threaded through the run context and a decision about what a sane maximum is, which wasn't worth the complexity before there's a real use case exercising it. In the audit log, the `delegate_to_agent` call itself is logged under the *parent* agent's id (`actor: "delegate"`, `toolLabel: "delegate__<subAgentName>"`), while any tool calls the sub-agent makes during its own completion are logged under the *sub-agent's* id via the normal `buildToolsForAgent` path — so reconstructing a full delegated run means following both the parent's `delegate__*` entries and the named sub-agent's own entries around the same timestamp, rather than one flat entry per run.
