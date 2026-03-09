// 会话存储管理 - 支持版本控制、配额管理、导出导入

export type ConversationMode = "default" | "yolo" | "plan" | "smart";

export type ModelType =
	| "glm-4.7"
	| "glm-5"
	| "deepseek-v3.2-chat"
	| "iFlow-ROME-30BA3B"
	| "qwen3-coder-plus"
	| "kimi-k2-thinking"
	| "minimax-m2.5"
	| "minimax-m2.1"
	| "kimi-k2-0905"
	| "kimi-k2.5";

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

export interface Conversation {
	id: string;
	title: string;
	messages: Message[];
	mode: ConversationMode;
	think: boolean;
	model: ModelType;
	createdAt: number;
	updatedAt: number;
}

export interface ConversationState {
	currentConversationId: string | null;
	conversations: Conversation[];
}

// 数据版本管理
interface PersistedState extends ConversationState {
	version: number;
	createdAt: number;
	updatedAt: number;
}

// 存储配额信息
interface StorageQuotaInfo {
	usedBytes: number;
	totalBytes: number;
	percentUsed: number;
	approachingLimit: boolean; // 超过 80%
	atLimit: boolean; // 超过 95%
}

const STORAGE_VERSION = 1;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024; // 4MB 限制（localStorage 通常是 5-10MB）
const WARNING_THRESHOLD = 0.8; // 80% 警告
const CRITICAL_THRESHOLD = 0.95; // 95% 严重警告

export class ConversationStore {
	private state: ConversationState;
	private listeners: Set<() => void> = new Set();
	private storageKey: string;

	constructor(vaultPath?: string) {
		// Vault 隔离存储：每个 vault 使用不同的存储 key
		this.storageKey = vaultPath
			? `iflow-conversations-${this.hashVaultPath(vaultPath)}`
			: "iflow-conversations";
		this.state = this.load();
	}

	// 生成 vault path 的哈希值用于存储 key
	private hashVaultPath(path: string): string {
		let hash = 0;
		for (let i = 0; i < path.length; i++) {
			const char = path.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(36);
	}

	private load(): ConversationState {
		try {
			const data = localStorage.getItem(this.storageKey);
			if (data) {
				const parsed = JSON.parse(data);

				// 版本迁移
				if (parsed.version !== undefined) {
					return this.migrate(parsed);
				}

				// 旧版本数据（无 version 字段）
				return {
					currentConversationId: parsed.currentConversationId,
					conversations: parsed.conversations || [],
				};
			}
		} catch (error) {
			console.error("[ConversationStore] Failed to load conversations:", error);
		}
		return {
			currentConversationId: null,
			conversations: [],
		};
	}

	// 数据版本迁移
	private migrate(persisted: PersistedState): ConversationState {
		const version = persisted.version || 0;

		if (version < STORAGE_VERSION) {
			console.log(`[ConversationStore] Migrating data from version ${version} to ${STORAGE_VERSION}`);
			// 未来版本迁移逻辑在这里添加
			// 例如：v1 -> v2 的字段转换
		}

		return {
			currentConversationId: persisted.currentConversationId,
			conversations: persisted.conversations || [],
		};
	}

	private save(): void {
		try {
			const persisted: PersistedState = {
				...this.state,
				version: STORAGE_VERSION,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};
			const data = JSON.stringify(persisted);

			// 检查存储配额
			if (data.length > MAX_STORAGE_BYTES) {
				console.warn("[ConversationStore] Storage exceeds limit, attempting cleanup...");
				this.cleanupOldConversations();
				// 再次尝试保存
				const cleanedData = JSON.stringify({
					...this.state,
					version: STORAGE_VERSION,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				if (cleanedData.length > MAX_STORAGE_BYTES) {
					throw new Error(`Storage size (${cleanedData.length} bytes) exceeds limit (${MAX_STORAGE_BYTES} bytes)`);
				}
			}

			localStorage.setItem(this.storageKey, data);
		} catch (error) {
			console.error("[ConversationStore] Failed to save conversations:", error);
			// 可以在这里添加用户通知
		}
	}

	// 清理旧会话以释放空间
	private cleanupOldConversations(): void {
		const conversations = [...this.state.conversations];
		const originalCount = conversations.length;

		// 按更新时间排序，保留最近的 50 个会话
		conversations.sort((a, b) => b.updatedAt - a.updatedAt);
		const kept = conversations.slice(0, 50);

		if (kept.length < originalCount) {
			console.log(`[ConversationStore] Cleaned up ${originalCount - kept.length} old conversations`);
			this.state.conversations = kept;

			// 如果当前会话被删除，切换到第一个可用会话
			if (this.state.currentConversationId) {
				const stillExists = kept.find(c => c.id === this.state.currentConversationId);
				if (!stillExists) {
					this.state.currentConversationId = kept[0]?.id || null;
				}
			}
		}
	}

	private notify(): void {
		this.listeners.forEach((listener) => listener());
	}

	// ============================================
	// 公共 API
	// ============================================

	getState(): ConversationState {
		return { ...this.state };
	}

	subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	getCurrentConversation(): Conversation | null {
		if (!this.state.currentConversationId) {
			return null;
		}
		return (
			this.state.conversations.find(
				(c) => c.id === this.state.currentConversationId
			) || null
		);
	}

	// 获取存储配额信息
	getStorageQuota(): StorageQuotaInfo {
		try {
			const data = localStorage.getItem(this.storageKey);
			const usedBytes = data ? new Blob([data]).size : 0;
			const percentUsed = usedBytes / MAX_STORAGE_BYTES;

			return {
				usedBytes,
				totalBytes: MAX_STORAGE_BYTES,
				percentUsed,
				approachingLimit: percentUsed >= WARNING_THRESHOLD,
				atLimit: percentUsed >= CRITICAL_THRESHOLD,
			};
		} catch (error) {
			console.error("[ConversationStore] Failed to calculate storage quota:", error);
			return {
				usedBytes: 0,
				totalBytes: MAX_STORAGE_BYTES,
				percentUsed: 0,
				approachingLimit: false,
				atLimit: false,
			};
		}
	}

	newConversation(
		defaultModel: ModelType = "glm-4.7",
		defaultMode: ConversationMode = "default",
		defaultThink: boolean = false
	): Conversation {
		const current = this.getCurrentConversation();
		const conversation: Conversation = {
			id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			title: "New Conversation",
			messages: [],
			mode: current?.mode ?? defaultMode,
			think: current?.think ?? defaultThink,
			model: current?.model ?? defaultModel,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		this.state = {
			...this.state,
			conversations: [conversation, ...this.state.conversations],
			currentConversationId: conversation.id,
		};

		this.save();
		this.notify();
		return conversation;
	}

	switchConversation(conversationId: string): void {
		const conversation = this.state.conversations.find(
			(c) => c.id === conversationId
		);
		if (!conversation) {
			console.error(`[ConversationStore] Conversation ${conversationId} not found`);
			return;
		}

		this.state = {
			...this.state,
			currentConversationId: conversationId,
		};

		this.save();
		this.notify();
	}

	deleteConversation(conversationId: string): void {
		const conversations = this.state.conversations.filter(
			(c) => c.id !== conversationId
		);

		let currentConversationId = this.state.currentConversationId;
		if (currentConversationId === conversationId) {
			currentConversationId = conversations.length > 0 ? conversations[0].id : null;
		}

		this.state = {
			conversations,
			currentConversationId,
		};

		this.save();
		this.notify();
	}

	updateConversationSettings(
		conversationId: string,
		settings: Partial<Pick<Conversation, "mode" | "think" | "model">>
	): void {
		const conversations = this.state.conversations.map((c) =>
			c.id === conversationId
				? { ...c, ...settings, updatedAt: Date.now() }
				: c
		);

		this.state = { ...this.state, conversations };
		this.save();
		this.notify();
	}

	addUserMessage(conversationId: string, content: string): Message {
		const message: Message = {
			id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			role: "user",
			content,
			timestamp: Date.now(),
		};

		const conversations = this.state.conversations.map((c) => {
			if (c.id === conversationId) {
				const messages = [...c.messages, message];
				const title =
					c.title === "New Conversation"
						? this.generateTitle(content)
						: c.title;
				return {
					...c,
					messages,
					title,
					updatedAt: Date.now(),
				};
			}
			return c;
		});

		this.state = { ...this.state, conversations };
		this.save();
		this.notify();
		return message;
	}

	addAssistantMessage(conversationId: string, content: string): Message {
		const message: Message = {
			id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			role: "assistant",
			content,
			timestamp: Date.now(),
		};

		const conversations = this.state.conversations.map((c) => {
			if (c.id === conversationId) {
				return {
					...c,
					messages: [...c.messages, message],
					updatedAt: Date.now(),
				};
			}
			return c;
		});

		this.state = { ...this.state, conversations };
		this.save();
		this.notify();
		return message;
	}

	updateAssistantMessage(
		conversationId: string,
		messageId: string,
		content: string
	): void {
		const conversations = this.state.conversations.map((c) => {
			if (c.id === conversationId) {
				const messages = c.messages.map((m) =>
					m.id === messageId ? { ...m, content } : m
				);
				return { ...c, messages, updatedAt: Date.now() };
			}
			return c;
		});

		this.state = { ...this.state, conversations };
		this.save();
		this.notify();
	}

	private generateTitle(firstMessage: string): string {
		const trimmed = firstMessage.trim();
		return trimmed.length > 50
			? trimmed.substring(0, 47) + "..."
			: trimmed;
	}

	getConversationMessages(conversationId: string): Message[] {
		const conversation = this.state.conversations.find(
			(c) => c.id === conversationId
		);
		return conversation?.messages || [];
	}

	// ============================================
	// 导出/导入功能
	// ============================================

	// 导出为 JSON
	exportToJSON(): string {
		const exported = {
			version: STORAGE_VERSION,
			exportedAt: new Date().toISOString(),
			conversations: this.state.conversations,
			currentConversationId: this.state.currentConversationId,
		};
		return JSON.stringify(exported, null, 2);
	}

	// 导出为 Markdown
	exportToMarkdown(conversationId?: string): string {
		const conversationsToExport = conversationId
			? this.state.conversations.filter(c => c.id === conversationId)
			: this.state.conversations;

		const mdLines: string[] = [];

		conversationsToExport.forEach(conv => {
			mdLines.push(`# ${conv.title}`);
			mdLines.push("");
			mdLines.push(`**Created:** ${new Date(conv.createdAt).toLocaleString()}`);
			mdLines.push(`**Model:** ${conv.model}`);
			mdLines.push(`**Mode:** ${conv.mode}`);
			mdLines.push("");

			conv.messages.forEach(msg => {
				const role = msg.role === "user" ? "👤 **You**" : "🤖 **iFlow**";
				mdLines.push(`## ${role}`);
				mdLines.push("");
				mdLines.push(msg.content);
				mdLines.push("");
			});

			mdLines.push("---");
			mdLines.push("");
		});

		return mdLines.join("\n");
	}

	// 从 JSON 导入
	importFromJSON(jsonString: string): { success: boolean; message: string; imported?: number } {
		try {
			const imported = JSON.parse(jsonString);

			if (!imported.conversations || !Array.isArray(imported.conversations)) {
				return {
					success: false,
					message: "Invalid format: missing conversations array"
				};
			}

			// 合并策略：添加到现有会话，避免 ID 冲突
			let importedCount = 0;
			const existingIds = new Set(this.state.conversations.map(c => c.id));

			imported.conversations.forEach((conv: Conversation) => {
				if (!existingIds.has(conv.id)) {
					this.state.conversations.push(conv);
					importedCount++;
				}
			});

			this.save();
			this.notify();

			return {
				success: true,
				message: `Successfully imported ${importedCount} conversations`,
				imported: importedCount
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	// 清除所有数据
	clearAll(): void {
		this.state = {
			currentConversationId: null,
			conversations: [],
		};
		this.save();
		this.notify();
	}

	// 获取统计信息
	getStats(): {
		totalConversations: number;
		totalMessages: number;
		oldestConversation?: Date;
		newestConversation?: Date;
	} {
		const conversations = this.state.conversations;
		const totalMessages = conversations.reduce((sum, c) => sum + c.messages.length, 0);

		const timestamps = conversations.map(c => c.createdAt).filter(t => t > 0);
		const oldest = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
		const newest = timestamps.length > 0 ? Math.max(...timestamps) : undefined;

		return {
			totalConversations: conversations.length,
			totalMessages,
			oldestConversation: oldest ? new Date(oldest) : undefined,
			newestConversation: newest ? new Date(newest) : undefined,
		};
	}
}
