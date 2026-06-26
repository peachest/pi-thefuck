/**
 * Probe 1: Test session traversal and context filtering logic
 *
 * Tests:
 * 1. Parse a real session JSONL file
 * 2. Build the branch (walk parentId chain from leaf to root)
 * 3. Find last isError=true toolResult
 * 4. Match it to its assistant message and toolCall
 * 5. Simulate context filtering (remove toolResult + corresponding toolCall)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SESSION_DIR = "/mnt/disk1/hyx/.pi/agent/sessions/--mnt-disk1-hyx-projects-pi-mypackage-wishlist--";
const SESSION_FILE = join(SESSION_DIR, "2026-06-24T07-53-31-015Z_019ef89e-b487-7d82-a0ad-d854e90677fa.jsonl");

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  [key: string]: any;
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  isError: boolean;
  content: Array<{ type: string; text?: string }>;
  [key: string]: any;
}

interface AssistantMessage {
  role: "assistant";
  content: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: any }>;
  [key: string]: any;
}

// Step 1: Parse session
const lines = readFileSync(SESSION_FILE, "utf-8").trim().split("\n");
const entries: SessionEntry[] = lines.map((l) => JSON.parse(l));

console.log("=== Session Analysis ===");
console.log(`Total entries: ${entries.length}`);

const header = entries[0];
console.log(`Version: ${header.version}, ID: ${header.id}, CWD: ${header.cwd}`);

// Step 2: Build lookup maps
const entryMap = new Map<string, SessionEntry>();
const childrenMap = new Map<string, SessionEntry[]>();

for (const entry of entries) {
  entryMap.set(entry.id, entry);
  if (entry.parentId) {
    if (!childrenMap.has(entry.parentId)) {
      childrenMap.set(entry.parentId, []);
    }
    childrenMap.get(entry.parentId)!.push(entry);
  }
}

// Step 3: Find the leaf (last entry with no children)
function getLeafId(): string | null {
  const entriesWithIds = entries.filter(e => e.id);
  const entryIds = new Set(entriesWithIds.map(e => e.id));
  
  for (const entry of entriesWithIds) {
    const children = childrenMap.get(entry.id) || [];
    if (children.length === 0 && entry.type !== "session") {
      return entry.id;
    }
  }
  return null;
}

const leafId = getLeafId();
console.log(`\nLeaf entry ID: ${leafId}`);

// Step 4: Build branch by walking parentId chain
function buildBranch(leafId: string): SessionEntry[] {
  const branch: SessionEntry[] = [];
  let current = entryMap.get(leafId);
  while (current) {
    branch.unshift(current); // insert at front to get root→leaf order
    current = current.parentId ? entryMap.get(current.parentId) : undefined;
  }
  return branch;
}

const branch = buildBranch(leafId!);
console.log(`Branch length: ${branch.length}`);

// Step 5: Find the last failed tool call
function findLastFailedToolCall(branch: SessionEntry[]): {
  toolResultEntry: SessionEntry | null;
  assistantEntry: SessionEntry | null;
  toolCallId: string | null;
} {
  // Walk branch in reverse
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    
    if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.isError === true) {
      const toolCallId = entry.message.toolCallId;
      console.log(`\n  Found failed toolResult at index ${i}:`);
      console.log(`    entry id: ${entry.id}`);
      console.log(`    toolName: ${entry.message.toolName}`);
      console.log(`    toolCallId: ${toolCallId}`);
      console.log(`    content: ${JSON.stringify(entry.message.content)}`);
      
      // Now find the corresponding assistant message
      // Walk backwards from toolResult to find the preceding assistant message
      for (let j = i; j >= 0; j--) {
        const prev = branch[j];
        if (prev.type === "message" && prev.message?.role === "assistant") {
          const assistant = prev.message as AssistantMessage;
          const toolCalls = assistant.content.filter(c => c.type === "toolCall");
          
          console.log(`\n  Found assistant at index ${j}:`);
          console.log(`    entry id: ${prev.id}`);
          console.log(`    toolCalls in this assistant: ${toolCalls.map(tc => `${tc.name}(${tc.id})`).join(", ")}`);
          
          const matchingCall = toolCalls.find(tc => tc.id === toolCallId);
          if (matchingCall) {
            console.log(`  ✅ Matching toolCall found: ${matchingCall.name}(${matchingCall.id})`);
          } else {
            console.log(`  ❌ No matching toolCall in this assistant message`);
          }
          
          return { toolResultEntry: entry, assistantEntry: prev, toolCallId };
        }
      }
    }
  }
  
  return { toolResultEntry: null, assistantEntry: null, toolCallId: null };
}

console.log("\n=== Finding last failed tool call ===");
const result = findLastFailedToolCall(branch);

// Step 6: Simulate context filtering
console.log("\n=== Simulating context filtering ===");

// Build the messages array that context event would receive
function buildContextMessages(branch: SessionEntry[]): any[] {
  const messages: any[] = [];
  for (const entry of branch) {
    if (entry.type === "message" && entry.message) {
      messages.push(entry.message);
    }
  }
  return messages;
}

const originalMessages = buildContextMessages(branch);
console.log(`Total messages in context: ${originalMessages.length}`);
console.log(`Message roles: ${originalMessages.map(m => m.role).join(" → ")}`);

// Now filter
function filterFuckedMessages(messages: any[], fuckedToolCallIds: Set<string>): any[] {
  const modified = messages.flatMap(msg => {
    // Remove fucked toolResults
    if (msg.role === "toolResult" && fuckedToolCallIds.has(msg.toolCallId)) {
      console.log(`  🗑️ Removing toolResult: ${msg.toolName}(${msg.toolCallId})`);
      return [];
    }
    
    // Remove fucked toolCalls from assistant
    if (msg.role === "assistant" && msg.content) {
      const filtered = msg.content.filter((block: any) =>
        block.type !== "toolCall" || !fuckedToolCallIds.has(block.id)
      );
      if (filtered.length === 0) {
        console.log(`  🗑️ Removing entire assistant message (all toolCalls fucked)`);
        return [];
      }
      if (filtered.length !== msg.content.length) {
        console.log(`  🗑️ Removed toolCalls from assistant, remaining blocks: ${filtered.length}`);
        return [{ ...msg, content: filtered }];
      }
    }
    return [msg];
  });
  
  return modified;
}

if (result.toolResultEntry && result.toolCallId) {
  const fuckedIds = new Set([result.toolCallId]);
  console.log(`\nFiltering with fucked toolCallIds: ${[...fuckedIds].join(", ")}`);
  const filteredMessages = filterFuckedMessages(originalMessages, fuckedIds);
  console.log(`\nFiltered messages: ${filteredMessages.length} (was ${originalMessages.length})`);
  console.log(`Filtered roles: ${filteredMessages.map(m => m.role).join(" → ")}`);
  
  // Verify the filtered messages are coherent
  console.log("\n=== Verification ===");
  const hasFuckedToolResult = filteredMessages.some(
    m => m.role === "toolResult" && m.toolCallId === result.toolCallId
  );
  console.log(`❌ Has fucked toolResult: ${hasFuckedToolResult} (should be false)`);
  
  const hasFuckedToolCallInAssistant = filteredMessages.some((m: any) =>
    m.role === "assistant" && m.content?.some((c: any) =>
      c.type === "toolCall" && c.id === result.toolCallId
    )
  );
  console.log(`❌ Has fucked toolCall in assistant: ${hasFuckedToolCallInAssistant} (should be false)`);
  
  // Check if the successful sibling tool calls are preserved
  const siblingToolCalls = originalMessages
    .filter(m => m.role === "assistant" && m.content?.some((c: any) => c.type === "toolCall"))
    .flatMap(m => m.content?.filter((c: any) => c.type === "toolCall") ?? [])
    .filter(tc => tc.id !== result.toolCallId);
  
  for (const tc of siblingToolCalls) {
    const preserved = filteredMessages.some((m: any) =>
      m.role === "assistant" && m.content?.some((c: any) =>
        c.type === "toolCall" && c.id === tc.id
      )
    );
    const resultPreserved = filteredMessages.some(m =>
      m.role === "toolResult" && m.toolCallId === tc.id
    );
    console.log(`${preserved ? '✅' : '❌'} Sibling ${tc.name}(${tc.id}) preserved in assistant: ${preserved}`);
    console.log(`  ${resultPreserved ? '✅' : '❌'} Sibling ${tc.name}(${tc.id}) preserved as toolResult: ${resultPreserved}`);
  }
} else {
  console.log("No failed tool call found to test filtering");
}

console.log("\n=== Probe 1 Complete ===");