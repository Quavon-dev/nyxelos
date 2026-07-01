import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DEFAULT_CHAT_TOOL_POLICY } from "./types";
import { normalizeChatWorkingDirectory } from "../working-directory";
import * as schema from "../schema/sqlite";
import type { DbRepository } from "./types";

export function createSqliteRepository(filePath: string): DbRepository {
	const sqlite = new Database(filePath, { create: true });
	sqlite.exec("PRAGMA journal_mode = WAL;");
	sqlite.exec("PRAGMA foreign_keys = ON;");

	// Older local databases created before chat archiving/projects existed may
	// still be missing these columns. Add them in place so existing installs
	// keep working without forcing a manual reset.
	const chatTable = sqlite
		.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get("chat") as { name: string } | null;
	if (chatTable) {
		const chatColumns = sqlite.query("PRAGMA table_info(chat)").all() as {
			name: string;
		}[];
		const hasColumn = (name: string) =>
			chatColumns.some((column) => column.name === name);
		if (!hasColumn("archived_at")) {
			sqlite.exec("ALTER TABLE chat ADD COLUMN archived_at integer;");
		}
		if (!hasColumn("project_id")) {
			sqlite.exec(
				"ALTER TABLE chat ADD COLUMN project_id text REFERENCES project(id);",
			);
		}
		if (!hasColumn("pinned_at")) {
			sqlite.exec("ALTER TABLE chat ADD COLUMN pinned_at integer;");
		}
		if (!hasColumn("share_id")) {
			sqlite.exec("ALTER TABLE chat ADD COLUMN share_id text;");
			sqlite.exec(
				"CREATE UNIQUE INDEX IF NOT EXISTS chat_share_id_unique ON chat (share_id);",
			);
		}
		if (!hasColumn("shared_at")) {
			sqlite.exec("ALTER TABLE chat ADD COLUMN shared_at integer;");
		}
		if (!hasColumn("tool_mode")) {
			sqlite.exec(
				"ALTER TABLE chat ADD COLUMN tool_mode text NOT NULL DEFAULT 'default';",
			);
		}
		if (!hasColumn("tool_policy")) {
			sqlite.exec(
				'ALTER TABLE chat ADD COLUMN tool_policy text NOT NULL DEFAULT \'{"mode":"default","approveFileWrites":true,"approveFileDeletes":true,"approveCustomCode":true,"approveMcpTools":true}\';',
			);
		}
	}

	// Same idea for the project table itself on databases that predate it.
	sqlite.exec(
		"CREATE TABLE IF NOT EXISTS project (" +
			"id text PRIMARY KEY NOT NULL, " +
			"workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, " +
			"name text NOT NULL, " +
			"created_at integer NOT NULL" +
			");",
	);

	const db = drizzle(sqlite, { schema });

	function toWorkspaceRecord(row: typeof schema.workspace.$inferSelect) {
		return {
			id: row.id,
			userId: row.userId,
			name: row.name,
			customInstructions: row.customInstructions,
			icon: row.icon,
			color: row.color,
			defaultModelId: row.defaultModelId,
			defaultAutonomyLevel: row.defaultAutonomyLevel,
			defaultToolPolicy: row.defaultToolPolicy ?? DEFAULT_CHAT_TOOL_POLICY,
		};
	}

	function mapChat(row: typeof schema.chat.$inferSelect) {
		return {
			id: row.id,
			workspaceId: row.workspaceId,
			workingDirectory: normalizeChatWorkingDirectory(row.workingDirectory),
			agentId: row.agentId,
			projectId: row.projectId,
			title: row.title,
			modelId: row.modelId,
			archivedAt: row.archivedAt,
			pinnedAt: row.pinnedAt,
			shareId: row.shareId,
			sharedAt: row.sharedAt,
			toolMode: row.toolMode,
			toolPolicy: row.toolPolicy ?? DEFAULT_CHAT_TOOL_POLICY,
			createdAt: row.createdAt,
		};
	}

	function mapProject(row: typeof schema.project.$inferSelect) {
		return {
			id: row.id,
			workspaceId: row.workspaceId,
			name: row.name,
			color: row.color,
			icon: row.icon,
			createdAt: row.createdAt,
		};
	}

	function mapTask(row: typeof schema.task.$inferSelect) {
		return row;
	}

	function mapTaskEvent(row: typeof schema.taskEvent.$inferSelect) {
		return row;
	}

	function mapAgentRun(row: typeof schema.agentRun.$inferSelect) {
		return row;
	}

	return {
		driver: "sqlite",

		async getOrCreateDemoUser() {
			const existing = db
				.select()
				.from(schema.user)
				.where(eq(schema.user.email, "demo@nyxel.local"))
				.get();
			if (existing) return existing;

			const now = new Date();
			const row = db
				.insert(schema.user)
				.values({
					id: randomUUID(),
					name: "Demo User",
					email: "demo@nyxel.local",
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
			return row;
		},

		async getUser(userId) {
			const row = db
				.select()
				.from(schema.user)
				.where(eq(schema.user.id, userId))
				.get();
			if (!row) return null;
			return { id: row.id, name: row.name, email: row.email };
		},

		async getInstallation() {
			const row = db
				.select()
				.from(schema.installation)
				.where(eq(schema.installation.id, "main"))
				.get();
			return row ?? null;
		},

		async completeInstallation({
			mode,
			ownerUserId,
			primaryWorkspaceId,
			appUrl,
		}) {
			const now = new Date();
			const existing = db
				.select()
				.from(schema.installation)
				.where(eq(schema.installation.id, "main"))
				.get();

			if (existing) {
				const row = db
					.update(schema.installation)
					.set({
						mode,
						ownerUserId,
						primaryWorkspaceId,
						appUrl: appUrl ?? null,
						updatedAt: now,
					})
					.where(eq(schema.installation.id, "main"))
					.returning()
					.get();
				if (!row) throw new Error("Failed to update installation");
				return row;
			}

			const row = db
				.insert(schema.installation)
				.values({
					id: "main",
					mode,
					ownerUserId,
					primaryWorkspaceId,
					appUrl: appUrl ?? null,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
			return row;
		},

		async createWorkspace({ userId, name }) {
			const row = db
				.insert(schema.workspace)
				.values({ id: randomUUID(), userId, name, createdAt: new Date() })
				.returning()
				.get();
			return toWorkspaceRecord(row);
		},

		async listWorkspacesByUser(userId) {
			const rows = db
				.select()
				.from(schema.workspace)
				.where(eq(schema.workspace.userId, userId))
				.all();
			return rows.map(toWorkspaceRecord);
		},

		async listWorkspaces() {
			const rows = db.select().from(schema.workspace).all();
			return rows.map(toWorkspaceRecord);
		},

		async getWorkspace(workspaceId) {
			const row = db
				.select()
				.from(schema.workspace)
				.where(eq(schema.workspace.id, workspaceId))
				.get();
			if (!row) return null;
			return toWorkspaceRecord(row);
		},

		async updateWorkspaceSettings({ workspaceId, ...updates }) {
			const row = db
				.update(schema.workspace)
				.set(updates)
				.where(eq(schema.workspace.id, workspaceId))
				.returning()
				.get();
			if (!row) throw new Error(`Workspace not found: ${workspaceId}`);
			return toWorkspaceRecord(row);
		},

		async createModelInstallation({
			workspaceId,
			label,
			providerKind,
			baseUrl,
			apiKey,
			modelIds,
			disabledModelIds,
			enabled,
		}) {
			const now = new Date();
			const row = db
				.insert(schema.modelInstallation)
				.values({
					id: randomUUID(),
					workspaceId,
					label,
					providerKind,
					baseUrl,
					apiKey: apiKey ?? null,
					modelIds,
					disabledModelIds: disabledModelIds ?? [],
					enabled: enabled ?? true,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
			return row;
		},

		async listModelInstallationsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.modelInstallation)
				.where(eq(schema.modelInstallation.workspaceId, workspaceId))
				.all();
		},

		async getModelInstallation(id) {
			const row = db
				.select()
				.from(schema.modelInstallation)
				.where(eq(schema.modelInstallation.id, id))
				.get();
			return row ?? null;
		},

		async updateModelInstallation({ id, ...updates }) {
			const row = db
				.update(schema.modelInstallation)
				.set({ ...updates, updatedAt: new Date() })
				.where(eq(schema.modelInstallation.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Model installation not found: ${id}`);
			return row;
		},

		async deleteModelInstallation(id) {
			db.delete(schema.modelInstallation)
				.where(eq(schema.modelInstallation.id, id))
				.run();
		},

		async createPushSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
			const row = db
				.insert(schema.pushSubscription)
				.values({
					id: randomUUID(),
					userId,
					endpoint,
					p256dh,
					auth,
					userAgent: userAgent ?? null,
					createdAt: new Date(),
				})
				.onConflictDoUpdate({
					target: schema.pushSubscription.endpoint,
					set: { p256dh, auth, userAgent: userAgent ?? null },
				})
				.returning()
				.get();
			if (!row) throw new Error("Failed to create push subscription");
			return row;
		},

		async listPushSubscriptionsByUser(userId) {
			return db
				.select()
				.from(schema.pushSubscription)
				.where(eq(schema.pushSubscription.userId, userId))
				.all();
		},

		async deletePushSubscriptionByEndpoint(endpoint) {
			db.delete(schema.pushSubscription)
				.where(eq(schema.pushSubscription.endpoint, endpoint))
				.run();
		},

		async createChat({
			workspaceId,
			workingDirectory,
			title,
			modelId,
			agentId,
			projectId,
			toolMode,
			toolPolicy,
		}) {
			const row = db
				.insert(schema.chat)
				.values({
					id: randomUUID(),
					workspaceId,
					workingDirectory: normalizeChatWorkingDirectory(workingDirectory),
					title,
					modelId,
					agentId: agentId ?? null,
					projectId: projectId ?? null,
					toolMode: toolMode ?? DEFAULT_CHAT_TOOL_POLICY.mode,
					toolPolicy: toolPolicy ?? DEFAULT_CHAT_TOOL_POLICY,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return mapChat(row);
		},

		async listChatsByWorkspace(workspaceId) {
			const rows = db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.workspaceId, workspaceId),
						isNull(schema.chat.archivedAt),
					),
				)
				.all();
			return rows.map(mapChat);
		},

		async listArchivedChatsByWorkspace(workspaceId) {
			const rows = db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.workspaceId, workspaceId),
						isNotNull(schema.chat.archivedAt),
					),
				)
				.all();
			return rows.map(mapChat);
		},

		async listChatsByProject(projectId) {
			const rows = db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.projectId, projectId),
						isNull(schema.chat.archivedAt),
					),
				)
				.all();
			return rows.map(mapChat);
		},

		async getChat(chatId) {
			const row = db
				.select()
				.from(schema.chat)
				.where(eq(schema.chat.id, chatId))
				.get();
			return row ? mapChat(row) : null;
		},

		async getChatByShareId(shareId) {
			const row = db
				.select()
				.from(schema.chat)
				.where(eq(schema.chat.shareId, shareId))
				.get();
			return row ? mapChat(row) : null;
		},

		async renameChat(chatId, title) {
			const row = db
				.update(schema.chat)
				.set({ title })
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatArchived(chatId, archived) {
			const row = db
				.update(schema.chat)
				.set({ archivedAt: archived ? new Date() : null })
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatPinned(chatId, pinned) {
			const row = db
				.update(schema.chat)
				.set({ pinnedAt: pinned ? new Date() : null })
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatProject(chatId, projectId) {
			const row = db
				.update(schema.chat)
				.set({ projectId })
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatShared(chatId, shared) {
			const existing = db
				.select()
				.from(schema.chat)
				.where(eq(schema.chat.id, chatId))
				.get();
			if (!existing) throw new Error(`Chat not found: ${chatId}`);
			const row = db
				.update(schema.chat)
				.set(
					shared
						? {
								shareId: existing.shareId ?? randomUUID(),
								sharedAt: existing.sharedAt ?? new Date(),
							}
						: { shareId: null, sharedAt: null },
				)
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async duplicateChat(chatId) {
			const source = db
				.select()
				.from(schema.chat)
				.where(eq(schema.chat.id, chatId))
				.get();
			if (!source) throw new Error(`Chat not found: ${chatId}`);

			const now = new Date();
			const copy = db
				.insert(schema.chat)
				.values({
					id: randomUUID(),
					workspaceId: source.workspaceId,
					workingDirectory: normalizeChatWorkingDirectory(
						source.workingDirectory,
					),
					agentId: source.agentId,
					projectId: source.projectId,
					title: `${source.title} (copy)`,
					modelId: source.modelId,
					createdAt: now,
				})
				.returning()
				.get();

			const messages = db
				.select()
				.from(schema.message)
				.where(eq(schema.message.chatId, chatId))
				.all();
			for (const message of messages) {
				db.insert(schema.message)
					.values({
						id: randomUUID(),
						chatId: copy.id,
						role: message.role,
						content: message.content,
						createdAt: message.createdAt,
					})
					.run();
			}

			return mapChat(copy);
		},

		async deleteChat(chatId) {
			db.delete(schema.chat).where(eq(schema.chat.id, chatId)).run();
		},

		async updateChatAgent(chatId, agentId) {
			const row = db
				.update(schema.chat)
				.set({ agentId })
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async updateChatToolPolicy({ chatId, toolMode, toolPolicy }) {
			const row = db
				.update(schema.chat)
				.set({ toolMode, toolPolicy })
				.where(eq(schema.chat.id, chatId))
				.returning()
				.get();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async createProject({ workspaceId, name, color, icon }) {
			const row = db
				.insert(schema.project)
				.values({
					id: randomUUID(),
					workspaceId,
					name,
					...(color ? { color } : {}),
					...(icon ? { icon } : {}),
					createdAt: new Date(),
				})
				.returning()
				.get();
			return mapProject(row);
		},

		async listProjectsByWorkspace(workspaceId) {
			const rows = db
				.select()
				.from(schema.project)
				.where(eq(schema.project.workspaceId, workspaceId))
				.orderBy(desc(schema.project.createdAt))
				.all();
			return rows.map(mapProject);
		},

		async getProject(projectId) {
			const row = db
				.select()
				.from(schema.project)
				.where(eq(schema.project.id, projectId))
				.get();
			return row ? mapProject(row) : null;
		},

		async renameProject(projectId, name) {
			const row = db
				.update(schema.project)
				.set({ name })
				.where(eq(schema.project.id, projectId))
				.returning()
				.get();
			if (!row) throw new Error(`Project not found: ${projectId}`);
			return mapProject(row);
		},

		async setProjectAppearance(projectId, { color, icon }) {
			const row = db
				.update(schema.project)
				.set({ color, icon })
				.where(eq(schema.project.id, projectId))
				.returning()
				.get();
			if (!row) throw new Error(`Project not found: ${projectId}`);
			return mapProject(row);
		},

		async deleteProject(projectId) {
			// Same drizzle/sqlite/0009 gap as chat.agent_id above: chat.project_id
			// has no ON DELETE action in the real DB, so null it out manually.
			db.update(schema.chat)
				.set({ projectId: null })
				.where(eq(schema.chat.projectId, projectId))
				.run();
			db.delete(schema.project).where(eq(schema.project.id, projectId)).run();
		},

		async duplicateProject(projectId) {
			const source = db
				.select()
				.from(schema.project)
				.where(eq(schema.project.id, projectId))
				.get();
			if (!source) throw new Error(`Project not found: ${projectId}`);

			const copy = db
				.insert(schema.project)
				.values({
					id: randomUUID(),
					workspaceId: source.workspaceId,
					name: `${source.name} (copy)`,
					color: source.color,
					icon: source.icon,
					createdAt: new Date(),
				})
				.returning()
				.get();

			const chats = db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.projectId, projectId),
						isNull(schema.chat.archivedAt),
					),
				)
				.all();
			for (const sourceChat of chats) {
				const chatCopy = db
					.insert(schema.chat)
					.values({
						id: randomUUID(),
						workspaceId: sourceChat.workspaceId,
						workingDirectory: normalizeChatWorkingDirectory(
							sourceChat.workingDirectory,
						),
						agentId: sourceChat.agentId,
						projectId: copy.id,
						title: sourceChat.title,
						modelId: sourceChat.modelId,
						createdAt: new Date(),
					})
					.returning()
					.get();
				const messages = db
					.select()
					.from(schema.message)
					.where(eq(schema.message.chatId, sourceChat.id))
					.all();
				for (const message of messages) {
					db.insert(schema.message)
						.values({
							id: randomUUID(),
							chatId: chatCopy.id,
							role: message.role,
							content: message.content,
							createdAt: message.createdAt,
						})
						.run();
				}
			}

			return mapProject(copy);
		},

		async addMessage({ chatId, role, content }) {
			const row = db
				.insert(schema.message)
				.values({
					id: randomUUID(),
					chatId,
					role,
					content,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return {
				id: row.id,
				chatId: row.chatId,
				role: row.role,
				content: row.content,
				createdAt: row.createdAt,
			};
		},

		async listMessages(chatId) {
			const rows = db
				.select()
				.from(schema.message)
				.where(eq(schema.message.chatId, chatId))
				.orderBy(asc(schema.message.createdAt))
				.all();
			return rows.map((r) => ({
				id: r.id,
				chatId: r.chatId,
				role: r.role,
				content: r.content,
				createdAt: r.createdAt,
			}));
		},

		async updateMessage(id, content) {
			const row = db
				.update(schema.message)
				.set({ content })
				.where(eq(schema.message.id, id))
				.returning()
				.get();
			if (!row) throw new Error("Failed to update message");
			return {
				id: row.id,
				chatId: row.chatId,
				role: row.role,
				content: row.content,
				createdAt: row.createdAt,
			};
		},

		async deleteMessage(id) {
			db.delete(schema.message).where(eq(schema.message.id, id)).run();
		},

		async deleteMessagesAfter(chatId, messageId) {
			const rows = db
				.select()
				.from(schema.message)
				.where(eq(schema.message.chatId, chatId))
				.orderBy(asc(schema.message.createdAt))
				.all();
			const index = rows.findIndex((r) => r.id === messageId);
			if (index === -1) return;
			const idsToDelete = rows.slice(index + 1).map((r) => r.id);
			if (idsToDelete.length === 0) return;
			db.delete(schema.message).where(inArray(schema.message.id, idsToDelete)).run();
		},

		async createAgent({
			workspaceId,
			name,
			systemPrompt,
			role,
			goalTemplate,
			modelId,
			autonomyLevel,
			mcpServerIds,
			toolIds,
			skillIds,
			mcpToolFilter,
			delegateAgentIds,
		}) {
			const row = db
				.insert(schema.agent)
				.values({
					id: randomUUID(),
					workspaceId,
					name,
					systemPrompt: systemPrompt ?? null,
					role: role ?? null,
					goalTemplate: goalTemplate ?? null,
					modelId,
					autonomyLevel: autonomyLevel ?? "chat",
					mcpServerIds: mcpServerIds ?? [],
					toolIds: toolIds ?? [],
					skillIds: skillIds ?? [],
					mcpToolFilter: mcpToolFilter ?? null,
					delegateAgentIds: delegateAgentIds ?? [],
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listAgentsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.agent)
				.where(eq(schema.agent.workspaceId, workspaceId))
				.all();
		},

		async getAgent(agentId) {
			const row = db
				.select()
				.from(schema.agent)
				.where(eq(schema.agent.id, agentId))
				.get();
			return row ?? null;
		},

		async updateAgent(agentId, input) {
			const row = db
				.update(schema.agent)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.systemPrompt !== undefined
						? { systemPrompt: input.systemPrompt }
						: {}),
					...(input.role !== undefined ? { role: input.role } : {}),
					...(input.goalTemplate !== undefined
						? { goalTemplate: input.goalTemplate }
						: {}),
					...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
					...(input.autonomyLevel !== undefined
						? { autonomyLevel: input.autonomyLevel }
						: {}),
					...(input.mcpServerIds !== undefined
						? { mcpServerIds: input.mcpServerIds }
						: {}),
					...(input.toolIds !== undefined ? { toolIds: input.toolIds } : {}),
					...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
					...(input.mcpToolFilter !== undefined
						? { mcpToolFilter: input.mcpToolFilter }
						: {}),
					...(input.delegateAgentIds !== undefined
						? { delegateAgentIds: input.delegateAgentIds }
						: {}),
				})
				.where(eq(schema.agent.id, agentId))
				.returning()
				.get();
			if (!row) throw new Error(`Agent not found: ${agentId}`);
			return row;
		},

		async deleteAgent(agentId) {
			// chat.agent_id was added via a bare `ALTER TABLE ADD COLUMN
			// REFERENCES` (see drizzle/sqlite/0001_fat_rockslide.sql), which
			// SQLite defaults to ON DELETE NO ACTION — unlike the Postgres
			// migration, it was never given the "set null" behavior the
			// schema.ts declares. Null it out here so deleting an agent that's
			// still referenced by a chat doesn't hit a FOREIGN KEY constraint
			// failure.
			db.update(schema.chat)
				.set({ agentId: null })
				.where(eq(schema.chat.agentId, agentId))
				.run();
			db.delete(schema.agent).where(eq(schema.agent.id, agentId)).run();
		},

		async deleteUnusedChatAgents(workspaceId) {
			const usedAgentIds = new Set(
				db
					.select({ agentId: schema.chat.agentId })
					.from(schema.chat)
					.where(eq(schema.chat.workspaceId, workspaceId))
					.all()
					.map((row) => row.agentId)
					.filter((id): id is string => id !== null),
			);
			const candidates = db
				.select({ id: schema.agent.id })
				.from(schema.agent)
				.where(
					and(
						eq(schema.agent.workspaceId, workspaceId),
						eq(schema.agent.name, "Chat — custom tools"),
					),
				)
				.all();
			const idsToDelete = candidates
				.map((row) => row.id)
				.filter((id) => !usedAgentIds.has(id));
			if (idsToDelete.length === 0) return 0;
			db.delete(schema.agent).where(inArray(schema.agent.id, idsToDelete)).run();
			return idsToDelete.length;
		},

		async createTask({
			workspaceId,
			parentTaskId,
			sourceChatId,
			createdByAgentId,
			assignedAgentId,
			title,
			instruction,
			modelId,
			status,
			priority,
			requiresApproval,
			input,
			plan,
			handoff,
			resultSummary,
			errorMessage,
			startedAt,
			completedAt,
		}) {
			const now = new Date();
			const row = db
				.insert(schema.task)
				.values({
					id: randomUUID(),
					workspaceId,
					parentTaskId: parentTaskId ?? null,
					sourceChatId: sourceChatId ?? null,
					createdByAgentId: createdByAgentId ?? null,
					assignedAgentId: assignedAgentId ?? null,
					title,
					instruction,
					modelId: modelId ?? null,
					status: status ?? "pending",
					priority: priority ?? "normal",
					requiresApproval: requiresApproval ?? false,
					input: input ?? {},
					plan: plan ?? null,
					handoff: handoff ?? null,
					resultSummary: resultSummary ?? null,
					errorMessage: errorMessage ?? null,
					createdAt: now,
					startedAt: startedAt ?? null,
					completedAt: completedAt ?? null,
					updatedAt: now,
				})
				.returning()
				.get();
			return mapTask(row);
		},

		async listTasksByWorkspace(workspaceId, input) {
			const conditions = [eq(schema.task.workspaceId, workspaceId)];
			if (input?.status) conditions.push(eq(schema.task.status, input.status));
			if (input?.assignedAgentId !== undefined) {
				conditions.push(
					input.assignedAgentId === null
						? isNull(schema.task.assignedAgentId)
						: eq(schema.task.assignedAgentId, input.assignedAgentId),
				);
			}
			const rows = db
				.select()
				.from(schema.task)
				.where(and(...conditions))
				.orderBy(desc(schema.task.createdAt))
				.all();
			return rows.map(mapTask);
		},

		async getTask(taskId) {
			const row = db
				.select()
				.from(schema.task)
				.where(eq(schema.task.id, taskId))
				.get();
			return row ? mapTask(row) : null;
		},

		async listTaskTree(parentTaskId) {
			const rows = db
				.select()
				.from(schema.task)
				.where(eq(schema.task.parentTaskId, parentTaskId))
				.orderBy(schema.task.createdAt)
				.all();
			return rows.map(mapTask);
		},

		async updateTask(taskId, input) {
			const row = db
				.update(schema.task)
				.set({
					...(input.assignedAgentId !== undefined
						? { assignedAgentId: input.assignedAgentId }
						: {}),
					...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
					...(input.status !== undefined ? { status: input.status } : {}),
					...(input.priority !== undefined ? { priority: input.priority } : {}),
					...(input.requiresApproval !== undefined
						? { requiresApproval: input.requiresApproval }
						: {}),
					...(input.plan !== undefined ? { plan: input.plan } : {}),
					...(input.handoff !== undefined ? { handoff: input.handoff } : {}),
					...(input.resultSummary !== undefined
						? { resultSummary: input.resultSummary }
						: {}),
					...(input.errorMessage !== undefined
						? { errorMessage: input.errorMessage }
						: {}),
					...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
					...(input.completedAt !== undefined
						? { completedAt: input.completedAt }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(schema.task.id, taskId))
				.returning()
				.get();
			if (!row) throw new Error(`Task not found: ${taskId}`);
			return mapTask(row);
		},

		async claimNextTaskForAgent(workspaceId, agentId) {
			const row = db
				.select()
				.from(schema.task)
				.where(
					and(
						eq(schema.task.workspaceId, workspaceId),
						eq(schema.task.assignedAgentId, agentId),
						isNull(schema.task.startedAt),
						or(
							eq(schema.task.status, "pending"),
							eq(schema.task.status, "ready"),
						),
					),
				)
				.orderBy(desc(schema.task.createdAt))
				.get();
			if (!row) return null;
			return this.updateTask(row.id, { status: "running", startedAt: new Date() });
		},

		async createTaskEvent({
			taskId,
			workspaceId,
			agentRunId,
			agentId,
			kind,
			message,
			payload,
		}) {
			const row = db
				.insert(schema.taskEvent)
				.values({
					id: randomUUID(),
					taskId,
					workspaceId,
					agentRunId: agentRunId ?? null,
					agentId: agentId ?? null,
					kind,
					message,
					payload: payload ?? null,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return mapTaskEvent(row);
		},

		async listTaskEvents(taskId) {
			const rows = db
				.select()
				.from(schema.taskEvent)
				.where(eq(schema.taskEvent.taskId, taskId))
				.orderBy(schema.taskEvent.createdAt)
				.all();
			return rows.map(mapTaskEvent);
		},

		async createAgentRun({
			workspaceId,
			taskId,
			agentId,
			chatId,
			automationId,
			trigger,
			modelId,
			stepCount,
			status,
			finalOutput,
			errorMessage,
			startedAt,
			completedAt,
		}) {
			const now = new Date();
			const row = db
				.insert(schema.agentRun)
				.values({
					id: randomUUID(),
					workspaceId,
					taskId: taskId ?? null,
					agentId,
					chatId: chatId ?? null,
					automationId: automationId ?? null,
					trigger,
					modelId: modelId ?? null,
					stepCount: stepCount ?? 0,
					status: status ?? "pending",
					finalOutput: finalOutput ?? null,
					errorMessage: errorMessage ?? null,
					createdAt: now,
					startedAt: startedAt ?? null,
					completedAt: completedAt ?? null,
					updatedAt: now,
				})
				.returning()
				.get();
			return mapAgentRun(row);
		},

		async getAgentRun(id) {
			const row = db
				.select()
				.from(schema.agentRun)
				.where(eq(schema.agentRun.id, id))
				.get();
			return row ? mapAgentRun(row) : null;
		},

		async listAgentRunsByTask(taskId) {
			const rows = db
				.select()
				.from(schema.agentRun)
				.where(eq(schema.agentRun.taskId, taskId))
				.orderBy(schema.agentRun.createdAt)
				.all();
			return rows.map(mapAgentRun);
		},

		async listAgentRunsByAgent(agentId) {
			const rows = db
				.select()
				.from(schema.agentRun)
				.where(eq(schema.agentRun.agentId, agentId))
				.orderBy(desc(schema.agentRun.createdAt))
				.all();
			return rows.map(mapAgentRun);
		},

		async listActiveAgentRunsByWorkspace(workspaceId) {
			const rows = db
				.select()
				.from(schema.agentRun)
				.where(
					and(
						eq(schema.agentRun.workspaceId, workspaceId),
						inArray(schema.agentRun.status, [
							"pending",
							"running",
							"waiting_approval",
						]),
					),
				)
				.orderBy(desc(schema.agentRun.createdAt))
				.all();
			return rows.map(mapAgentRun);
		},

		async updateAgentRun(id, input) {
			const row = db
				.update(schema.agentRun)
				.set({
					...(input.stepCount !== undefined ? { stepCount: input.stepCount } : {}),
					...(input.status !== undefined ? { status: input.status } : {}),
					...(input.finalOutput !== undefined
						? { finalOutput: input.finalOutput }
						: {}),
					...(input.errorMessage !== undefined
						? { errorMessage: input.errorMessage }
						: {}),
					...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
					...(input.completedAt !== undefined
						? { completedAt: input.completedAt }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(schema.agentRun.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Agent run not found: ${id}`);
			return mapAgentRun(row);
		},

		async createMcpServer({
			workspaceId,
			name,
			transport,
			command,
			args,
			url,
			env,
		}) {
			const row = db
				.insert(schema.mcpServer)
				.values({
					id: randomUUID(),
					workspaceId,
					name,
					transport,
					command: command ?? null,
					args: args ?? null,
					url: url ?? null,
					env: env ?? null,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listMcpServersByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.mcpServer)
				.where(eq(schema.mcpServer.workspaceId, workspaceId))
				.all();
		},

		async getMcpServer(id) {
			const row = db
				.select()
				.from(schema.mcpServer)
				.where(eq(schema.mcpServer.id, id))
				.get();
			return row ?? null;
		},

		async deleteMcpServer(id) {
			db.delete(schema.mcpServer).where(eq(schema.mcpServer.id, id)).run();
		},

		async updateMcpServerOAuthState(id, oauthState) {
			db.update(schema.mcpServer)
				.set({ oauthState })
				.where(eq(schema.mcpServer.id, id))
				.run();
		},

		async getKnowledgeBaseConfig(workspaceId) {
			const row = db
				.select()
				.from(schema.knowledgeBaseConfig)
				.where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
				.get();
			return row ?? null;
		},

		async listKnowledgeBaseConfigs() {
			return db.select().from(schema.knowledgeBaseConfig).all();
		},

		async upsertKnowledgeBaseConfig({
			workspaceId,
			vaultPath,
			obsidianRestUrl,
			obsidianApiKey,
			docsAgentEnabled,
			injectIntoPrompts,
		}) {
			const now = new Date();
			const existing = db
				.select()
				.from(schema.knowledgeBaseConfig)
				.where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
				.get();
			if (existing) {
				const row = db
					.update(schema.knowledgeBaseConfig)
					.set({
						vaultPath,
						obsidianRestUrl: obsidianRestUrl ?? null,
						obsidianApiKey: obsidianApiKey ?? null,
						docsAgentEnabled: docsAgentEnabled ?? existing.docsAgentEnabled,
						injectIntoPrompts: injectIntoPrompts ?? existing.injectIntoPrompts,
						updatedAt: now,
					})
					.where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
					.returning()
					.get();
				if (!row)
					throw new Error(`Knowledge base config not found: ${workspaceId}`);
				return row;
			}

			const row = db
				.insert(schema.knowledgeBaseConfig)
				.values({
					workspaceId,
					vaultPath,
					obsidianRestUrl: obsidianRestUrl ?? null,
					obsidianApiKey: obsidianApiKey ?? null,
					docsAgentEnabled: docsAgentEnabled ?? true,
					injectIntoPrompts: injectIntoPrompts ?? true,
					updatedAt: now,
				})
				.returning()
				.get();
			return row;
		},

		async updateKnowledgeBaseSyncStatus({
			workspaceId,
			lastDocsSyncAt,
			lastDocsSyncError,
		}) {
			const row = db
				.update(schema.knowledgeBaseConfig)
				.set({
					lastDocsSyncAt,
					lastDocsSyncError: lastDocsSyncError ?? null,
					updatedAt: new Date(),
				})
				.where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
				.returning()
				.get();
			if (!row)
				throw new Error(`Knowledge base config not found: ${workspaceId}`);
			return row;
		},

		async createAutomation({
			workspaceId,
			agentId,
			name,
			triggerType,
			cronExpression,
			watchPath,
			watchGlob,
			prompt,
			enabled,
			nextRunAt,
		}) {
			const row = db
				.insert(schema.automation)
				.values({
					id: randomUUID(),
					workspaceId,
					agentId,
					name,
					triggerType: triggerType ?? "cron",
					cronExpression: cronExpression ?? "",
					watchPath: watchPath ?? null,
					watchGlob: watchGlob ?? null,
					prompt,
					enabled: enabled ?? true,
					nextRunAt: nextRunAt ?? null,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listAutomationsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.automation)
				.where(eq(schema.automation.workspaceId, workspaceId))
				.all();
		},

		async listDueAutomations(now) {
			return db
				.select()
				.from(schema.automation)
				.where(
					and(
						eq(schema.automation.enabled, true),
						lte(schema.automation.nextRunAt, now),
					),
				)
				.all();
		},

		async listFileWatchAutomations() {
			return db
				.select()
				.from(schema.automation)
				.where(
					and(
						eq(schema.automation.enabled, true),
						eq(schema.automation.triggerType, "file_watch"),
					),
				)
				.all();
		},

		async getAutomation(id) {
			const row = db
				.select()
				.from(schema.automation)
				.where(eq(schema.automation.id, id))
				.get();
			return row ?? null;
		},

		async updateAutomationRun({
			id,
			lastRunAt,
			nextRunAt,
			lastRunStatus,
			lastErrorMessage,
		}) {
			const row = db
				.update(schema.automation)
				.set({
					lastRunAt,
					nextRunAt,
					...(lastRunStatus !== undefined ? { lastRunStatus } : {}),
					...(lastErrorMessage !== undefined ? { lastErrorMessage } : {}),
				})
				.where(eq(schema.automation.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async setAutomationNextRun(id, nextRunAt) {
			const row = db
				.update(schema.automation)
				.set({ nextRunAt })
				.where(eq(schema.automation.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async setAutomationEnabled(id, enabled) {
			const row = db
				.update(schema.automation)
				.set({ enabled })
				.where(eq(schema.automation.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async setAutomationWatchCheckedAt(id, lastWatchCheckAt) {
			const row = db
				.update(schema.automation)
				.set({ lastWatchCheckAt })
				.where(eq(schema.automation.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async updateAutomation(id, patch) {
			const row = db
				.update(schema.automation)
				.set(patch)
				.where(eq(schema.automation.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async deleteAutomation(id) {
			db.delete(schema.automation).where(eq(schema.automation.id, id)).run();
		},

		async createTool({
			workspaceId,
			name,
			description,
			kind,
			config,
			sensitive,
			enabled,
			builtin,
		}) {
			const row = db
				.insert(schema.tool)
				.values({
					id: randomUUID(),
					workspaceId,
					name,
					description,
					kind,
					config,
					sensitive: sensitive ?? true,
					enabled: enabled ?? true,
					builtin: builtin ?? false,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listToolsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.tool)
				.where(eq(schema.tool.workspaceId, workspaceId))
				.all();
		},

		async getTool(id) {
			const row = db
				.select()
				.from(schema.tool)
				.where(eq(schema.tool.id, id))
				.get();
			return row ?? null;
		},

		async setToolEnabled(id, enabled) {
			const row = db
				.update(schema.tool)
				.set({ enabled })
				.where(eq(schema.tool.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Tool not found: ${id}`);
			return row;
		},

		async deleteTool(id) {
			const row = db
				.select()
				.from(schema.tool)
				.where(eq(schema.tool.id, id))
				.get();
			if (row?.builtin) {
				throw new Error(`Tool "${row.name}" is built-in and can't be deleted.`);
			}
			db.delete(schema.tool).where(eq(schema.tool.id, id)).run();
		},

		async createApprovalRequest({
			workspaceId,
			agentId,
			chatId,
			automationId,
			taskId,
			agentRunId,
			kind,
			skillId,
			toolId,
			mcpServerId,
			mcpToolName,
			toolLabel,
			input,
		}) {
			const row = db
				.insert(schema.approvalRequest)
				.values({
					id: randomUUID(),
					workspaceId,
					agentId,
					chatId: chatId ?? null,
					automationId: automationId ?? null,
					taskId: taskId ?? null,
					agentRunId: agentRunId ?? null,
					kind,
					skillId: skillId ?? null,
					toolId: toolId ?? null,
					mcpServerId: mcpServerId ?? null,
					mcpToolName: mcpToolName ?? null,
					toolLabel,
					input,
					status: "pending",
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listApprovalsByWorkspace(workspaceId, status) {
			const condition = status
				? and(
						eq(schema.approvalRequest.workspaceId, workspaceId),
						eq(schema.approvalRequest.status, status),
					)
				: eq(schema.approvalRequest.workspaceId, workspaceId);
			return db
				.select()
				.from(schema.approvalRequest)
				.where(condition)
				.orderBy(desc(schema.approvalRequest.createdAt))
				.all();
		},

		async getApprovalRequest(id) {
			const row = db
				.select()
				.from(schema.approvalRequest)
				.where(eq(schema.approvalRequest.id, id))
				.get();
			return row ?? null;
		},

		async resolveApprovalRequest({ id, status, resultOutput, errorMessage }) {
			const row = db
				.update(schema.approvalRequest)
				.set({
					status,
					resultOutput,
					errorMessage: errorMessage ?? null,
					resolvedAt: new Date(),
				})
				.where(eq(schema.approvalRequest.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Approval request not found: ${id}`);
			return row;
		},

		async createAuditLog({
			workspaceId,
			agentId,
			chatId,
			automationId,
			actor,
			toolLabel,
			input,
			output,
			status,
		}) {
			const row = db
				.insert(schema.auditLog)
				.values({
					id: randomUUID(),
					workspaceId,
					agentId: agentId ?? null,
					chatId: chatId ?? null,
					automationId: automationId ?? null,
					actor,
					toolLabel,
					input: input ?? null,
					output: output ?? null,
					status,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listAuditLogByWorkspace(workspaceId, limit = 100) {
			return db
				.select()
				.from(schema.auditLog)
				.where(eq(schema.auditLog.workspaceId, workspaceId))
				.orderBy(desc(schema.auditLog.createdAt))
				.limit(limit)
				.all();
		},

		async installExtension({ workspaceId, key, config }) {
			const row = db
				.insert(schema.extension)
				.values({
					id: randomUUID(),
					workspaceId,
					key,
					config: config ?? {},
					installedAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listExtensionsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.extension)
				.where(eq(schema.extension.workspaceId, workspaceId))
				.all();
		},

		async getExtension(id) {
			const row = db
				.select()
				.from(schema.extension)
				.where(eq(schema.extension.id, id))
				.get();
			return row ?? null;
		},

		async getExtensionByKey(workspaceId, key) {
			const row = db
				.select()
				.from(schema.extension)
				.where(
					and(
						eq(schema.extension.workspaceId, workspaceId),
						eq(schema.extension.key, key),
					),
				)
				.get();
			return row ?? null;
		},

		async setExtensionEnabled(id, enabled) {
			const row = db
				.update(schema.extension)
				.set({ enabled })
				.where(eq(schema.extension.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Extension not found: ${id}`);
			return row;
		},

		async updateExtensionConfig(id, config) {
			const row = db
				.update(schema.extension)
				.set({ config })
				.where(eq(schema.extension.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`Extension not found: ${id}`);
			return row;
		},

		async uninstallExtension(id) {
			db.delete(schema.extension).where(eq(schema.extension.id, id)).run();
		},

		async createSeoProject({ workspaceId, extensionId, domain, repoPath }) {
			const now = new Date();
			const row = db
				.insert(schema.seoProject)
				.values({
					id: randomUUID(),
					workspaceId,
					extensionId,
					domain,
					repoPath,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
			return row;
		},

		async listSeoProjectsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.seoProject)
				.where(eq(schema.seoProject.workspaceId, workspaceId))
				.all();
		},

		async getSeoProject(id) {
			const row = db
				.select()
				.from(schema.seoProject)
				.where(eq(schema.seoProject.id, id))
				.get();
			return row ?? null;
		},

		async updateSeoProject(id, patch) {
			const row = db
				.update(schema.seoProject)
				.set({
					...(patch.domain !== undefined ? { domain: patch.domain } : {}),
					...(patch.repoPath !== undefined ? { repoPath: patch.repoPath } : {}),
					...(patch.blogConfig !== undefined
						? { blogConfig: patch.blogConfig }
						: {}),
					...(patch.fixerAgentId !== undefined
						? { fixerAgentId: patch.fixerAgentId }
						: {}),
					...(patch.reanalyzeCronExpression !== undefined
						? { reanalyzeCronExpression: patch.reanalyzeCronExpression }
						: {}),
					...(patch.nextReanalyzeAt !== undefined
						? { nextReanalyzeAt: patch.nextReanalyzeAt }
						: {}),
					...(patch.lastReanalyzeAt !== undefined
						? { lastReanalyzeAt: patch.lastReanalyzeAt }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(schema.seoProject.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`SEO project not found: ${id}`);
			return row;
		},

		async listDueSeoProjects(now) {
			return db
				.select()
				.from(schema.seoProject)
				.where(
					and(
						isNotNull(schema.seoProject.reanalyzeCronExpression),
						lte(schema.seoProject.nextReanalyzeAt, now),
					),
				)
				.all();
		},

		async deleteSeoProject(id) {
			db.delete(schema.seoProject).where(eq(schema.seoProject.id, id)).run();
		},

		async createSeoAnalysisRun({ seoProjectId, workspaceId }) {
			const row = db
				.insert(schema.seoAnalysisRun)
				.values({
					id: randomUUID(),
					seoProjectId,
					workspaceId,
					startedAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async getSeoAnalysisRun(id) {
			const row = db
				.select()
				.from(schema.seoAnalysisRun)
				.where(eq(schema.seoAnalysisRun.id, id))
				.get();
			return row ?? null;
		},

		async listSeoAnalysisRunsByProject(seoProjectId) {
			return db
				.select()
				.from(schema.seoAnalysisRun)
				.where(eq(schema.seoAnalysisRun.seoProjectId, seoProjectId))
				.orderBy(desc(schema.seoAnalysisRun.startedAt))
				.all();
		},

		async updateSeoAnalysisRun(id, patch) {
			const row = db
				.update(schema.seoAnalysisRun)
				.set({
					...(patch.status !== undefined ? { status: patch.status } : {}),
					...(patch.score !== undefined ? { score: patch.score } : {}),
					...(patch.pagesScanned !== undefined
						? { pagesScanned: patch.pagesScanned }
						: {}),
					...(patch.summary !== undefined ? { summary: patch.summary } : {}),
					...(patch.errorMessage !== undefined
						? { errorMessage: patch.errorMessage }
						: {}),
					...(patch.completedAt !== undefined
						? { completedAt: patch.completedAt }
						: {}),
				})
				.where(eq(schema.seoAnalysisRun.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`SEO analysis run not found: ${id}`);
			return row;
		},

		async createSeoFinding({
			runId,
			seoProjectId,
			category,
			severity,
			title,
			description,
			recommendation,
			location,
		}) {
			const row = db
				.insert(schema.seoFinding)
				.values({
					id: randomUUID(),
					runId,
					seoProjectId,
					category,
					severity,
					title,
					description,
					recommendation,
					location: location ?? null,
					createdAt: new Date(),
				})
				.returning()
				.get();
			return row;
		},

		async listSeoFindingsByRun(runId) {
			return db
				.select()
				.from(schema.seoFinding)
				.where(eq(schema.seoFinding.runId, runId))
				.all();
		},

		async listOpenSeoFindingsByProject(seoProjectId) {
			return db
				.select()
				.from(schema.seoFinding)
				.where(
					and(
						eq(schema.seoFinding.seoProjectId, seoProjectId),
						eq(schema.seoFinding.resolved, false),
					),
				)
				.orderBy(desc(schema.seoFinding.createdAt))
				.all();
		},

		async getSeoFinding(id) {
			const row = db
				.select()
				.from(schema.seoFinding)
				.where(eq(schema.seoFinding.id, id))
				.get();
			return row ?? null;
		},

		async setSeoFindingResolved(id, resolved) {
			const row = db
				.update(schema.seoFinding)
				.set({ resolved })
				.where(eq(schema.seoFinding.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`SEO finding not found: ${id}`);
			return row;
		},

		async createSeoBlogPost({ seoProjectId, workspaceId, keyword }) {
			const now = new Date();
			const row = db
				.insert(schema.seoBlogPost)
				.values({
					id: randomUUID(),
					seoProjectId,
					workspaceId,
					keyword,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
			return row;
		},

		async listSeoBlogPostsByProject(seoProjectId) {
			return db
				.select()
				.from(schema.seoBlogPost)
				.where(eq(schema.seoBlogPost.seoProjectId, seoProjectId))
				.orderBy(desc(schema.seoBlogPost.createdAt))
				.all();
		},

		async getSeoBlogPost(id) {
			const row = db
				.select()
				.from(schema.seoBlogPost)
				.where(eq(schema.seoBlogPost.id, id))
				.get();
			return row ?? null;
		},

		async updateSeoBlogPost(id, patch) {
			const row = db
				.update(schema.seoBlogPost)
				.set({
					...(patch.title !== undefined ? { title: patch.title } : {}),
					...(patch.filePath !== undefined ? { filePath: patch.filePath } : {}),
					...(patch.status !== undefined ? { status: patch.status } : {}),
					...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
					...(patch.errorMessage !== undefined
						? { errorMessage: patch.errorMessage }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(schema.seoBlogPost.id, id))
				.returning()
				.get();
			if (!row) throw new Error(`SEO blog post not found: ${id}`);
			return row;
		},
	};
}
