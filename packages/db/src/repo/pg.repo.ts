import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEFAULT_CHAT_TOOL_POLICY } from "./types";
import { normalizeChatWorkingDirectory } from "../working-directory";
import * as schema from "../schema/pg";
import type { DbRepository } from "./types";

export function createPgRepository(connectionString: string): DbRepository {
	const client = postgres(connectionString);
	const db = drizzle(client, { schema });

	async function findUnusedChatAgentIds(workspaceId: string) {
		const usedAgentIds = new Set(
			(
				await db
					.select({ agentId: schema.chat.agentId })
					.from(schema.chat)
					.where(eq(schema.chat.workspaceId, workspaceId))
			)
				.map((row) => row.agentId)
				.filter((id): id is string => id !== null),
		);
		const candidates = await db
			.select({ id: schema.agent.id })
			.from(schema.agent)
			.where(
				and(
					eq(schema.agent.workspaceId, workspaceId),
					eq(schema.agent.name, "Chat — custom tools"),
				),
			);
		return candidates.map((row) => row.id).filter((id) => !usedAgentIds.has(id));
	}

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

	function mapMessage(row: typeof schema.message.$inferSelect) {
		return {
			id: row.id,
			chatId: row.chatId,
			role: row.role,
			content: row.content,
			modelId: row.modelId,
			inputTokens: row.inputTokens,
			outputTokens: row.outputTokens,
			reasoningTokens: row.reasoningTokens,
			cacheReadTokens: row.cacheReadTokens,
			totalTokens: row.totalTokens,
			costMicros: row.costMicros,
			durationMs: row.durationMs,
			thinkingMs: row.thinkingMs,
			lineCount: row.lineCount,
			codeLineCount: row.codeLineCount,
			codeBlockCount: row.codeBlockCount,
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
		driver: "pg",

		async getOrCreateDemoUser() {
			const existing = await db.query.user.findFirst({
				where: eq(schema.user.email, "demo@nyxel.local"),
			});
			if (existing) return existing;

			const [created] = await db
				.insert(schema.user)
				.values({
					id: randomUUID(),
					name: "Demo User",
					email: "demo@nyxel.local",
				})
				.returning();
			if (!created) throw new Error("Failed to create demo user");
			return created;
		},

		async getUser(userId) {
			const row = await db.query.user.findFirst({
				where: eq(schema.user.id, userId),
			});
			if (!row) return null;
			return { id: row.id, name: row.name, email: row.email };
		},

		async getInstallation() {
			const row = await db.query.installation.findFirst({
				where: eq(schema.installation.id, "main"),
			});
			return row ?? null;
		},

		async completeInstallation({
			mode,
			ownerUserId,
			primaryWorkspaceId,
			appUrl,
		}) {
			const existing = await db.query.installation.findFirst({
				where: eq(schema.installation.id, "main"),
			});
			if (existing) {
				const [row] = await db
					.update(schema.installation)
					.set({
						mode,
						ownerUserId,
						primaryWorkspaceId,
						appUrl: appUrl ?? null,
						updatedAt: new Date(),
					})
					.where(eq(schema.installation.id, "main"))
					.returning();
				if (!row) throw new Error("Failed to update installation");
				return row;
			}

			const [row] = await db
				.insert(schema.installation)
				.values({
					id: "main",
					mode,
					ownerUserId,
					primaryWorkspaceId,
					appUrl: appUrl ?? null,
				})
				.returning();
			if (!row) throw new Error("Failed to create installation");
			return row;
		},

		async createWorkspace({ userId, name }) {
			const [row] = await db
				.insert(schema.workspace)
				.values({ id: randomUUID(), userId, name })
				.returning();
			if (!row) throw new Error("Failed to create workspace");
			return toWorkspaceRecord(row);
		},

		async listWorkspacesByUser(userId) {
			const rows = await db
				.select()
				.from(schema.workspace)
				.where(eq(schema.workspace.userId, userId));
			return rows.map(toWorkspaceRecord);
		},

		async listWorkspaces() {
			const rows = await db.select().from(schema.workspace);
			return rows.map(toWorkspaceRecord);
		},

		async getWorkspace(workspaceId) {
			const row = await db.query.workspace.findFirst({
				where: eq(schema.workspace.id, workspaceId),
			});
			if (!row) return null;
			return toWorkspaceRecord(row);
		},

		async updateWorkspaceSettings({ workspaceId, ...updates }) {
			const [row] = await db
				.update(schema.workspace)
				.set(updates)
				.where(eq(schema.workspace.id, workspaceId))
				.returning();
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
			const [row] = await db
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
					updatedAt: new Date(),
				})
				.returning();
			if (!row) throw new Error("Failed to create model installation");
			return row;
		},

		async listModelInstallationsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.modelInstallation)
				.where(eq(schema.modelInstallation.workspaceId, workspaceId));
		},

		async getModelInstallation(id) {
			const row = await db.query.modelInstallation.findFirst({
				where: eq(schema.modelInstallation.id, id),
			});
			return row ?? null;
		},

		async updateModelInstallation({ id, ...updates }) {
			const [row] = await db
				.update(schema.modelInstallation)
				.set({ ...updates, updatedAt: new Date() })
				.where(eq(schema.modelInstallation.id, id))
				.returning();
			if (!row) throw new Error(`Model installation not found: ${id}`);
			return row;
		},

		async deleteModelInstallation(id) {
			await db
				.delete(schema.modelInstallation)
				.where(eq(schema.modelInstallation.id, id));
		},

		async getModelParameter(workspaceId, modelId) {
			const row = await db.query.modelParameter.findFirst({
				where: and(
					eq(schema.modelParameter.workspaceId, workspaceId),
					eq(schema.modelParameter.modelId, modelId),
				),
			});
			return row ?? null;
		},

		async upsertModelParameter({
			workspaceId,
			modelId,
			customName,
			customInstructions,
			maxOutputTokens,
			temperature,
			topP,
			frequencyPenalty,
			presencePenalty,
			stopSequences,
			reasoningEffort,
		}) {
			const now = new Date();
			const values = {
				customName: customName ?? null,
				customInstructions: customInstructions ?? null,
				maxOutputTokens: maxOutputTokens ?? null,
				temperature: temperature ?? null,
				topP: topP ?? null,
				frequencyPenalty: frequencyPenalty ?? null,
				presencePenalty: presencePenalty ?? null,
				stopSequences: stopSequences ?? [],
				reasoningEffort: reasoningEffort ?? null,
			};
			const [row] = await db
				.insert(schema.modelParameter)
				.values({
					id: randomUUID(),
					workspaceId,
					modelId,
					...values,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [schema.modelParameter.workspaceId, schema.modelParameter.modelId],
					set: { ...values, updatedAt: now },
				})
				.returning();
			if (!row) throw new Error("Failed to save model parameters");
			return row;
		},

		async deleteModelParameter(workspaceId, modelId) {
			await db
				.delete(schema.modelParameter)
				.where(
					and(
						eq(schema.modelParameter.workspaceId, workspaceId),
						eq(schema.modelParameter.modelId, modelId),
					),
				);
		},

		async createPushSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
			const [row] = await db
				.insert(schema.pushSubscription)
				.values({
					id: randomUUID(),
					userId,
					endpoint,
					p256dh,
					auth,
					userAgent: userAgent ?? null,
				})
				.onConflictDoUpdate({
					target: schema.pushSubscription.endpoint,
					set: { p256dh, auth, userAgent: userAgent ?? null },
				})
				.returning();
			if (!row) throw new Error("Failed to create push subscription");
			return row;
		},

		async listPushSubscriptionsByUser(userId) {
			return db
				.select()
				.from(schema.pushSubscription)
				.where(eq(schema.pushSubscription.userId, userId));
		},

		async deletePushSubscriptionByEndpoint(endpoint) {
			await db
				.delete(schema.pushSubscription)
				.where(eq(schema.pushSubscription.endpoint, endpoint));
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create chat");
			return mapChat(row);
		},

		async listChatsByWorkspace(workspaceId) {
			const rows = await db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.workspaceId, workspaceId),
						isNull(schema.chat.archivedAt),
					),
				);
			return rows.map(mapChat);
		},

		async listArchivedChatsByWorkspace(workspaceId) {
			const rows = await db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.workspaceId, workspaceId),
						isNotNull(schema.chat.archivedAt),
					),
				);
			return rows.map(mapChat);
		},

		async listChatsByProject(projectId) {
			const rows = await db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.projectId, projectId),
						isNull(schema.chat.archivedAt),
					),
				);
			return rows.map(mapChat);
		},

		async getChat(chatId) {
			const row = await db.query.chat.findFirst({
				where: eq(schema.chat.id, chatId),
			});
			return row ? mapChat(row) : null;
		},

		async getChatByShareId(shareId) {
			const row = await db.query.chat.findFirst({
				where: eq(schema.chat.shareId, shareId),
			});
			return row ? mapChat(row) : null;
		},

		async renameChat(chatId, title) {
			const [row] = await db
				.update(schema.chat)
				.set({ title })
				.where(eq(schema.chat.id, chatId))
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatArchived(chatId, archived) {
			const [row] = await db
				.update(schema.chat)
				.set({ archivedAt: archived ? new Date() : null })
				.where(eq(schema.chat.id, chatId))
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatPinned(chatId, pinned) {
			const [row] = await db
				.update(schema.chat)
				.set({ pinnedAt: pinned ? new Date() : null })
				.where(eq(schema.chat.id, chatId))
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatProject(chatId, projectId) {
			const [row] = await db
				.update(schema.chat)
				.set({ projectId })
				.where(eq(schema.chat.id, chatId))
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async setChatShared(chatId, shared) {
			const existing = await db.query.chat.findFirst({
				where: eq(schema.chat.id, chatId),
			});
			if (!existing) throw new Error(`Chat not found: ${chatId}`);
			const [row] = await db
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
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async duplicateChat(chatId) {
			const source = await db.query.chat.findFirst({
				where: eq(schema.chat.id, chatId),
			});
			if (!source) throw new Error(`Chat not found: ${chatId}`);

			const [copy] = await db
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
				})
				.returning();
			if (!copy) throw new Error("Failed to duplicate chat");

			const messages = await db
				.select()
				.from(schema.message)
				.where(eq(schema.message.chatId, chatId));
			if (messages.length > 0) {
				await db.insert(schema.message).values(
					messages.map((message) => ({
						id: randomUUID(),
						chatId: copy.id,
						role: message.role,
						content: message.content,
						createdAt: message.createdAt,
					})),
				);
			}

			return mapChat(copy);
		},

		async deleteChat(chatId) {
			await db.delete(schema.chat).where(eq(schema.chat.id, chatId));
		},

		async updateChatAgent(chatId, agentId) {
			const [row] = await db
				.update(schema.chat)
				.set({ agentId })
				.where(eq(schema.chat.id, chatId))
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async updateChatToolPolicy({ chatId, toolMode, toolPolicy }) {
			const [row] = await db
				.update(schema.chat)
				.set({ toolMode, toolPolicy })
				.where(eq(schema.chat.id, chatId))
				.returning();
			if (!row) throw new Error(`Chat not found: ${chatId}`);
			return mapChat(row);
		},

		async createProject({ workspaceId, name, color, icon }) {
			const [row] = await db
				.insert(schema.project)
				.values({
					id: randomUUID(),
					workspaceId,
					name,
					...(color ? { color } : {}),
					...(icon ? { icon } : {}),
				})
				.returning();
			if (!row) throw new Error("Failed to create project");
			return mapProject(row);
		},

		async listProjectsByWorkspace(workspaceId) {
			const rows = await db
				.select()
				.from(schema.project)
				.where(eq(schema.project.workspaceId, workspaceId))
				.orderBy(desc(schema.project.createdAt));
			return rows.map(mapProject);
		},

		async getProject(projectId) {
			const row = await db.query.project.findFirst({
				where: eq(schema.project.id, projectId),
			});
			return row ? mapProject(row) : null;
		},

		async renameProject(projectId, name) {
			const [row] = await db
				.update(schema.project)
				.set({ name })
				.where(eq(schema.project.id, projectId))
				.returning();
			if (!row) throw new Error(`Project not found: ${projectId}`);
			return mapProject(row);
		},

		async setProjectAppearance(projectId, { color, icon }) {
			const [row] = await db
				.update(schema.project)
				.set({ color, icon })
				.where(eq(schema.project.id, projectId))
				.returning();
			if (!row) throw new Error(`Project not found: ${projectId}`);
			return mapProject(row);
		},

		async deleteProject(projectId) {
			await db.delete(schema.project).where(eq(schema.project.id, projectId));
		},

		async duplicateProject(projectId) {
			const source = await db.query.project.findFirst({
				where: eq(schema.project.id, projectId),
			});
			if (!source) throw new Error(`Project not found: ${projectId}`);

			const [copy] = await db
				.insert(schema.project)
				.values({
					id: randomUUID(),
					workspaceId: source.workspaceId,
					name: `${source.name} (copy)`,
					color: source.color,
					icon: source.icon,
				})
				.returning();
			if (!copy) throw new Error("Failed to duplicate project");

			const chats = await db
				.select()
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.projectId, projectId),
						isNull(schema.chat.archivedAt),
					),
				);
			for (const sourceChat of chats) {
				const [chatCopy] = await db
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
					})
					.returning();
				if (!chatCopy) continue;
				const messages = await db
					.select()
					.from(schema.message)
					.where(eq(schema.message.chatId, sourceChat.id));
				if (messages.length > 0) {
					await db.insert(schema.message).values(
						messages.map((message) => ({
							id: randomUUID(),
							chatId: chatCopy.id,
							role: message.role,
							content: message.content,
							createdAt: message.createdAt,
						})),
					);
				}
			}

			return mapProject(copy);
		},

		async addMessage({ chatId, role, content, ...usage }) {
			const [row] = await db
				.insert(schema.message)
				.values({ id: randomUUID(), chatId, role, content, ...usage })
				.returning();
			if (!row) throw new Error("Failed to add message");
			return mapMessage(row);
		},

		async listMessages(chatId) {
			const rows = await db
				.select()
				.from(schema.message)
				.where(eq(schema.message.chatId, chatId))
				.orderBy(asc(schema.message.createdAt));
			return rows.map(mapMessage);
		},

		async listMessagesByWorkspace(workspaceId, options) {
			const conditions = [eq(schema.chat.workspaceId, workspaceId)];
			if (options?.since) conditions.push(gte(schema.message.createdAt, options.since));
			const rows = await db
				.select({ message: schema.message })
				.from(schema.message)
				.innerJoin(schema.chat, eq(schema.message.chatId, schema.chat.id))
				.where(and(...conditions))
				.orderBy(desc(schema.message.createdAt));
			return rows.map((r) => mapMessage(r.message));
		},

		async updateMessage(id, content) {
			const [row] = await db
				.update(schema.message)
				.set({ content })
				.where(eq(schema.message.id, id))
				.returning();
			if (!row) throw new Error("Failed to update message");
			return mapMessage(row);
		},

		async deleteMessage(id) {
			await db.delete(schema.message).where(eq(schema.message.id, id));
		},

		async deleteMessagesAfter(chatId, messageId) {
			const rows = await db
				.select()
				.from(schema.message)
				.where(eq(schema.message.chatId, chatId))
				.orderBy(asc(schema.message.createdAt));
			const index = rows.findIndex((r) => r.id === messageId);
			if (index === -1) return;
			const idsToDelete = rows.slice(index + 1).map((r) => r.id);
			if (idsToDelete.length === 0) return;
			await db.delete(schema.message).where(inArray(schema.message.id, idsToDelete));
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create agent");
			return row;
		},

		async listAgentsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.agent)
				.where(eq(schema.agent.workspaceId, workspaceId));
		},

		async getAgent(agentId) {
			const row = await db.query.agent.findFirst({
				where: eq(schema.agent.id, agentId),
			});
			return row ?? null;
		},

		async updateAgent(agentId, input) {
			const [row] = await db
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
				.returning();
			if (!row) throw new Error(`Agent not found: ${agentId}`);
			return row;
		},

		async deleteAgent(agentId) {
			await db.delete(schema.agent).where(eq(schema.agent.id, agentId));
		},

		async listUnusedChatAgentIds(workspaceId) {
			return findUnusedChatAgentIds(workspaceId);
		},

		async deleteUnusedChatAgents(workspaceId) {
			const idsToDelete = await findUnusedChatAgentIds(workspaceId);
			if (idsToDelete.length === 0) return 0;
			await db.delete(schema.agent).where(inArray(schema.agent.id, idsToDelete));
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
			const [row] = await db
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
					startedAt: startedAt ?? null,
					completedAt: completedAt ?? null,
					updatedAt: new Date(),
				})
				.returning();
			if (!row) throw new Error("Failed to create task");
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
			const rows = await db
				.select()
				.from(schema.task)
				.where(and(...conditions))
				.orderBy(desc(schema.task.createdAt));
			return rows.map(mapTask);
		},

		async getTask(taskId) {
			const row = await db.query.task.findFirst({
				where: eq(schema.task.id, taskId),
			});
			return row ? mapTask(row) : null;
		},

		async listTaskTree(parentTaskId) {
			const rows = await db
				.select()
				.from(schema.task)
				.where(eq(schema.task.parentTaskId, parentTaskId))
				.orderBy(schema.task.createdAt);
			return rows.map(mapTask);
		},

		async updateTask(taskId, input) {
			const [row] = await db
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
				.returning();
			if (!row) throw new Error(`Task not found: ${taskId}`);
			return mapTask(row);
		},

		async claimNextTaskForAgent(workspaceId, agentId) {
			const rows = await db
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
				.orderBy(desc(schema.task.createdAt));
			const row = rows[0];
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create task event");
			return mapTaskEvent(row);
		},

		async listTaskEvents(taskId) {
			const rows = await db
				.select()
				.from(schema.taskEvent)
				.where(eq(schema.taskEvent.taskId, taskId))
				.orderBy(schema.taskEvent.createdAt);
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
			const [row] = await db
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
					startedAt: startedAt ?? null,
					completedAt: completedAt ?? null,
					updatedAt: new Date(),
				})
				.returning();
			if (!row) throw new Error("Failed to create agent run");
			return mapAgentRun(row);
		},

		async getAgentRun(id) {
			const row = await db.query.agentRun.findFirst({
				where: eq(schema.agentRun.id, id),
			});
			return row ? mapAgentRun(row) : null;
		},

		async listAgentRunsByWorkspace(workspaceId, options) {
			const conditions = [eq(schema.agentRun.workspaceId, workspaceId)];
			if (options?.since) conditions.push(gte(schema.agentRun.createdAt, options.since));
			const rows = await db
				.select()
				.from(schema.agentRun)
				.where(and(...conditions))
				.orderBy(desc(schema.agentRun.createdAt));
			return rows.map(mapAgentRun);
		},

		async listAgentRunsByTask(taskId) {
			const rows = await db
				.select()
				.from(schema.agentRun)
				.where(eq(schema.agentRun.taskId, taskId))
				.orderBy(schema.agentRun.createdAt);
			return rows.map(mapAgentRun);
		},

		async listAgentRunsByAgent(agentId) {
			const rows = await db
				.select()
				.from(schema.agentRun)
				.where(eq(schema.agentRun.agentId, agentId))
				.orderBy(desc(schema.agentRun.createdAt));
			return rows.map(mapAgentRun);
		},

		async listActiveAgentRunsByWorkspace(workspaceId) {
			const rows = await db
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
				.orderBy(desc(schema.agentRun.createdAt));
			return rows.map(mapAgentRun);
		},

		async updateAgentRun(id, input) {
			const [row] = await db
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
				.returning();
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create MCP server");
			return row;
		},

		async listMcpServersByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.mcpServer)
				.where(eq(schema.mcpServer.workspaceId, workspaceId));
		},

		async getMcpServer(id) {
			const row = await db.query.mcpServer.findFirst({
				where: eq(schema.mcpServer.id, id),
			});
			return row ?? null;
		},

		async deleteMcpServer(id) {
			await db.delete(schema.mcpServer).where(eq(schema.mcpServer.id, id));
		},

		async updateMcpServerOAuthState(id, oauthState) {
			await db
				.update(schema.mcpServer)
				.set({ oauthState })
				.where(eq(schema.mcpServer.id, id));
		},

		async getKnowledgeBaseConfig(workspaceId) {
			const row = await db.query.knowledgeBaseConfig.findFirst({
				where: eq(schema.knowledgeBaseConfig.workspaceId, workspaceId),
			});
			return row ?? null;
		},

		async listKnowledgeBaseConfigs() {
			return db.select().from(schema.knowledgeBaseConfig);
		},

		async upsertKnowledgeBaseConfig({
			workspaceId,
			vaultPath,
			obsidianRestUrl,
			obsidianApiKey,
			docsAgentEnabled,
			injectIntoPrompts,
		}) {
			const existing = await db.query.knowledgeBaseConfig.findFirst({
				where: eq(schema.knowledgeBaseConfig.workspaceId, workspaceId),
			});
			if (existing) {
				const [row] = await db
					.update(schema.knowledgeBaseConfig)
					.set({
						vaultPath,
						obsidianRestUrl: obsidianRestUrl ?? null,
						obsidianApiKey: obsidianApiKey ?? null,
						docsAgentEnabled: docsAgentEnabled ?? existing.docsAgentEnabled,
						injectIntoPrompts: injectIntoPrompts ?? existing.injectIntoPrompts,
						updatedAt: new Date(),
					})
					.where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
					.returning();
				if (!row)
					throw new Error(`Knowledge base config not found: ${workspaceId}`);
				return row;
			}

			const [row] = await db
				.insert(schema.knowledgeBaseConfig)
				.values({
					workspaceId,
					vaultPath,
					obsidianRestUrl: obsidianRestUrl ?? null,
					obsidianApiKey: obsidianApiKey ?? null,
					docsAgentEnabled: docsAgentEnabled ?? true,
					injectIntoPrompts: injectIntoPrompts ?? true,
					updatedAt: new Date(),
				})
				.returning();
			if (!row) throw new Error("Failed to create knowledge base config");
			return row;
		},

		async updateKnowledgeBaseSyncStatus({
			workspaceId,
			lastDocsSyncAt,
			lastDocsSyncError,
		}) {
			const [row] = await db
				.update(schema.knowledgeBaseConfig)
				.set({
					lastDocsSyncAt,
					lastDocsSyncError: lastDocsSyncError ?? null,
					updatedAt: new Date(),
				})
				.where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
				.returning();
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create automation");
			return row;
		},

		async listAutomationsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.automation)
				.where(eq(schema.automation.workspaceId, workspaceId));
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
				);
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
				);
		},

		async getAutomation(id) {
			const row = await db.query.automation.findFirst({
				where: eq(schema.automation.id, id),
			});
			return row ?? null;
		},

		async updateAutomationRun({
			id,
			lastRunAt,
			nextRunAt,
			lastRunStatus,
			lastErrorMessage,
		}) {
			const [row] = await db
				.update(schema.automation)
				.set({
					lastRunAt,
					nextRunAt,
					...(lastRunStatus !== undefined ? { lastRunStatus } : {}),
					...(lastErrorMessage !== undefined ? { lastErrorMessage } : {}),
				})
				.where(eq(schema.automation.id, id))
				.returning();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async setAutomationNextRun(id, nextRunAt) {
			const [row] = await db
				.update(schema.automation)
				.set({ nextRunAt })
				.where(eq(schema.automation.id, id))
				.returning();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async setAutomationEnabled(id, enabled) {
			const [row] = await db
				.update(schema.automation)
				.set({ enabled })
				.where(eq(schema.automation.id, id))
				.returning();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async setAutomationWatchCheckedAt(id, lastWatchCheckAt) {
			const [row] = await db
				.update(schema.automation)
				.set({ lastWatchCheckAt })
				.where(eq(schema.automation.id, id))
				.returning();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async updateAutomation(id, patch) {
			const [row] = await db
				.update(schema.automation)
				.set(patch)
				.where(eq(schema.automation.id, id))
				.returning();
			if (!row) throw new Error(`Automation not found: ${id}`);
			return row;
		},

		async deleteAutomation(id) {
			await db.delete(schema.automation).where(eq(schema.automation.id, id));
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create tool");
			return row;
		},

		async listToolsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.tool)
				.where(eq(schema.tool.workspaceId, workspaceId));
		},

		async getTool(id) {
			const row = await db.query.tool.findFirst({
				where: eq(schema.tool.id, id),
			});
			return row ?? null;
		},

		async setToolEnabled(id, enabled) {
			const [row] = await db
				.update(schema.tool)
				.set({ enabled })
				.where(eq(schema.tool.id, id))
				.returning();
			if (!row) throw new Error(`Tool not found: ${id}`);
			return row;
		},

		async deleteTool(id) {
			const row = await db.query.tool.findFirst({
				where: eq(schema.tool.id, id),
			});
			if (row?.builtin) {
				throw new Error(`Tool "${row.name}" is built-in and can't be deleted.`);
			}
			await db.delete(schema.tool).where(eq(schema.tool.id, id));
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create approval request");
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
				.orderBy(desc(schema.approvalRequest.createdAt));
		},

		async getApprovalRequest(id) {
			const row = await db.query.approvalRequest.findFirst({
				where: eq(schema.approvalRequest.id, id),
			});
			return row ?? null;
		},

		async resolveApprovalRequest({ id, status, resultOutput, errorMessage }) {
			const [row] = await db
				.update(schema.approvalRequest)
				.set({
					status,
					resultOutput,
					errorMessage: errorMessage ?? null,
					resolvedAt: new Date(),
				})
				.where(eq(schema.approvalRequest.id, id))
				.returning();
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create audit log entry");
			return row;
		},

		async listAuditLogByWorkspace(workspaceId, limit = 100) {
			return db
				.select()
				.from(schema.auditLog)
				.where(eq(schema.auditLog.workspaceId, workspaceId))
				.orderBy(desc(schema.auditLog.createdAt))
				.limit(limit);
		},

		async installExtension({ workspaceId, key, config }) {
			const [row] = await db
				.insert(schema.extension)
				.values({
					id: randomUUID(),
					workspaceId,
					key,
					config: config ?? {},
				})
				.returning();
			if (!row) throw new Error("Failed to install extension");
			return row;
		},

		async listExtensionsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.extension)
				.where(eq(schema.extension.workspaceId, workspaceId));
		},

		async getExtension(id) {
			const row = await db.query.extension.findFirst({
				where: eq(schema.extension.id, id),
			});
			return row ?? null;
		},

		async getExtensionByKey(workspaceId, key) {
			const row = await db.query.extension.findFirst({
				where: and(
					eq(schema.extension.workspaceId, workspaceId),
					eq(schema.extension.key, key),
				),
			});
			return row ?? null;
		},

		async setExtensionEnabled(id, enabled) {
			const [row] = await db
				.update(schema.extension)
				.set({ enabled })
				.where(eq(schema.extension.id, id))
				.returning();
			if (!row) throw new Error(`Extension not found: ${id}`);
			return row;
		},

		async updateExtensionConfig(id, config) {
			const [row] = await db
				.update(schema.extension)
				.set({ config })
				.where(eq(schema.extension.id, id))
				.returning();
			if (!row) throw new Error(`Extension not found: ${id}`);
			return row;
		},

		async uninstallExtension(id) {
			await db.delete(schema.extension).where(eq(schema.extension.id, id));
		},

		async createPlugin({
			workspaceId,
			slug,
			name,
			description,
			version,
			author,
			homepage,
			repoUrl,
			manifest,
			skillSlugs,
			agentDefs,
			fileCount,
			installDir,
		}) {
			const [row] = await db
				.insert(schema.plugin)
				.values({
					id: randomUUID(),
					workspaceId,
					slug,
					name,
					description,
					version: version ?? null,
					author: author ?? null,
					homepage: homepage ?? null,
					repoUrl,
					manifest,
					skillSlugs,
					agentDefs,
					fileCount,
					installDir,
					enabled: true,
				})
				.returning();
			if (!row) throw new Error("Failed to create plugin");
			return row;
		},

		async listPluginsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.plugin)
				.where(eq(schema.plugin.workspaceId, workspaceId));
		},

		async getPlugin(id) {
			const row = await db.query.plugin.findFirst({
				where: eq(schema.plugin.id, id),
			});
			return row ?? null;
		},

		async getPluginBySlug(workspaceId, slug) {
			const row = await db.query.plugin.findFirst({
				where: and(eq(schema.plugin.workspaceId, workspaceId), eq(schema.plugin.slug, slug)),
			});
			return row ?? null;
		},

		async setPluginEnabled(id, enabled) {
			const [row] = await db
				.update(schema.plugin)
				.set({ enabled })
				.where(eq(schema.plugin.id, id))
				.returning();
			if (!row) throw new Error(`Plugin not found: ${id}`);
			return row;
		},

		async deletePlugin(id) {
			await db.delete(schema.plugin).where(eq(schema.plugin.id, id));
		},

		async createLibraryFolder({ workspaceId, parentId, name }) {
			const [row] = await db
				.insert(schema.libraryFolder)
				.values({
					id: randomUUID(),
					workspaceId,
					parentId,
					name,
				})
				.returning();
			if (!row) throw new Error("Failed to create library folder");
			return row;
		},

		async listLibraryFoldersByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.libraryFolder)
				.where(eq(schema.libraryFolder.workspaceId, workspaceId));
		},

		async getLibraryFolder(id) {
			const row = await db.query.libraryFolder.findFirst({
				where: eq(schema.libraryFolder.id, id),
			});
			return row ?? null;
		},

		async renameLibraryFolder(id, name) {
			const [row] = await db
				.update(schema.libraryFolder)
				.set({ name })
				.where(eq(schema.libraryFolder.id, id))
				.returning();
			if (!row) throw new Error(`Library folder not found: ${id}`);
			return row;
		},

		async moveLibraryFolder(id, parentId) {
			const [row] = await db
				.update(schema.libraryFolder)
				.set({ parentId })
				.where(eq(schema.libraryFolder.id, id))
				.returning();
			if (!row) throw new Error(`Library folder not found: ${id}`);
			return row;
		},

		async deleteLibraryFolder(id) {
			await db.delete(schema.libraryFolder).where(eq(schema.libraryFolder.id, id));
		},

		async createLibraryFile({ workspaceId, folderId, name, mimeType, sizeBytes, kind, storageKey }) {
			const [row] = await db
				.insert(schema.libraryFile)
				.values({
					id: randomUUID(),
					workspaceId,
					folderId,
					name,
					mimeType,
					sizeBytes,
					kind,
					storageKey,
				})
				.returning();
			if (!row) throw new Error("Failed to create library file");
			return row;
		},

		async listLibraryFilesByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.libraryFile)
				.where(eq(schema.libraryFile.workspaceId, workspaceId));
		},

		async getLibraryFile(id) {
			const row = await db.query.libraryFile.findFirst({
				where: eq(schema.libraryFile.id, id),
			});
			return row ?? null;
		},

		async renameLibraryFile(id, name) {
			const [row] = await db
				.update(schema.libraryFile)
				.set({ name, updatedAt: new Date() })
				.where(eq(schema.libraryFile.id, id))
				.returning();
			if (!row) throw new Error(`Library file not found: ${id}`);
			return row;
		},

		async moveLibraryFile(id, folderId) {
			const [row] = await db
				.update(schema.libraryFile)
				.set({ folderId, updatedAt: new Date() })
				.where(eq(schema.libraryFile.id, id))
				.returning();
			if (!row) throw new Error(`Library file not found: ${id}`);
			return row;
		},

		async deleteLibraryFile(id) {
			await db.delete(schema.libraryFile).where(eq(schema.libraryFile.id, id));
		},

		async createVideoGenerationJob({
			workspaceId,
			chatId,
			prompt,
			model,
			provider,
			size,
			seconds,
			auto,
		}) {
			const [row] = await db
				.insert(schema.videoGenerationJob)
				.values({
					id: randomUUID(),
					workspaceId,
					chatId,
					prompt,
					model,
					provider,
					size,
					seconds,
					auto,
				})
				.returning();
			if (!row) throw new Error("Failed to create video generation job");
			return row;
		},

		async listVideoGenerationJobsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.videoGenerationJob)
				.where(eq(schema.videoGenerationJob.workspaceId, workspaceId))
				.orderBy(desc(schema.videoGenerationJob.createdAt));
		},

		async getVideoGenerationJob(id) {
			const row = await db.query.videoGenerationJob.findFirst({
				where: eq(schema.videoGenerationJob.id, id),
			});
			return row ?? null;
		},

		async updateVideoGenerationJob(id, patch) {
			const [row] = await db
				.update(schema.videoGenerationJob)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.videoGenerationJob.id, id))
				.returning();
			if (!row) throw new Error(`Video generation job not found: ${id}`);
			return row;
		},

		async createWorkflow({ workspaceId, name, description, definition }) {
			const [row] = await db
				.insert(schema.workflow)
				.values({
					id: randomUUID(),
					workspaceId,
					name,
					description: description ?? null,
					definition,
				})
				.returning();
			if (!row) throw new Error("Failed to create workflow");
			return row;
		},

		async listWorkflowsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.workflow)
				.where(eq(schema.workflow.workspaceId, workspaceId))
				.orderBy(desc(schema.workflow.updatedAt));
		},

		async getWorkflow(id) {
			const row = await db.query.workflow.findFirst({
				where: eq(schema.workflow.id, id),
			});
			return row ?? null;
		},

		async updateWorkflow(id, patch) {
			const [row] = await db
				.update(schema.workflow)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.workflow.id, id))
				.returning();
			if (!row) throw new Error(`Workflow not found: ${id}`);
			return row;
		},

		async deleteWorkflow(id) {
			await db.delete(schema.workflow).where(eq(schema.workflow.id, id));
		},

		async createWorkflowRun({ workflowId, workspaceId }) {
			const [row] = await db
				.insert(schema.workflowRun)
				.values({ id: randomUUID(), workflowId, workspaceId })
				.returning();
			if (!row) throw new Error("Failed to create workflow run");
			return row;
		},

		async getWorkflowRun(id) {
			const row = await db.query.workflowRun.findFirst({
				where: eq(schema.workflowRun.id, id),
			});
			return row ?? null;
		},

		async listWorkflowRunsByWorkflow(workflowId) {
			return db
				.select()
				.from(schema.workflowRun)
				.where(eq(schema.workflowRun.workflowId, workflowId))
				.orderBy(desc(schema.workflowRun.createdAt));
		},

		async updateWorkflowRun(id, patch) {
			const [row] = await db
				.update(schema.workflowRun)
				.set(patch)
				.where(eq(schema.workflowRun.id, id))
				.returning();
			if (!row) throw new Error(`Workflow run not found: ${id}`);
			return row;
		},

		async createWorkflowRunNode({ runId, nodeId }) {
			const [row] = await db
				.insert(schema.workflowRunNode)
				.values({ id: randomUUID(), runId, nodeId })
				.returning();
			if (!row) throw new Error("Failed to create workflow run node");
			return row;
		},

		async listWorkflowRunNodesByRun(runId) {
			return db
				.select()
				.from(schema.workflowRunNode)
				.where(eq(schema.workflowRunNode.runId, runId));
		},

		async updateWorkflowRunNode(id, patch) {
			const [row] = await db
				.update(schema.workflowRunNode)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.workflowRunNode.id, id))
				.returning();
			if (!row) throw new Error(`Workflow run node not found: ${id}`);
			return row;
		},

		async createSeoProject({ workspaceId, extensionId, domain, repoPath }) {
			const [row] = await db
				.insert(schema.seoProject)
				.values({
					id: randomUUID(),
					workspaceId,
					extensionId,
					domain,
					repoPath,
				})
				.returning();
			if (!row) throw new Error("Failed to create SEO project");
			return row;
		},

		async listSeoProjectsByWorkspace(workspaceId) {
			return db
				.select()
				.from(schema.seoProject)
				.where(eq(schema.seoProject.workspaceId, workspaceId));
		},

		async getSeoProject(id) {
			const row = await db.query.seoProject.findFirst({
				where: eq(schema.seoProject.id, id),
			});
			return row ?? null;
		},

		async updateSeoProject(id, patch) {
			const [row] = await db
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
				.returning();
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
				);
		},

		async deleteSeoProject(id) {
			await db.delete(schema.seoProject).where(eq(schema.seoProject.id, id));
		},

		async createSeoAnalysisRun({ seoProjectId, workspaceId }) {
			const [row] = await db
				.insert(schema.seoAnalysisRun)
				.values({
					id: randomUUID(),
					seoProjectId,
					workspaceId,
				})
				.returning();
			if (!row) throw new Error("Failed to create SEO analysis run");
			return row;
		},

		async getSeoAnalysisRun(id) {
			const row = await db.query.seoAnalysisRun.findFirst({
				where: eq(schema.seoAnalysisRun.id, id),
			});
			return row ?? null;
		},

		async listSeoAnalysisRunsByProject(seoProjectId) {
			return db
				.select()
				.from(schema.seoAnalysisRun)
				.where(eq(schema.seoAnalysisRun.seoProjectId, seoProjectId))
				.orderBy(desc(schema.seoAnalysisRun.startedAt));
		},

		async updateSeoAnalysisRun(id, patch) {
			const [row] = await db
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
				.returning();
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
			const [row] = await db
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
				})
				.returning();
			if (!row) throw new Error("Failed to create SEO finding");
			return row;
		},

		async listSeoFindingsByRun(runId) {
			return db
				.select()
				.from(schema.seoFinding)
				.where(eq(schema.seoFinding.runId, runId));
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
				.orderBy(desc(schema.seoFinding.createdAt));
		},

		async listSeoFindingsByProject(seoProjectId) {
			return db
				.select()
				.from(schema.seoFinding)
				.where(eq(schema.seoFinding.seoProjectId, seoProjectId))
				.orderBy(desc(schema.seoFinding.createdAt));
		},

		async getSeoFinding(id) {
			const row = await db.query.seoFinding.findFirst({
				where: eq(schema.seoFinding.id, id),
			});
			return row ?? null;
		},

		async setSeoFindingResolved(id, resolved) {
			const [row] = await db
				.update(schema.seoFinding)
				.set({ resolved })
				.where(eq(schema.seoFinding.id, id))
				.returning();
			if (!row) throw new Error(`SEO finding not found: ${id}`);
			return row;
		},

		async createSeoBlogPost({ seoProjectId, workspaceId, keyword }) {
			const [row] = await db
				.insert(schema.seoBlogPost)
				.values({
					id: randomUUID(),
					seoProjectId,
					workspaceId,
					keyword,
				})
				.returning();
			if (!row) throw new Error("Failed to create SEO blog post");
			return row;
		},

		async listSeoBlogPostsByProject(seoProjectId) {
			return db
				.select()
				.from(schema.seoBlogPost)
				.where(eq(schema.seoBlogPost.seoProjectId, seoProjectId))
				.orderBy(desc(schema.seoBlogPost.createdAt));
		},

		async getSeoBlogPost(id) {
			const row = await db.query.seoBlogPost.findFirst({
				where: eq(schema.seoBlogPost.id, id),
			});
			return row ?? null;
		},

		async updateSeoBlogPost(id, patch) {
			const [row] = await db
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
				.returning();
			if (!row) throw new Error(`SEO blog post not found: ${id}`);
			return row;
		},
	};
}
