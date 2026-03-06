import { Notice } from 'obsidian';

// JSON-RPC 2.0 interfaces
interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number | string;
	method: string;
	params?: any;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number | string;
	result?: any;
	error?: {
		code: number;
		message: string;
		data?: any;
	};
}

interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: any;
}

export interface IFlowMessage {
	type: 'stream' | 'tool' | 'question' | 'plan' | 'error' | 'end';
	content?: string;
	data?: any;
}

export interface IFlowToolCall {
	id: string;
	name: string;
	input: any;
}

export interface SendMessageOptions {
	content: string;
	filePath?: string;
	fileContent?: string;
	selection?: string;
	model?: string;
	mode?: string;
	thinkingEnabled?: boolean;
	onChunk?: (chunk: string) => void;
	onTool?: (tool: IFlowToolCall) => void;
	onEnd?: () => void;
	onError?: (error: string) => void;
}

class AcpProtocol {
	private messageId = 0;
	private pendingRequests = new Map<number | string, {
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	}>();

	constructor(private send: (message: string) => void) {}

	sendRequest(method: string, params?: any): Promise<any> {
		const id = this.messageId++;
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id,
			method,
			...(params !== undefined ? { params } : {}),
		};

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			try {
				this.send(JSON.stringify(request));
			} catch (error) {
				this.pendingRequests.delete(id);
				reject(error);
			}
		});
	}

	handleMessage(data: string): JsonRpcResponse | JsonRpcNotification | null {
		// Skip debug/non-JSON messages
		const trimmed = data.trim();
		if (!trimmed || trimmed.startsWith('//')) {
			return null;
		}

		try {
			const message = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;

			// Handle response
			if ('id' in message && typeof message.id !== 'undefined') {
				const pending = this.pendingRequests.get(message.id);
				if (pending) {
					this.pendingRequests.delete(message.id);
					if (message.error) {
						pending.reject(new Error(message.error.message));
					} else {
						// Check for end_turn in result
						if (message.result?.stopReason === 'end_turn') {
							// Notify that the stream is complete
							console.log('[iFlow] Stream complete (end_turn)');
						}
						pending.resolve(message.result);
					}
				}
				return message;
			}

			// Handle notification
			return message;
		} catch (error) {
			console.error('Failed to parse ACP message:', error);
			return null;
		}
	}

	clearPendingRequests(): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(new Error('Connection closed'));
		}
		this.pendingRequests.clear();
	}
}

export class IFlowService {
	private port: number;
	private timeout: number;
	private ws: WebSocket | null = null;
	private reconnectTimer: any = null;
	private messageHandlers: ((msg: IFlowMessage) => void)[] = [];
	private isConnected: boolean = false;
	private protocol: AcpProtocol | null = null;
	private sessionId: string | null = null;
	private app: any; // Obsidian App instance

	constructor(port: number, timeout: number, app?: any) {
		this.port = port;
		this.timeout = timeout;
		this.app = app;
	}

	async checkConnection(): Promise<boolean> {
		return new Promise((resolve) => {
			const ws = new WebSocket(`ws://localhost:${this.port}/acp`);

			const timeoutId = setTimeout(() => {
				ws.close();
				resolve(false);
			}, this.timeout);

			ws.onopen = () => {
				clearTimeout(timeoutId);
				ws.close();
				resolve(true);
			};

			ws.onerror = () => {
				clearTimeout(timeoutId);
				resolve(false);
			};
		});
	}

	async connect(): Promise<void> {
		if (this.ws && this.ws.readyState === WebSocket.OPEN && this.protocol) {
			return;
		}

		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(`ws://localhost:${this.port}/acp`);

			const timeoutId = setTimeout(() => {
				this.ws?.close();
				reject(new Error('Connection timeout'));
			}, this.timeout);

			this.ws.onopen = async () => {
				clearTimeout(timeoutId);
				console.log('iFlow WebSocket connected');

				// Initialize ACP protocol
				this.protocol = new AcpProtocol((msg) => {
					if (this.ws && this.ws.readyState === WebSocket.OPEN) {
						this.ws.send(msg);
					}
				});

				try {
					// Initialize connection
					await this.initializeConnection();
					this.isConnected = true;
					resolve();
				} catch (error) {
					reject(error);
				}
			};

			this.ws.onmessage = (event: MessageEvent) => {
				this.handleIncomingMessage(event.data);
			};

			this.ws.onerror = (error: Event) => {
				clearTimeout(timeoutId);
				console.error('iFlow WebSocket error:', error);
				reject(new Error('WebSocket connection failed'));
			};

			this.ws.onclose = () => {
				this.isConnected = false;
				this.sessionId = null;
				this.protocol?.clearPendingRequests();
				console.log('iFlow WebSocket disconnected');

				// Attempt to reconnect after 5 seconds
				if (this.reconnectTimer) {
					clearTimeout(this.reconnectTimer);
				}
				this.reconnectTimer = setTimeout(() => {
					this.connect().catch(err => {
						console.error('Reconnection failed:', err);
					});
				}, 5000);
			};
		});
	}

	private async initializeConnection(): Promise<void> {
		if (!this.protocol) {
			throw new Error('Protocol not initialized');
		}

		// Initialize ACP
		const initResult = await this.protocol.sendRequest('initialize', {
			protocolVersion: 1,
			clientCapabilities: {
				fs: {
					readTextFile: true,
					writeTextFile: true,
				},
			},
		}) as { isAuthenticated?: boolean };

		// Authenticate if needed
		if (!initResult.isAuthenticated) {
			try {
				await this.protocol.sendRequest('authenticate', { methodId: 'oauth-iflow' });
				console.log('Authenticated with oauth-iflow');
			} catch (error) {
				console.error('Authentication failed:', error);
				throw new Error('Authentication failed');
			}
		}

		// Create new session - use user's home directory as workspace
		// In browser, we can't access process, so use Obsidian's vault path
		const cwd = (this.app as any)?.vault?.adapter?.basePath?.replace(/\/$/, '') || '/Users/jie';
		const sessionResult = await this.protocol.sendRequest('session/new', {
			cwd,
			mcpServers: [],
			settings: {},
		}) as { sessionId?: string };

		if (!sessionResult.sessionId) {
			throw new Error('Failed to create session');
		}

		this.sessionId = sessionResult.sessionId;
		console.log('ACP session created:', this.sessionId);
	}

	private handleIncomingMessage(data: string): void {
		if (!this.protocol) return;

		// Log all incoming messages for debugging
		const trimmed = data.trim();
		if (!trimmed.startsWith('//')) {
			console.log('[iFlow] Received message:', trimmed.substring(0, 200));
		}

		const message = this.protocol.handleMessage(data);

		if (!message) {
			return;
		}

		// Handle JSON-RPC notifications
		if (!('id' in message)) {
			const notification = message as JsonRpcNotification;
			console.log('[iFlow] Notification:', notification.method);

			// Handle session/update notifications (stream content)
			if (notification.method === 'session/update') {
				const update = notification.params?.update;
				console.log('[iFlow] Update type:', update?.sessionUpdate);
				if (update && typeof update === 'object') {
					const content = this.extractContentFromUpdate(update);
					if (content) {
						console.log('[iFlow] Content:', content.substring(0, 100));
						this.messageHandlers.forEach(handler => handler({
							type: 'stream',
							content,
						}));
					}

					// Check for end signal - ACP sends task_finish or completion
					if (update.sessionUpdate === 'task_finish' ||
						update.status === 'done' ||
						update.done ||
						update.sessionUpdate === 'agent_turn_end') {
						console.log('[iFlow] Task finished');
						this.messageHandlers.forEach(handler => handler({
							type: 'end',
						}));
					}
				}
			}
		}
	}

	private extractContentFromUpdate(update: any): string | null {
		// ACP session/update format: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '...' } }
		if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') {
			const content = update.content;
			if (content && typeof content === 'object') {
				// Standard ACP format
				if (content.type === 'text' && typeof content.text === 'string') {
					return content.text;
				}
				// Direct text field
				if (typeof content.text === 'string') {
					return content.text;
				}
			}
		}

		// Legacy/direct formats
		if (typeof update === 'string') {
			return update;
		}

		if (update.content?.type === 'text') {
			return update.content.text || '';
		}

		if (update.content?.text) {
			return update.content.text;
		}

		if (update.text) {
			return update.text;
		}

		if (update.delta?.text) {
			return update.delta.text;
		}

		if (update.message?.content) {
			return update.message.content;
		}

		return null;
	}

	async sendMessage(options: SendMessageOptions): Promise<void> {
		if (!this.isConnected || !this.protocol || !this.sessionId) {
			await this.connect();
		}

		// Apply runtime settings (mode, model, thinking) before sending prompt
		if (options.mode) {
			try {
				await this.protocol.sendRequest('session/set_mode', {
					sessionId: this.sessionId,
					modeId: options.mode,
				});
				console.log(`[iFlow] Mode set to: ${options.mode}`);
			} catch (error) {
				console.warn(`[iFlow] Failed to set mode: ${error}`);
			}
		}

		if (options.model) {
			try {
				await this.protocol.sendRequest('session/set_model', {
					sessionId: this.sessionId,
					modelId: options.model,
				});
				console.log(`[iFlow] Model set to: ${options.model}`);
			} catch (error) {
				console.warn(`[iFlow] Failed to set model: ${error}`);
			}
		}

		if (options.thinkingEnabled !== undefined) {
			try {
				const thinkPayload: any = {
					sessionId: this.sessionId,
					thinkEnabled: options.thinkingEnabled,
				};
				if (options.thinkingEnabled) {
					thinkPayload.thinkConfig = 'think';
				}
				await this.protocol.sendRequest('session/set_think', thinkPayload);
				console.log(`[iFlow] Thinking set to: ${options.thinkingEnabled}`);
			} catch (error) {
				console.warn(`[iFlow] Failed to set thinking: ${error}`);
			}
		}

		// Build prompt with context
		let prompt = options.content;
		if (options.filePath || options.fileContent) {
			prompt = `User is working on: ${options.filePath || 'unnamed file'}\n\n`;
			if (options.selection) {
				prompt += `Selected text:\n${options.selection}\n\n`;
			}
			prompt += `User message: ${options.content}`;
		}

		// Register one-time handlers for this message
		const cleanup = () => {
			this.off('stream', options.onChunk);
			this.off('tool', options.onTool);
			this.off('end', options.onEnd);
			this.off('error', options.onError);
		};

		if (options.onChunk) this.on('stream', options.onChunk);
		if (options.onTool) this.on('tool', options.onTool);
		if (options.onEnd) this.on('end', () => {
			options.onEnd?.();
			cleanup();
		});
		if (options.onError) this.on('error', () => {
			options.onError?.('Connection error');
			cleanup();
		});

		// Send prompt request
		try {
			const result = await this.protocol.sendRequest('session/prompt', {
				sessionId: this.sessionId,
				prompt: [{ type: 'text', text: prompt }],
			});

			// Check if the response indicates completion
			if (result?.stopReason === 'end_turn' || result?.stopReason === 'max_turns') {
				console.log('[iFlow] Prompt completed with stopReason:', result.stopReason);
				// Trigger onEnd callback when stream completes normally
				this.messageHandlers.forEach(handler => handler({
					type: 'end',
				}));
			}
		} catch (error) {
			new Notice(`Failed to send message: ${error}`);
			cleanup();
		}
	}

	on(type: string, handler: any): void {
		this.messageHandlers.push((msg: IFlowMessage) => {
			if (msg.type === type) {
				handler(msg.content || msg.data);
			}
		});
	}

	off(type: string, handler: any): void {
		this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
	}

	updateConfig(port: number, timeout: number): void {
		const portChanged = this.port !== port;
		const timeoutChanged = this.timeout !== timeout;

		this.port = port;
		this.timeout = timeout;

		if (portChanged && this.ws) {
			this.ws.close();
			this.isConnected = false;
		}
	}

	dispose(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		this.protocol?.clearPendingRequests();
		if (this.ws) {
			this.ws.close();
		}
		this.messageHandlers = [];
	}
}
