import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import { IFlowService } from './iflowService';
import { IFlowChatView, VIEW_TYPE_IFLOW_CHAT } from './chatView';

export { IFlowPlugin };
export type { IFlowSettings };

interface IFlowSettings {
	iflowPort: number;
	iflowTimeout: number;
	enableAutoScroll: boolean;
	excludedTags: string[];
}

const DEFAULT_SETTINGS: IFlowSettings = {
	iflowPort: 8090,
	iflowTimeout: 60000,
	enableAutoScroll: true,
	excludedTags: ['private', 'sensitive'],
}

export default class IFlowPlugin extends Plugin {
	settings: IFlowSettings;
	iflowService: IFlowService;
	chatView: IFlowChatView | null = null;

	async onload() {
		console.log('Loading iFlow for Obsidian plugin');

		// Load settings
		await this.loadSettings();

		// Initialize iFlow service
		this.iflowService = new IFlowService(this.settings.iflowPort, this.settings.iflowTimeout, this.app);

		// Register sidebar view
		this.registerView(
			VIEW_TYPE_IFLOW_CHAT,
			(leaf) => (this.chatView = new IFlowChatView(leaf, this, this.iflowService))
		);

		// Add ribbon icon
		this.addRibbonIcon('message-square', 'Open iFlow Chat', () => {
			this.activateView();
		});

		// Add command to open chat
		this.addCommand({
			id: 'open-iflow-chat',
			name: 'Open iFlow Chat',
			callback: () => this.activateView(),
		});

		// Add command to open chat with selected text
		this.addCommand({
			id: 'open-iflow-chat-with-selection',
			name: 'Open iFlow Chat with Selection',
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const selection = activeView?.editor?.getSelection();

				if (selection) {
					if (!checking) {
						this.activateView();
					}
					return true;
				}
				return false;
			},
		});

		// Add settings tab
		this.addSettingTab(new IFlowSettingTab(this.app, this));

		// Auto-open chat view on load if previously open
		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		});
	}

	onunload() {
		console.log('Unloading iFlow for Obsidian plugin');
		this.iflowService.dispose();
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_IFLOW_CHAT);

		if (leaves.length > 0) {
			// Already open, just reveal
			leaf = leaves[0];
		} else {
			// Open in right sidebar
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_IFLOW_CHAT, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update iFlow service with new settings
		this.iflowService.updateConfig(this.settings.iflowPort, this.settings.iflowTimeout);
	}

	getActiveFile(): TFile | null {
		return this.app.workspace.getActiveFile();
	}

	getVaultPath(): string {
		// @ts-ignore - adapter is available but not in types
		return this.app.vault.adapter.basePath;
	}
}

class IFlowSettingTab extends PluginSettingTab {
	plugin: IFlowPlugin;

	constructor(app: App, plugin: IFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('iFlow CLI WebSocket Port')
			.setDesc('The port number that iFlow CLI is listening on (default: 8090)')
			.addText(text => text
				.setValue(String(this.plugin.settings.iflowPort))
				.onChange(async (value) => {
					const port = parseInt(value);
					if (!isNaN(port) && port > 0 && port < 65536) {
						this.plugin.settings.iflowPort = port;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Connection Timeout (ms)')
			.setDesc('Timeout for connecting to iFlow CLI (default: 60000)')
			.addText(text => text
				.setValue(String(this.plugin.settings.iflowTimeout))
				.onChange(async (value) => {
					const timeout = parseInt(value);
					if (!isNaN(timeout) && timeout > 0) {
						this.plugin.settings.iflowTimeout = timeout;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Enable Auto Scroll')
			.setDesc('Automatically scroll to bottom during streaming responses')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoScroll)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoScroll = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Excluded Tags')
			.setDesc('Notes with these tags will not be automatically attached to conversations (comma-separated)')
			.addText(text => text
				.setValue(this.plugin.settings.excludedTags.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.excludedTags = value
						.split(',')
						.map(tag => tag.trim())
						.filter(tag => tag.length > 0);
					await this.plugin.saveSettings();
				}));

		// Add info about iFlow CLI
		containerEl.createEl('h3', { text: 'iFlow CLI Requirements' });
		containerEl.createEl('p', {
			text: 'This plugin requires iFlow CLI to be installed and running. ' +
				  'Install it with: npm install -g @iflow-ai/iflow-cli@latest'
		});

		// Connection status
		const statusDiv = containerEl.createEl('div', { cls: 'iflow-status' });
		statusDiv.createEl('p', { text: 'Connection Status: ' });
		const statusText = statusDiv.createEl('span', { cls: 'iflow-status-text' });
		statusText.textContent = 'Checking...';

		// Check connection
		this.plugin.iflowService.checkConnection().then(connected => {
			statusText.textContent = connected ? '✓ Connected' : '✗ Disconnected';
			statusText.className = 'iflow-status-text ' + (connected ? 'connected' : 'disconnected');
		});
	}
}
