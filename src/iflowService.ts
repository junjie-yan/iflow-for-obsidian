import { Notice } from 'obsidian';

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
	onChunk?: (chunk: string) => void;
	onTool?: (tool: IFlowToolCall) => void;
	onEnd?: () => void;
	onError?: (error: string) => void;
}

export class IFlowService {
	private port: number;
	private timeout: number;
	private ws: WebSocket | null = null;
	private reconnectTimer: any = null;
	private messageHandlers: ((msg: IFlowMessage) => void)[] = [];
	private isConnected: boolean = false;

	constructor(port: number, timeout: number) {
		this.port = port;
		this.timeout = timeout;
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

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				resolve();
				return;
			}

			this.ws = new WebSocket(`ws://localhost:${this.port}/acp`);

			const timeoutId = setTimeout(() => {
				this.ws?.close();
				reject(new Error('Connection timeout'));
			}, this.timeout);

			this.ws.onopen = () => {
				clearTimeout(timeoutId);
				this.isConnected = true;
				console.log('iFlow WebSocket connected');
				resolve();
			};

			this.ws.onmessage = (event: MessageEvent) => {
				try {
					const messages = event.data.toString().split('\n').filter(line => line.trim());
					for (const line of messages) {
						const msg = JSON.parse(line) as IFlowMessage;
						this.messageHandlers.forEach(handler => handler(msg));
					}
				} catch (error) {
					console.error('Failed to parse iFlow message:', error);
				}
			};

			this.ws.onerror = (error: Event) => {
				clearTimeout(timeoutId);
				console.error('iFlow WebSocket error:', error);
				reject(new Error('WebSocket connection failed'));
			};

			this.ws.onclose = () => {
				this.isConnected = false;
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

	async sendMessage(options: SendMessageOptions): Promise<void> {
		if (!this.isConnected || !this.ws) {
			await this.connect();
		}

		// Construct message for iFlow CLI
		const message = {
			type: 'chat',
			content: options.content,
			context: {
				filePath: options.filePath,
				fileContent: options.fileContent,
				selection: options.selection,
			},
		};

		// Register one-time handlers for this message
		const cleanup = () => {
			this.off('chunk', options.onChunk);
			this.off('tool', options.onTool);
			this.off('end', options.onEnd);
			this.off('error', options.onError);
		};

		if (options.onChunk) this.on('chunk', options.onChunk);
		if (options.onTool) this.on('tool', options.onTool);
		if (options.onEnd) this.on('end', () => {
			options.onEnd?.();
			cleanup();
		});
		if (options.onError) this.on('error', () => {
			options.onError?.('Connection error');
			cleanup();
		});

		// Send message
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		} else {
			new Notice('Not connected to iFlow CLI');
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
		if (this.ws) {
			this.ws.close();
		}
		this.messageHandlers = [];
	}
}
