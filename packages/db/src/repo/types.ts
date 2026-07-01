export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface WorkspaceRecord {
  id: string;
  name: string;
  customInstructions: string | null;
}

export interface ChatRecord {
  id: string;
  workspaceId: string;
  title: string;
  modelId: string;
  createdAt: Date;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

/**
 * A dialect-agnostic data access interface. `packages/db` ships one
 * implementation per SQL dialect (pg.repo.ts, sqlite.repo.ts) so the rest of
 * the app never imports drizzle table objects directly — it only ever calls
 * these methods against whichever dialect the installer picked (ADR-0002).
 */
export interface DbRepository {
  readonly driver: "pg" | "sqlite";

  getOrCreateDemoUser(): Promise<{ id: string; name: string; email: string }>;

  createWorkspace(input: { userId: string; name: string }): Promise<WorkspaceRecord>;
  listWorkspacesByUser(userId: string): Promise<WorkspaceRecord[]>;

  createChat(input: { workspaceId: string; title: string; modelId: string }): Promise<ChatRecord>;
  listChatsByWorkspace(workspaceId: string): Promise<ChatRecord[]>;

  addMessage(input: { chatId: string; role: MessageRole; content: string }): Promise<MessageRecord>;
  listMessages(chatId: string): Promise<MessageRecord[]>;
}
