import { Notice } from 'obsidian';

// JSON Canvas types and interfaces
interface CanvasNode {
	id: string;
	type: 'text' | 'file' | 'link' | 'group';
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
	text?: string;
	file?: string;
	subpath?: string;
	url?: string;
	label?: string;
	background?: string;
	backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	fromSide?: 'top' | 'right' | 'bottom' | 'left';
	toSide?: 'top' | 'right' | 'bottom' | 'left';
	fromEnd?: 'none' | 'arrow';
	toEnd?: 'none' | 'arrow';
	color?: string;
	label?: string;
}

interface CanvasData {
	nodes?: CanvasNode[];
	edges?: CanvasEdge[];
}

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
	status?: 'running' | 'completed' | 'error';
	result?: any;
	error?: string;
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

	/** Registered handlers for server-initiated requests (have an id). */
	private readonly serverMethodHandlers = new Map<string, (id: number, params: any) => Promise<any>>();

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

	/**
	 * Register a handler for server-initiated requests (has both id and method).
	 */
	onServerMethod(method: string, handler: (id: number, params: any) => Promise<any>): void {
		this.serverMethodHandlers.set(method, handler);
	}

	/**
	 * Send a result response to a server-initiated request.
	 */
	private sendResult(id: number, result: any): void {
		const response: JsonRpcResponse = {
			jsonrpc: '2.0',
			id,
			result,
		};
		this.send(JSON.stringify(response));
	}

	/**
	 * Send an error response to a server-initiated request.
	 */
	private sendError(id: number, code: number, message: string): void {
		const response: JsonRpcResponse = {
			jsonrpc: '2.0',
			id,
			error: { code, message },
		};
		this.send(JSON.stringify(response));
	}

	handleMessage(data: string): JsonRpcResponse | JsonRpcNotification | null {
		// Skip debug/non-JSON messages
		const trimmed = data.trim();
		if (!trimmed || trimmed.startsWith('//')) {
			return null;
		}

		try {
			const message = JSON.parse(trimmed) as any;
			const id = message.id as number | undefined;
			const method = message.method as string | undefined;

			// Case 1: Response to a client-initiated request (has id, no method)
			if (id !== undefined && !method) {
				const pending = this.pendingRequests.get(id);
				if (pending) {
					this.pendingRequests.delete(id);
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

			// Case 2: Server-initiated request (has both id and method)
			if (id !== undefined && method) {
				const handler = this.serverMethodHandlers.get(method);
				if (handler) {
					// Handle asynchronously and send response
					handler(id, message.params)
						.then((result) => this.sendResult(id, result))
						.catch((err: Error) => this.sendError(id, -32603, err.message));
				} else {
					console.warn(`[iFlow] No handler for server method: ${method}`);
					this.sendError(id, -32601, `Method not found: ${method}`);
				}
				return message;
			}

			// Case 3: Notification (has method but no id)
			if (method && id === undefined) {
				return message as JsonRpcNotification;
			}

			console.warn('[iFlow] Unroutable message:', message);
			return null;
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

		// Build session settings similar to VSCode plugin
		// IMPORTANT: permission_mode is required for tool calling to work
		const sessionSettings: Record<string, unknown> = {
			permission_mode: 'default', // Required for tools to work
			append_system_prompt: `IMPORTANT: When generating structured content like learning roadmaps, diagrams, knowledge graphs, or similar content:
1. Use the fs/write_text_file tool to create a file automatically
2. For visual roadmaps and diagrams, create an Obsidian Canvas file (.canvas extension)
3. Do NOT output large JSON structures as text - create files instead
4. Use descriptive filenames based on the content (e.g., "golang-learning-roadmap.canvas")
5. After creating the file, provide a brief summary of what was created`,
			add_dirs: [cwd], // Allow access to vault directory
		};

		const sessionResult = await this.protocol.sendRequest('session/new', {
			cwd,
			mcpServers: [],
			settings: sessionSettings,
		}) as { sessionId?: string };

		if (!sessionResult.sessionId) {
			throw new Error('Failed to create session');
		}

		this.sessionId = sessionResult.sessionId;
		console.log('ACP session created:', this.sessionId);

		// Register server method handlers
		this.registerServerHandlers();
	}

	private registerServerHandlers(): void {
		if (!this.protocol) return;

		// Automatically approve all permission requests for local Obsidian plugin
		this.protocol.onServerMethod('session/request_permission', async (_id: number, params: any) => {
			console.log('[iFlow] Permission request:', params);

			// Return the first option (usually "proceed_always" or similar)
			if (params?.options && params.options.length > 0) {
				const firstOption = params.options[0];
				console.log('[iFlow] Permission approved:', firstOption.optionId);
				return firstOption.optionId;
			}

			// Fallback: return a default approval
			return 'proceed_always';
		});

		// File system: read text file
		this.protocol.onServerMethod('fs/read_text_file', async (_id: number, params: any) => {
			console.log('[iFlow] fs/read_text_file:', params);
			try {
				if (!params || typeof params.path !== 'string') {
					return { error: 'Invalid params: path is required' };
				}

				const vaultPath = this.getVaultPath();
				const relativePath = this.getAbsolutePath(params.path, vaultPath);

				// Use Obsidian's vault API to read the file
				const content = await this.app.vault.read(relativePath);
				console.log('[iFlow] File read successfully:', relativePath);
				return { content };
			} catch (error: any) {
				console.error('[iFlow] fs/read_text_file error:', error);
				return { error: error.message || 'Failed to read file' };
			}
		});

		// File system: write text file
		this.protocol.onServerMethod('fs/write_text_file', async (_id: number, params: any) => {
			console.log('[iFlow] fs/write_text_file:', params);
			try {
				if (!params || typeof params.path !== 'string' || typeof params.content !== 'string') {
					return { error: 'Invalid params: path and content are required' };
				}

				const vaultPath = this.getVaultPath();
				const relativePath = this.getAbsolutePath(params.path, vaultPath);

				// Special handling for canvas files
				if (this.isCanvasFile(relativePath)) {
					console.log('[iFlow] Creating canvas file:', relativePath);
					// Normalize canvas content to ensure valid JSON structure
					const canvasContent = this.normalizeCanvasContent(params.content);

					// Check if file already exists
					const existingFile = this.app.vault.getAbstractFileByPath(relativePath);
					if (existingFile) {
						const file = this.app.vault.getFileByPath(relativePath);
						if (file) {
							await this.app.vault.modify(file, canvasContent);
							console.log('[iFlow] Canvas file modified successfully:', relativePath);
						} else {
							await this.app.vault.adapter.write(relativePath, canvasContent);
							console.log('[iFlow] Canvas file written successfully (via adapter):', relativePath);
						}
					} else {
						await this.app.vault.create(relativePath, canvasContent);
						console.log('[iFlow] Canvas file created successfully:', relativePath);
					}
					return null;
				}

				// Regular file handling
				const existingFile = this.app.vault.getAbstractFileByPath(relativePath);

				if (existingFile) {
					// File exists - use modify to update it
					// getFileByPath is synchronous and returns TFile | null
					const file = this.app.vault.getFileByPath(relativePath);
					if (file) {
						await this.app.vault.modify(file, params.content);
						console.log('[iFlow] File modified successfully:', relativePath);
					} else {
						// Fallback to adapter if getFileByPath fails
						await this.app.vault.adapter.write(relativePath, params.content);
						console.log('[iFlow] File written successfully (via adapter):', relativePath);
					}
				} else {
					// File doesn't exist - create new file
					await this.app.vault.create(relativePath, params.content);
					console.log('[iFlow] File created successfully:', relativePath);
				}

				return null; // Success, no error
			} catch (error: any) {
				console.error('[iFlow] fs/write_text_file error:', error);
				return { error: error.message || 'Failed to write file' };
			}
		});
	}

	/**
	 * Get the vault path from Obsidian app
	 */
	private getVaultPath(): string {
		const basePath = (this.app as any)?.vault?.adapter?.basePath || '';
		return basePath.replace(/\/$/, ''); // Remove trailing slash
	}

	/**
	 * Convert absolute path to vault-relative path if needed
	 * If the path is already relative, return it as-is
	 * If the path is absolute, make it relative to vault
	 */
	private getAbsolutePath(filePath: string, vaultPath: string): string {
		// If the path starts with vault path (with leading slash), extract the relative part
		if (filePath.startsWith(vaultPath + '/')) {
			filePath = filePath.substring(vaultPath.length + 1); // +1 to skip the slash
			return filePath;
		}

		// Remove leading slash if present (Obsidian paths don't start with /)
		if (filePath.startsWith('/')) {
			filePath = filePath.substring(1);
		}

		// If the path starts with vault path (without leading slash), extract the relative part
		if (filePath.startsWith(vaultPath)) {
			filePath = filePath.substring(vaultPath.length);
			if (filePath.startsWith('/')) {
				filePath = filePath.substring(1);
			}
		}

		return filePath;
	}

	/**
	 * Check if a file is a canvas file
	 */
	private isCanvasFile(filePath: string): boolean {
		return filePath.endsWith('.canvas');
	}

	/**
	 * Generate a basic canvas file structure for AI to use as template
	 */
	private generateBasicCanvas(content?: string): string {
		const canvasData: CanvasData = {
			nodes: [
				{
					id: this.generateId(),
					type: 'text',
					x: 0,
					y: 0,
					width: 250,
					height: 100,
					text: content || '新节点 - 双击编辑文本'
				}
			],
			edges: []
		};
		return JSON.stringify(canvasData, null, '\t');
	}

	/**
	 * Generate a random ID for canvas nodes/edges
	 */
	private generateId(): string {
		return Math.random().toString(36).substring(2, 15);
	}

	/**
	 * Try to parse and validate canvas JSON, if fails return valid basic structure
	 */
	private normalizeCanvasContent(content: string): string {
		try {
			const parsed = JSON.parse(content);
			// Basic validation - check if it has nodes or edges array
			if (parsed && (parsed.nodes || parsed.edges)) {
				return JSON.stringify(parsed, null, '\t');
			}
		} catch (e) {
			// Content is not valid JSON, create a canvas with the content as text
			console.log('[iFlow] Invalid canvas JSON, creating basic canvas with content');
		}
		// Return basic canvas structure with content as first node
		return this.generateBasicCanvas(content);
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

		// Handle JSON-RPC notifications (no id)
		if (!('id' in message)) {
			const notification = message as JsonRpcNotification;
			console.log('[iFlow] Notification:', notification.method);

			// Handle session/update notifications (stream content)
			if (notification.method === 'session/update') {
				const update = notification.params?.update;
				console.log('[iFlow] Update type:', update?.sessionUpdate);
				if (update && typeof update === 'object') {

					// Check for tool_use content type
					const content = update.content;
					if (content && typeof content === 'object') {
						// Handle tool_use
						if (content.type === 'tool_use') {
							console.log('[iFlow] Tool use detected:', content.name);
							this.messageHandlers.forEach(handler => handler({
								type: 'tool',
								data: {
									id: content.id || content.tool_use_id || Date.now().toString(),
									name: content.name,
									input: content.input || content.arguments,
									status: 'running',
								} as IFlowToolCall,
							}));
						}
						// Handle tool_result
						else if (content.type === 'tool_result') {
							console.log('[iFlow] Tool result:', content.tool_use_id);
							this.messageHandlers.forEach(handler => handler({
								type: 'tool',
								data: {
									id: content.tool_use_id || content.id,
									name: content.tool_name || 'unknown',
									input: {},
									status: content.error ? 'error' : 'completed',
									result: content.result || content.content,
									error: content.error,
								} as IFlowToolCall,
							}));
						}
						// Handle text content (default)
						else {
							const textContent = this.extractContentFromUpdate(update);
							if (textContent) {
								console.log('[iFlow] Content:', textContent.substring(0, 100));
								this.messageHandlers.forEach(handler => handler({
									type: 'stream',
									content: textContent,
								}));
							}
						}
					} else {
						// Legacy content handling
						const textContent = this.extractContentFromUpdate(update);
						if (textContent) {
							console.log('[iFlow] Content:', textContent.substring(0, 100));
							this.messageHandlers.forEach(handler => handler({
								type: 'stream',
								content: textContent,
							}));
						}
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

		// Detect if user wants to create a canvas file
		const wantsCanvas = /canvas|思维导图|流程图|导图|可视化|graph|map|flowchart/i.test(prompt);

		if (wantsCanvas) {
			// Add Canvas format guidance when user wants to create visual content
			const canvasGuidance = `
## 🚨 CRITICAL: 必须调用工具创建文件！

用户想要创建 Canvas 文件。你必须：

### ✅ 正确做法（必须执行）：
1. 立即调用 \`fs/write_text_file\` 工具
2. 文件名：从用户请求中提取（例如："未命名 2.canvas"）
3. 文件内容：完整的 JSON Canvas 1.0 格式

### ❌ 禁止行为：
- **绝对不要**在聊天中输出 JSON 代码块
- **绝对不要**告诉用户"你可以手动创建文件"
- **绝对不要**说"请复制以下内容"

### 🛠️ 你有这些工具可用：
- \`fs/write_text_file(path, content)\` - 创建或覆盖文件
- \`fs/read_text_file(path)\` - 读取文件内容
- **你必须使用这些工具来创建文件，而不是输出文本！**

### 📋 JSON Canvas 1.0 格式：

\`\`\`json
{
  "nodes": [
    {
      "id": "唯一ID",
      "type": "text|file|link|group",
      "x": 0,
      "y": 0,
      "width": 250,
      "height": 100,
      "text": "节点内容（type=text时）",
      "color": "1-6"
    }
  ],
  "edges": [
    {
      "id": "唯一ID",
      "fromNode": "起始节点ID",
      "toNode": "目标节点ID",
      "fromSide": "top|right|bottom|left",
      "toSide": "top|right|bottom|left",
      "label": "连线标签"
    }
  ]
}
\`\`\`

### 💡 完整工作流程示例：

用户请求："创建一个思维导图"
你的操作：
1. 调用 fs/write_text_file 工具
2. 参数：{"path": "思维导图.canvas", "content": "{\\"nodes\\":[...],\\"edges\\":[...]}"}
3. 完成后告诉用户："Canvas 文件已创建成功！"

### 📝 布局建议：
- 主节点放在中心 (x=0, y=0)
- 子节点向四周扩散
- 使用颜色区分不同类型的内容
- 用 edges 连接相关节点

---

**现在处理用户的请求，立即调用工具创建文件！**

`;
			prompt = canvasGuidance + '\n\n' + prompt;
		}

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
