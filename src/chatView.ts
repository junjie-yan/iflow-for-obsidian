import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import IFlowPlugin from './main';
import { IFlowService } from './iflowService';
import { ConversationStore, type Conversation, type Message } from './conversationStore';
import type { IFlowSettings } from './main';

export const VIEW_TYPE_IFLOW_CHAT = 'iflow-chat-view';

export class IFlowChatView extends ItemView {
	plugin: IFlowPlugin;
	iflowService: IFlowService;
	private conversationStore: ConversationStore;
	private messages: { role: string; content: string; id: string }[] = [];
	private currentMessage = '';
	private isStreaming = false;

	// Settings
	private currentModel = 'glm-4.7';
	private currentMode = 'default';
	private thinkingEnabled = false;

	// Available models and modes from iFlow CLI
	private availableModels: any[] = [];
	private availableModes: any[] = [];

	// Conversation management
	private currentConversationId: string | null = null;
	private conversationTitleEl: HTMLElement | null = null;
	private isLoadingMessages = false; // 防止在加载期间重复加载

	constructor(leaf: WorkspaceLeaf, plugin: IFlowPlugin, iflowService: IFlowService) {
		super(leaf);
		this.plugin = plugin;
		this.iflowService = iflowService;
		this.conversationStore = new ConversationStore();

		// Subscribe to conversation changes
		this.conversationStore.subscribe(() => this.onConversationChange());
	}

	getViewType(): string {
		return VIEW_TYPE_IFLOW_CHAT;
	}

	getDisplayText(): string {
		return 'iFlow Chat';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('iflow-chat-container');

		// Create chat UI
		const chatContainer = container.createDiv({ cls: 'iflow-chat' });

		// Top bar with conversation selector
		const topBar = chatContainer.createDiv({ cls: 'iflow-top-bar' });
		this.createConversationSelector(topBar);

		// Messages container
		const messagesContainer = chatContainer.createDiv({ cls: 'iflow-messages' });
		this.messagesContainer = messagesContainer;

		// Input container
		const inputContainer = chatContainer.createDiv({ cls: 'iflow-input-container' });

		// Input nav row (model selector, mode selector, thinking toggle)
		const navRow = inputContainer.createDiv({ cls: 'iflow-input-nav-row' });

		// Left side: Model selector
		const modelSelector = this.createModelSelector(navRow);

		// Right side: Mode selector and thinking toggle
		const rightControls = navRow.createDiv({ cls: 'iflow-input-controls-right' });
		rightControls.style.display = 'flex';
		rightControls.style.gap = '8px';
		rightControls.style.alignItems = 'center';

		const modeSelector = this.createModeSelector(rightControls);
		const thinkingToggle = this.createThinkingToggle(rightControls);

		// Input wrapper
		const inputWrapper = inputContainer.createDiv({ cls: 'iflow-input-wrapper' });

		// Textarea for input
		const textarea = inputWrapper.createEl('textarea', {
			cls: 'iflow-input',
			attr: { placeholder: 'Ask iFlow anything... (Use @ to reference files, Shift+Enter for new line)' },
		});
		this.textarea = textarea;

		// Send button
		const sendButton = inputWrapper.createEl('button', {
			cls: 'iflow-send-button',
			text: 'Send',
		});
		sendButton.onclick = () => this.sendMessage();

		// Handle enter key
		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Add context indicator
		const contextIndicator = chatContainer.createDiv({ cls: 'iflow-context-indicator' });
		this.contextIndicator = contextIndicator;

		// Update context when active file changes
		this.updateContext();
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.updateContext())
		);

		// Initialize conversation - load existing or create new
		this.initializeConversation();
	}

	private initializeConversation(): void {
		const state = this.conversationStore.getState();
		this.currentConversationId = state.currentConversationId;

		if (this.currentConversationId) {
			// Load existing conversation
			this.loadMessagesFromConversation();
		} else {
			// Create first conversation
			this.createNewConversation();
		}
	}

	async onClose() {
		// Cleanup
	}

	private updateContext() {
		const activeFile = this.plugin.getActiveFile();
		if (activeFile) {
			this.currentFile = activeFile;
			this.contextIndicator.textContent = `📄 ${activeFile.path}`;
		} else {
			this.currentFile = null;
			this.contextIndicator.textContent = '';
		}
	}

	private streamingTimeout: NodeJS.Timeout | null = null;

	private async sendMessage() {
		const content = this.textarea.value.trim();

		// Debug logging
		console.log('[iFlow Chat] sendMessage called', {
			content,
			isStreaming: this.isStreaming,
			currentConversationId: this.currentConversationId
		});

		if (!content) {
			console.log('[iFlow Chat] Message blocked: empty content');
			return;
		}

		// Force reset if stuck in streaming state
		if (this.isStreaming) {
			console.warn('[iFlow Chat] Force reset: was stuck in streaming state');
			this.isStreaming = false;
			if (this.streamingTimeout) {
				clearTimeout(this.streamingTimeout);
				this.streamingTimeout = null;
			}
		}

		// Ensure we have a conversation
		if (!this.currentConversationId) {
			console.log('[iFlow Chat] Creating new conversation');
			this.createNewConversation();
		}

		// Get context
		const activeFile = this.plugin.getActiveFile();
		let fileContent = '';
		let selection = '';

		if (activeFile) {
			// Check if file has excluded tags
			const metadata = this.app.metadataCache.getFileCache(activeFile);
			const tags = metadata?.tags?.map(t => t.tag) || [];
			const hasExcludedTag = this.plugin.settings.excludedTags.some(tag =>
				tags.includes(tag)
			);

			if (!hasExcludedTag) {
				fileContent = await this.app.vault.read(activeFile);

				// Get selection if available
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.editor) {
					selection = activeView.editor.getSelection();
				}
			}
		}

		// Add user message to UI
		const userMsgId = this.addMessage('user', content);
		this.textarea.value = '';

		// Add user message to conversation
		if (this.currentConversationId) {
			this.conversationStore.addUserMessage(this.currentConversationId, content);
		}

		// Add assistant message placeholder
		const assistantMsgId = this.addMessage('assistant', '');
		this.currentMessage = '';
		this.isStreaming = true;

		console.log('[iFlow Chat] Starting streaming', {
			userMsgId,
			assistantMsgId,
			isStreaming: this.isStreaming
		});

		// Set timeout to reset streaming state if onEnd is not called
		this.streamingTimeout = setTimeout(() => {
			console.warn('[iFlow Chat] Streaming timeout: forcing reset');
			this.isStreaming = false;
			this.streamingTimeout = null;
		}, 60000); // 60 second timeout

		// Scroll to bottom
		if (this.plugin.settings.enableAutoScroll) {
			this.scrollToBottom();
		}

		// Cleanup function
		const cleanup = () => {
			if (this.streamingTimeout) {
				clearTimeout(this.streamingTimeout);
				this.streamingTimeout = null;
			}
			this.isStreaming = false;
			console.log('[iFlow Chat] Cleanup: streaming state reset');
		};

		// Send to iFlow
		try {
			await this.iflowService.sendMessage({
				content,
				filePath: activeFile?.path,
				fileContent,
				selection,
				model: this.currentModel,
				mode: this.currentMode,
				thinkingEnabled: this.thinkingEnabled,
				onChunk: (chunk: string) => {
					this.currentMessage += chunk;
					this.updateMessage(assistantMsgId, this.currentMessage);

					if (this.plugin.settings.enableAutoScroll) {
						this.scrollToBottom();
					}
				},
				onEnd: () => {
					console.log('[iFlow Chat] onEnd called, setting isStreaming = false');
					cleanup();

					// Save assistant message to conversation
					if (this.currentConversationId && this.currentMessage) {
						this.conversationStore.addAssistantMessage(
							this.currentConversationId,
							this.currentMessage
						);
					}

					// Update UI meta info (message count, etc) after streaming ends
					this.updateConversationUI();
				},
				onError: (error: string) => {
					console.log('[iFlow Chat] onError called', error);
					cleanup();
					this.updateMessage(assistantMsgId, `Error: ${error}`);
				},
			});
		} catch (error) {
			console.log('[iFlow Chat] Exception in sendMessage', error);
			cleanup();
			this.updateMessage(assistantMsgId, `Error: ${error.message}`);
		}
	}

	private addMessage(role: string, content: string): string {
		const id = Date.now().toString();
		this.messages.push({ role, content, id });

		const messageEl = this.messagesContainer.createDiv({
			cls: `iflow-message iflow-message-${role}`,
		});
		messageEl.dataset.id = id;

		const roleEl = messageEl.createDiv({ cls: 'iflow-message-role' });
		roleEl.textContent = role === 'user' ? 'You' : 'iFlow';

		const contentEl = messageEl.createDiv({ cls: 'iflow-message-content' });
		contentEl.innerHTML = this.formatMessage(content);

		return id;
	}

	private updateMessage(id: string, content: string): void {
		const messageEl = this.messagesContainer.querySelector(`[data-id="${id}"]`);
		if (messageEl) {
			const contentEl = messageEl.querySelector('.iflow-message-content');
			if (contentEl) {
				contentEl.innerHTML = this.formatMessage(content);
			}
		}
	}

	private formatMessage(content: string): string {
		// Simple markdown formatting
		return content
			.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\n/g, '<br>');
	}

	private scrollToBottom(): void {
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	// ============================================
	// UI Component Creators
	// ============================================

	private addWelcomeMessage(): void {
		this.messagesContainer.createDiv({
			cls: 'iflow-welcome',
		}, (el) => {
			el.createEl('h2', { text: '👋 Welcome to iFlow!' });
			el.createEl('p', { text: 'Your AI-powered coding assistant for Obsidian.' });
			el.createEl('p', { text: 'I can help you with:' });
			el.createEl('p', { text: '• Reading and editing your notes' });
			el.createEl('p', { text: '• Searching your vault' });
			el.createEl('p', { text: '• Writing and refactoring code' });
			el.createEl('p', { text: '• Answering questions' });
			el.createEl('p', { text: '\nSelect a model and mode above, then start typing!' });
		});
	}

	private createModelSelector(container: HTMLElement): HTMLElement {
		const selector = container.createDiv({ cls: 'iflow-model-selector' });

		// Full models list (matching VS Code plugin)
		const defaultModels = [
			{ id: 'glm-4.7', name: 'GLM-4.7' },
			{ id: 'glm-5', name: 'GLM-5' },
			{ id: 'deepseek-v3.2-chat', name: 'DeepSeek-V3.2' },
			{ id: 'iFlow-ROME-30BA3B', name: 'iFlow-ROME-30BA3B(Preview)' },
			{ id: 'qwen3-coder-plus', name: 'Qwen3-Coder-Plus' },
			{ id: 'kimi-k2-thinking', name: 'Kimi-K2-Thinking' },
			{ id: 'minimax-m2.5', name: 'MiniMax-M2.5' },
			{ id: 'minimax-m2.1', name: 'MiniMax-M2.1' },
			{ id: 'kimi-k2-0905', name: 'Kimi-K2-0905' },
			{ id: 'kimi-k2.5', name: 'Kimi-K2.5' },
		];

		this.availableModels = defaultModels;

		// Button
		const btn = selector.createEl('button', {
			cls: 'iflow-model-btn ready',
		});

		const currentModelObj = defaultModels.find(m => m.id === this.currentModel) || defaultModels[0];
		const label = btn.createSpan({ cls: 'iflow-model-label', text: currentModelObj.name });
		const chevron = btn.createDiv({ cls: 'iflow-model-chevron' });
		chevron.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`;

		// Dropdown
		const dropdown = selector.createDiv({ cls: 'iflow-model-dropdown' });

		this.availableModels.forEach(model => {
			dropdown.createDiv({
				cls: `iflow-model-option ${model.id === this.currentModel ? 'selected' : ''}`,
				text: model.name,
			}, (el) => {
				el.onclick = () => {
					this.currentModel = model.id;
					label.textContent = model.name;
					dropdown.querySelectorAll('.iflow-model-option').forEach(opt => {
						opt.removeClass('selected');
					});
					el.addClass('selected');
				};
			});
		});

		return selector;
	}

	private createModeSelector(container: HTMLElement): HTMLElement {
		const selector = container.createDiv({ cls: 'iflow-mode-selector' });

		// Modes list
		const modes = [
			{ id: 'default', name: 'Normal', icon: '⚡' },
			{ id: 'yolo', name: 'YOLO', icon: '🚀' },
			{ id: 'smart', name: 'Smart', icon: '🧠' },
			{ id: 'plan', name: 'Plan', icon: '📋' },
		];

		this.availableModes = modes;

		// Trigger button (like model selector)
		const btn = selector.createEl('button', {
			cls: 'iflow-mode-btn',
		});

		const currentMode = modes.find(m => m.id === this.currentMode);
		const icon = btn.createSpan({ cls: 'iflow-mode-icon', text: currentMode?.icon || '⚡' });
		const label = btn.createSpan({ cls: 'iflow-mode-label', text: currentMode?.name || 'Normal' });
		const chevron = btn.createDiv({ cls: 'iflow-mode-chevron' });
		chevron.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`;

		// Dropdown
		const dropdown = selector.createDiv({ cls: 'iflow-mode-dropdown' });

		modes.forEach(mode => {
			dropdown.createDiv({
				cls: `iflow-mode-option ${mode.id === this.currentMode ? 'selected' : ''}`,
				attr: { 'data-mode': mode.id },
			}, (el) => {
				const optIcon = el.createSpan({ cls: 'iflow-mode-icon', text: mode.icon });
				const optLabel = el.createSpan({ text: mode.name });
				el.onclick = () => {
					this.currentMode = mode.id;
					icon.textContent = mode.icon;
					label.textContent = mode.name;
					dropdown.querySelectorAll('.iflow-mode-option').forEach(opt => {
						opt.removeClass('selected');
					});
					el.addClass('selected');
				};
			});
		});

		return selector;
	}

	private createThinkingToggle(container: HTMLElement): HTMLElement {
		const toggle = container.createEl('button', {
			cls: 'iflow-thinking-toggle',
		});

		const icon = toggle.createSpan({ cls: 'iflow-thinking-icon', text: '🧠' });
		const label = toggle.createSpan({ text: 'Thinking' });

		toggle.onclick = () => {
			this.thinkingEnabled = !this.thinkingEnabled;
			toggle.toggleClass('active', this.thinkingEnabled);
		};

		return toggle;
	}

	// ============================================
	// Conversation Management
	// ============================================

	private createConversationSelector(container: HTMLElement): void {
		const selector = container.createDiv({ cls: 'iflow-conversation-selector' });

		// Current conversation trigger
		const trigger = selector.createEl('button', {
			cls: 'iflow-conversation-trigger',
		});

		this.conversationTitleEl = trigger.createSpan({
			cls: 'iflow-conversation-title',
			text: 'New Conversation',
		});

		const meta = trigger.createSpan({ cls: 'iflow-conversation-meta', text: '0 messages' });

		const chevron = trigger.createDiv({ cls: 'iflow-conversation-chevron' });
		chevron.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		`;

		// New conversation button
		const newBtn = selector.createEl('button', {
			cls: 'iflow-new-conversation-btn',
			text: '+',
		});
		newBtn.onclick = () => this.createNewConversation();

		// Conversation dropdown panel
		const panel = selector.createDiv({ cls: 'iflow-conversation-panel' });

		// Search box
		const searchBox = panel.createDiv({ cls: 'iflow-conversation-search' });
		const searchInput = searchBox.createEl('input', {
			type: 'text',
			placeholder: 'Search conversations...',
		});

		// Conversation list
		const list = panel.createDiv({ cls: 'iflow-conversation-list' });
		this.renderConversationList(list);

		// Update trigger meta
		this.updateConversationMeta(meta);

		// Store references for later updates
		(this as any).conversationPanel = panel;
		(this as any).conversationList = list;
		(this as any).conversationMeta = meta;
	}

	private renderConversationList(listContainer: HTMLElement): void {
		listContainer.empty();

		const state = this.conversationStore.getState();

		// Group conversations by date
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const todayConversations = state.conversations.filter(c => {
			const date = new Date(c.updatedAt);
			return date >= today;
		});

		if (todayConversations.length > 0) {
			const groupLabel = listContainer.createDiv({
				cls: 'iflow-conversation-group-label',
				text: 'Today',
			});

			todayConversations.forEach(conv => {
				this.renderConversationItem(listContainer, conv);
			});
		}

		if (state.conversations.length === 0) {
			listContainer.createDiv({
				cls: 'iflow-conversation-empty',
				text: 'No conversations yet',
			});
		}
	}

	private renderConversationItem(container: HTMLElement, conversation: Conversation): void {
		const item = container.createDiv({
			cls: `iflow-conversation-item ${conversation.id === this.currentConversationId ? 'active' : ''}`,
		});

		const info = item.createDiv({ cls: 'iflow-conversation-item-info' });

		const title = info.createDiv({
			cls: 'iflow-conversation-item-title',
			text: conversation.title,
		});

		const meta = info.createDiv({ cls: 'iflow-conversation-item-meta' });
		meta.createSpan({ text: `${conversation.messages.length} messages` });

		const time = item.createDiv({
			cls: 'iflow-conversation-item-time',
			text: this.formatTime(conversation.updatedAt),
		});

		// Delete button
		const deleteBtn = item.createEl('button', {
			cls: 'iflow-conversation-item-delete',
			text: '×',
		});
		deleteBtn.onclick = (e) => {
			e.stopPropagation();
			this.deleteConversation(conversation.id);
		};

		item.onclick = () => {
			this.switchConversation(conversation.id);
		};
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);

		if (diffMins < 1) return 'now';
		if (diffMins < 60) return `${diffMins}m`;
		if (diffHours < 24) return `${diffHours}h`;
		return date.toLocaleDateString();
	}

	private updateConversationMeta(meta: HTMLElement): void {
		const current = this.conversationStore.getCurrentConversation();
		if (current) {
			meta.textContent = `${current.messages.length} messages`;
		} else {
			meta.textContent = '0 messages';
		}
	}

	private onConversationChange(): void {
		// 防止在流式传输期间重新加载（会清空正在显示的消息）
		if (this.isStreaming) {
			console.log('[iFlow Chat] Skipping reload during streaming');
			// 只更新元数据，不重新加载消息
			this.updateConversationUI();
			return;
		}

		// 防止重复加载
		if (this.isLoadingMessages) {
			console.log('[iFlow Chat] Already loading, skipping');
			return;
		}

		this.isLoadingMessages = true;

		const state = this.conversationStore.getState();
		this.currentConversationId = state.currentConversationId;

		// Update title
		const current = this.conversationStore.getCurrentConversation();
		if (this.conversationTitleEl && current) {
			this.conversationTitleEl.textContent = current.title;
		}

		// Reload messages
		this.loadMessagesFromConversation();

		// Re-render list
		const list = (this as any).conversationList as HTMLElement;
		if (list) {
			this.renderConversationList(list);
		}

		// Update meta
		const meta = (this as any).conversationMeta as HTMLElement;
		if (meta) {
			this.updateConversationMeta(meta);
		}

		this.isLoadingMessages = false;
	}

	private updateConversationUI(): void {
		// 只更新元数据（标题、消息数量等），不重新加载消息
		const current = this.conversationStore.getCurrentConversation();
		if (!current) return;

		// Update title
		if (this.conversationTitleEl) {
			this.conversationTitleEl.textContent = current.title;
		}

		// Update meta
		const meta = (this as any).conversationMeta as HTMLElement;
		if (meta) {
			this.updateConversationMeta(meta);
		}

		// Re-render list (to show updated message counts)
		const list = (this as any).conversationList as HTMLElement;
		if (list) {
			this.renderConversationList(list);
		}
	}

	private createNewConversation(): void {
		const conversation = this.conversationStore.newConversation(
			this.currentModel as any,
			this.currentMode as any,
			this.thinkingEnabled
		);

		this.currentConversationId = conversation.id;
		this.messages = [];
		this.messagesContainer.empty();

		// Reset streaming state
		this.isStreaming = false;
		this.currentMessage = '';

		// Show welcome message
		this.addWelcomeMessage();

		// Update title
		if (this.conversationTitleEl) {
			this.conversationTitleEl.textContent = conversation.title;
		}

		// Re-render list
		const list = (this as any).conversationList as HTMLElement;
		if (list) {
			this.renderConversationList(list);
		}

		// Update meta
		const meta = (this as any).conversationMeta as HTMLElement;
		if (meta) {
			this.updateConversationMeta(meta);
		}
	}

	private switchConversation(conversationId: string): void {
		this.conversationStore.switchConversation(conversationId);
		// onConversationChange will be called automatically
	}

	private deleteConversation(conversationId: string): void {
		this.conversationStore.deleteConversation(conversationId);
		// onConversationChange will be called automatically
	}

	private loadMessagesFromConversation(): void {
		this.messagesContainer.empty();

		// Reset streaming state
		this.isStreaming = false;
		this.currentMessage = '';

		const current = this.conversationStore.getCurrentConversation();
		if (!current) {
			// Show welcome message if no conversation
			this.addWelcomeMessage();
			this.messages = [];
			return;
		}

		// Clear and reload messages array
		this.messages = [];

		// Load messages from conversation
		current.messages.forEach(msg => {
			this.addMessageToUI(msg.role, msg.content, msg.id);
			// Also add to messages array
			this.messages.push({ role: msg.role, content: msg.content, id: msg.id });
		});

		// Scroll to bottom
		this.scrollToBottom();
	}

	private addMessageToUI(role: string, content: string, id: string): void {
		const messageEl = this.messagesContainer.createDiv({
			cls: `iflow-message iflow-message-${role}`,
		});
		messageEl.dataset.id = id;

		const roleEl = messageEl.createDiv({ cls: 'iflow-message-role' });
		roleEl.textContent = role === 'user' ? 'You' : 'iFlow';

		const contentEl = messageEl.createDiv({ cls: 'iflow-message-content' });
		contentEl.innerHTML = this.formatMessage(content);
	}

	// ============================================
	// Update available options from iFlow CLI
	// ============================================

	updateAvailableModels(models: any[]): void {
		this.availableModels = models;
		// Rebuild model selector UI
		// TODO: Implement UI refresh
	}

	updateAvailableModes(modes: any[]): void {
		this.availableModes = modes;
		// Rebuild mode selector UI
		// TODO: Implement UI refresh
	}

	// Properties for type safety
	private messagesContainer: HTMLElement;
	private textarea: HTMLTextAreaElement;
	private contextIndicator: HTMLElement;
	private currentFile: TFile | null = null;
}
