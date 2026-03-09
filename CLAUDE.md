# CLAUDE.md - iFlow for Obsidian

## Project Overview

iFlow for Obsidian - An Obsidian plugin that embeds iFlow CLI as a sidebar chat interface. The vault directory becomes iFlow's working directory, giving it full agentic capabilities: file read/write, bash commands, and multi-step workflows.

## Commands

```bash
npm run dev        # Development (watch mode, auto-compile)
npm run build      # Production build
npm run version    # Bump version and update files
```

## Architecture

### File Structure

```
src/
├── main.ts                 # Plugin entry point, settings management
├── chatView.ts             # Chat view UI, core interaction logic ⭐ CORE
├── iflowService.ts         # iFlow CLI WebSocket communication (ACP protocol) ⭐ CORE
├── conversationStore.ts    # Conversation persistence with vault isolation ⭐ CORE
└── styles.css              # Plugin styles
```

### Key Components

| Component | Purpose | Key Details |
|-----------|---------|-------------|
| **IFlowPlugin** (main.ts) | Plugin lifecycle, settings | Manages ribbon icon, view registration, settings UI |
| **IFlowChatView** (chatView.ts) | Chat UI and message handling | Handles streaming, scrolling, conversation switching, export/import |
| **IFlowService** (iflowService.ts) | WebSocket communication | ACP protocol (JSON-RPC 2.0), manages connection |
| **ConversationStore** (conversationStore.ts) | Data persistence | Vault-isolated localStorage, pub/sub, export/import |

## Critical Technical Details

### ACP Protocol (Agent Communication Protocol)

iFlow CLI uses JSON-RPC 2.0 over WebSocket:

```
1. WebSocket connect → ws://localhost:8080/acp
2. initialize → { protocolVersion: 1, clientCapabilities: {...} }
3. authenticate → { methodId: 'oauth-iflow' } (if needed)
4. session/new → { cwd, mcpServers: [], settings: {} }
5. session/prompt → { prompt: [{ type: 'text', text: '...' }] }
6. Receive session/update notifications (streaming chunks)
7. Final response has stopReason: 'end_turn' or 'max_turns'
```

**IMPORTANT:** The `onEnd` callback MUST be triggered when `stopReason` is detected:

```typescript
// In iflowService.ts sendMessage() - line ~450
if (result?.stopReason === 'end_turn' || result?.stopReason === 'max_turns') {
    this.messageHandlers.forEach(handler => handler({ type: 'end' }));
}
```

### Streaming State Management

The `isStreaming` flag is CRITICAL for preventing bugs:

```typescript
// In chatView.ts
private isStreaming = false;

private async sendMessage() {
    // Force reset if stuck (prevents "can't send second message" bug)
    if (this.isStreaming) {
        console.warn('[iFlow Chat] Force reset');
        this.isStreaming = false;
    }

    this.isStreaming = true;

    // Set timeout protection (60 seconds)
    this.streamingTimeout = setTimeout(() => {
        this.isStreaming = false; // Force reset if onEnd never called
    }, 60000);

    await this.iflowService.sendMessage({
        onChunk: (chunk) => {
            this.currentMessage += chunk;
            this.updateMessage(assistantMsgId, this.currentMessage);
            if (enableAutoScroll) this.scrollToBottom();
        },
        onEnd: () => {
            cleanup(); // Resets isStreaming, clears timeout
            // Save to conversation store
            this.conversationStore.addAssistantMessage(id, this.currentMessage);
        },
    });
}
```

### Conversation Panel State Management

The conversation panel uses explicit state management (not hover-based):

```typescript
// State
private showConversationPanel = false;

// Methods
toggleConversationPanel(): void {
    this.showConversationPanel = !this.showConversationPanel;
    this.updateConversationPanelVisibility();
}

closeConversationPanel(): void {
    this.showConversationPanel = false;
    this.updateConversationPanelVisibility();
}

updateConversationPanelVisibility(): void {
    // Toggle .hidden class and aria-expanded
}
```

### Conversation Change Handling

**CRITICAL:** Don't reload messages during streaming (causes messages to disappear):

```typescript
private onConversationChange(): void {
    // Skip reload during streaming
    if (this.isStreaming) {
        this.updateConversationUI(); // Only update metadata, not messages
        return;
    }
    // Normal reload...
}
```

### Auto-Scroll Implementation

Use `requestAnimationFrame` + `setTimeout` for reliable scrolling:

```typescript
private scrollToBottom(): void {
    requestAnimationFrame(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    });
    setTimeout(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }, 10);
}
```

### Layout Structure (Flexbox)

The chat interface uses a strict flexbox hierarchy to ensure proper scrolling:

```css
/* Root container - controls overflow */
.iflow-chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;  /* Prevent container scroll */
}

/* Chat view - flexible child */
.iflow-chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    flex: 1;
    min-height: 0;  /* Critical for flex child */
}

/* Messages - scrollable area */
.iflow-messages {
    flex: 1 1 auto;  /* Grow to fill space */
    overflow-y: auto;  /* Only messages scroll */
    min-height: 0;  /* Allows shrinking */
}

/* Input - fixed at bottom */
.iflow-input-container {
    flex: 0 0 auto;  /* Don't grow or shrink */
    max-height: 50vh;
    overflow-y: auto;  /* Internal scroll if needed */
}
```

**Key principles:**
- Container: `overflow: hidden` prevents double scrollbars
- Messages: `flex: 1 1 auto` + `overflow-y: auto` creates independent scroll
- Input: `flex: 0 0 auto` keeps it fixed at bottom
- Always add `min-height: 0` to flexible children

### Dropdown Panel Positioning

The conversation panel uses absolute positioning to appear below the trigger button:

```css
/* Parent container - MUST have position: relative */
.iflow-conversation-selector {
    position: relative;  /* Creates positioning context */
}

/* Trigger button */
.iflow-conversation-trigger {
    /* Regular button styles */
}

/* Panel - positioned relative to parent */
.iflow-conversation-panel {
    position: absolute;  /* Position relative to .iflow-conversation-selector */
    top: 100%;          /* Immediately below parent */
    left: 0;            /* Align left edge */
    width: auto;        /* Adapt to content */
    min-width: 300px;   /* Minimum width */
    max-width: 400px;   /* Maximum width */
    z-index: 1000;      /* Above other content */
}

/* Hidden state */
.iflow-conversation-panel.hidden {
    display: none;
}
```

**Critical points:**
- Parent MUST have `position: relative` for absolute child positioning
- `top: 100%` places panel immediately below parent
- Use `width: auto` with min/max constraints for responsive sizing
- Always initialize panel with `hidden` class to prevent flash on load
- Toggle `hidden` class and `aria-expanded` attribute for accessibility

## Data Flow

### Sending a Message

```
1. User types in textarea → presses Enter
2. chatView.sendMessage()
   - Check isStreaming (force reset if true)
   - Add user message to UI
   - Set isStreaming = true
   - Call iflowService.sendMessage()
3. iflowService.sendMessage()
   - Apply runtime settings (mode, model, think)
   - Register event handlers (onChunk, onEnd, onError)
   - Send JSON-RPC request: session/prompt
4. Receive streaming updates (session/update notifications)
   - Extract content from update
   - Trigger onChunk callback
   - chatView updates message UI
5. Receive final response with stopReason
   - Trigger 'end' event
   - onEnd callback saves message to store
   - Reset isStreaming = false
```

### Conversation Persistence

```
1. Add message → conversationStore.addUserMessage()
2. Update state + save to localStorage (vault-isolated)
3. Trigger notify()
4. All subscribers receive onConversationChange()
5. UI updates (unless streaming)
```

### Vault-Isolated Storage

```
1. Get vault path: plugin.getVaultPath()
2. Hash path to create unique storage key
3. Each vault has isolated conversation data
4. Storage key format: iflow-conversations-{hash}
```

## Conversation Store API

### Core Methods

```typescript
// Conversation management
newConversation(model, mode, think): Conversation
switchConversation(id): void
deleteConversation(id): void
getCurrentConversation(): Conversation | null

// Message operations
addUserMessage(id, content): Message
addAssistantMessage(id, content): Message
updateAssistantMessage(convId, msgId, content): void

// State
getState(): ConversationState
subscribe(callback): () => void
```

### Export/Import API

```typescript
// Export to JSON (complete data backup)
const json = store.exportToJSON();
// Returns: JSON string with all conversations

// Export to Markdown (human-readable)
const md = store.exportToMarkdown(conversationId);
// Returns: Markdown formatted conversation(s)

// Import from JSON (merge strategy)
const result = store.importFromJSON(jsonString);
// Returns: { success, message, imported }
```

### Storage Quota API

```typescript
const quota = store.getStorageQuota();
// Returns:
{
    usedBytes: number;        // Current usage
    totalBytes: number;       // Max allowed (4MB)
    percentUsed: number;      // 0-1
    approachingLimit: boolean; // > 80%
    atLimit: boolean;         // > 95%
}
```

### Statistics API

```typescript
const stats = store.getStats();
// Returns:
{
    totalConversations: number;
    totalMessages: number;
    oldestConversation?: Date;
    newestConversation?: Date;
}
```

### Data Management

```typescript
// Clear all conversations
store.clearAll(): void

// Auto-cleanup happens when:
// - Storage exceeds 4MB limit
// - Keeps most recent 50 conversations
// - Sorted by updatedAt timestamp
```

## Data Structures

### Conversation

```typescript
interface Conversation {
    id: string;
    title: string;
    messages: Message[];
    mode: ConversationMode;  // "default" | "yolo" | "plan" | "smart"
    think: boolean;
    model: ModelType;
    createdAt: number;
    updatedAt: number;
}
```

### Message

```typescript
interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}
```

### Persisted State

```typescript
interface PersistedState extends ConversationState {
    version: number;         // For data migration
    createdAt: number;
    updatedAt: number;
}
```

## Common Bugs & Fixes

### Bug #1: Messages lost after sending

**Symptom:** Messages disappear from conversation after sending

**Root Cause:** `onEnd` callback never called, `isStreaming` stuck at `true`

**Fix:** Ensure `stopReason` triggers 'end' event:
```typescript
// iflowService.ts line ~450
if (result?.stopReason === 'end_turn' || result?.stopReason === 'max_turns') {
    this.messageHandlers.forEach(handler => handler({ type: 'end' }));
}
```

### Bug #2: Can't send second message

**Symptom:** Send button becomes unresponsive

**Root Cause:** `isStreaming` not reset after first message

**Fix:** Add force reset at start of sendMessage():
```typescript
if (this.isStreaming) {
    this.isStreaming = false;
}
```

### Bug #3: Messages disappear during streaming

**Symptom:** UI messages vanish while streaming

**Root Cause:** `onConversationChange` clears container during streaming

**Fix:** Skip reload when `isStreaming === true`:
```typescript
if (this.isStreaming) return;
```

### Bug #4: Conversation panel doesn't toggle

**Symptom:** Clicking conversation title doesn't show/hide panel

**Root Cause:** Missing click handler and state management

**Fix:** Add explicit toggle with state:
```typescript
trigger.onclick = (e) => {
    e.stopPropagation();
    this.toggleConversationPanel();
};
```

### Bug #5: Panel visible by default

**Symptom:** Panel shows permanently on page load

**Root Cause:** Panel created without `hidden` class

**Fix:** Add `hidden` class on panel creation:
```typescript
const panel = selector.createDiv({ cls: 'iflow-conversation-panel hidden' });
```

### Bug #6: Panel positioned at page bottom

**Symptom:** Panel appears at bottom of page instead of below trigger button

**Root Cause:** Missing `position: relative` on parent container `.iflow-conversation-selector`

**Fix:** Add CSS positioning:
```css
.iflow-conversation-selector {
    position: relative;  /* Critical for absolute child positioning */
}

.iflow-conversation-panel {
    position: absolute;
    top: 100%;
    left: 0;
    width: auto;
    min-width: 300px;
    max-width: 400px;
}
```

### Bug #7: Input container not fixed at bottom

**Symptom:** Input area scrolls with messages instead of staying fixed

**Root Cause:** Incorrect flexbox properties on input container

**Fix:** Set proper flex properties:
```css
.iflow-input-container {
    flex: 0 0 auto;  /* Don't grow or shrink */
    max-height: 50vh;
    overflow-y: auto;
}
```

## Development Workflow

### Making Changes

1. Edit files in `src/`
2. `npm run dev` auto-compiles to `main.js`
3. Reload plugin in Obsidian (Cmd/Ctrl + R in developer console)
4. Test changes
5. Commit with conventional commit message

### Testing Streaming

Always test:
- ✅ First message sends successfully
- ✅ Second message sends successfully (no force reset)
- ✅ Messages persist after closing/reopening chat
- ✅ Auto-scroll works during streaming
- ✅ Conversation switching works
- ✅ Panel toggles on click
- ✅ Panel closes when clicking outside
- ✅ Panel appears below trigger button (not at page bottom)
- ✅ Input container stays fixed at bottom
- ✅ Messages scroll independently from input

### Testing Conversation Management

- ✅ New conversation creates empty state
- ✅ Conversations persist across reloads
- ✅ Switching conversations loads correct messages
- ✅ Deleting conversations works correctly
- ✅ Search filters conversations
- ✅ Export/import preserves data

### Debugging

```typescript
// Key log points
console.log('[iFlow Chat] sendMessage called', { isStreaming, content });
console.log('[iFlow] Stream complete, stopReason:', result.stopReason);
console.log('[iFlow Chat] onEnd called');
console.log('[ConversationStore] Storage quota:', quota);
```

Check browser console:
- `Ctrl/Cmd + Shift + I` → Console tab
- Filter: `iFlow`, `ConversationStore`

## Storage

| Location | Contents |
|----------|----------|
| `localStorage` (key: `iflow-conversations-{hash}`) | Vault-specific conversation data (JSON) |
| `localStorage` (key: 'iflow-settings') | Plugin settings |

### Vault Isolation

Each vault gets its own storage key based on path hash:
- Prevents cross-vault data contamination
- Allows independent conversation management per vault
- Automatic migration from old global storage

### Storage Limits

- **Max size**: 4MB per vault
- **Auto-cleanup**: Keeps 50 most recent conversations
- **Warning thresholds**:
  - 80%: Approaching limit
  - 95%: At limit

## Settings

```typescript
interface IFlowSettings {
    port: number;              // iFlow CLI port (default: 8080)
    timeout: number;           // Connection timeout (default: 5000ms)
    excludedTags: string[];    // Tags to exclude (default: ['private', 'sensitive'])
    enableAutoScroll: boolean; // Auto-scroll to bottom (default: true)
}
```

## Release Process

```bash
# 1. Make changes and test
npm run dev

# 2. Update versions
vim manifest.json  # Update "version"
vim package.json   # Update "version"
vim versions.json  # Add new version entry

# 3. Build
npm run build

# 4. Commit & push
git add -A
git commit -m "feat: your changes"
git push origin main

# 5. Create release with detailed notes
gh release create v0.x.x main.js manifest.json styles.css \
  --title "v0.x.x - Description" \
  --notes "Release notes"

# 6. Users update via BRAT
```

### Release Notes Template

```markdown
## 🎉 New Features
- Feature 1
- Feature 2

## 🐛 Bug Fixes
- Bug fix 1
- Bug fix 2

## 📝 Technical Changes
- Change 1
- Change 2

## 📦 Installation
### BRAT (Recommended)
1. Install BRAT plugin
2. Add: https://github.com/junjie-yan/iflow-for-obsidian
3. Enable plugin

### Manual
1. Download from releases
2. Extract to .obsidian/plugins/iflow-for-obsidian/
3. Enable in settings
```

## Reference Projects

- [iFlow for VSCode](https://github.com/iflow-ai/iflow-vscode) - VSCode extension (reference implementation)
- [Claudian](https://github.com/YishenTu/claudian) - Claude Code for Obsidian (inspiration)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) - Basic plugin template

## Important Notes

- **Always check `isStreaming` state** before assuming message operations work
- **Never trigger full message reload during streaming** - causes UI flicker
- **Always call `onEnd` when stream completes** - otherwise messages won't save
- **Use requestAnimationFrame for DOM updates** - ensures rendering happens
- **Test second message send** - this is the most common failure mode
- **Check browser console logs** - they reveal state issues
- **Use vault-isolated storage** - each vault has independent data
- **Monitor storage quota** - auto-cleanup prevents overflow
- **Panel requires relative parent** - absolute positioning only works with `position: relative` parent
- **Initialize panel as hidden** - add `hidden` class on creation to prevent flash
- **Flexbox needs min-height: 0** - critical for flexible children to shrink properly
- **Input container must be flex: 0 0 auto** - prevents it from growing or shrinking

## When Adding Features

1. **Check existing patterns first** - don't reinvent
2. **Consider streaming impact** - will it work during isStreaming?
3. **Test conversation switching** - does state transfer correctly?
4. **Verify persistence** - do changes save to localStorage?
5. **Test export/import** - does data preserve correctly?
6. **Check vault isolation** - does each vault have independent data?
7. **Add debug logs** - help future debugging
8. **Update documentation** - keep CLAUDE.md and README.md current
