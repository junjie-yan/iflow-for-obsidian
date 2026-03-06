import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import IFlowPlugin from './main';
import { IFlowService } from './iflowService';
import type { IFlowSettings } from './main';

export const VIEW_TYPE_IFLOW_CHAT = 'iflow-chat-view';

export class IFlowChatView extends ItemView {
	plugin: IFlowPlugin;
	iflowService: IFlowService;
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

	constructor(leaf: WorkspaceLeaf, plugin: IFlowPlugin, iflowService: IFlowService) {
		super(leaf);
		this.plugin = plugin;
		this.iflowService = iflowService;
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

		// Add welcome message
		this.addWelcomeMessage();
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

	private async sendMessage() {
		const content = this.textarea.value.trim();
		if (!content || this.isStreaming) {
			return;
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

		// Add user message
		this.addMessage('user', content);
		this.textarea.value = '';

		// Add assistant message placeholder
		const assistantMsgId = this.addMessage('assistant', '');
		this.currentMessage = '';
		this.isStreaming = true;

		// Scroll to bottom
		if (this.plugin.settings.enableAutoScroll) {
			this.scrollToBottom();
		}

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
					this.isStreaming = false;
				},
				onError: (error: string) => {
					this.isStreaming = false;
					this.updateMessage(assistantMsgId, `Error: ${error}`);
				},
			});
		} catch (error) {
			this.isStreaming = false;
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
