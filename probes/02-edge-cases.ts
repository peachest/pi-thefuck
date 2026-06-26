/**
 * Probe 2: Edge case tests for /fuck context filtering
 *
 * Tests:
 * 1. Multiple failed tool calls in sequence (fuck only the last one)
 * 2. All tool calls in an assistant failed (remove entire assistant)
 * 3. No failed tool calls (should be no-op)
 * 4. Multiple consecutive assistants with failures
 * 5. Re-fuck (already-filtered toolCallId should be idempotent)
 */

// Simulate the messages array shape that context event provides
type ContentBlock = 
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, any> };

type Message = {
  role: "user" | "assistant" | "toolResult";
  content?: ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  [key: string]: any;
};

// The exact context filtering logic from the design
function filterFuckedMessages(messages: Message[], fuckedToolCallIds: Set<string>): Message[] {
  const modified = messages.flatMap(msg => {
    if (msg.role === "toolResult" && msg.toolCallId && fuckedToolCallIds.has(msg.toolCallId)) {
      return [];
    }
    
    if (msg.role === "assistant" && msg.content) {
      const filtered = msg.content.filter(block =>
        block.type !== "toolCall" || !fuckedToolCallIds.has(block.id)
      );
      if (filtered.length === 0) return [];
      if (filtered.length !== msg.content.length) {
        return [{ ...msg, content: filtered }];
      }
    }
    return [msg];
  });
  return modified;
}

function assert(condition: boolean, label: string) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  if (!condition) process.exitCode = 1;
}

// --- Test 1: Multiple consecutive failures ---
console.log("=== Test 1: Multiple consecutive failures (fuck only the last) ===");
{
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "do something" }] },
    { role: "assistant", content: [
      { type: "text", text: "Ok" },
      { type: "toolCall", id: "tc1", name: "bash", arguments: {} },
      { type: "toolCall", id: "tc2", name: "read", arguments: {} },
    ]},
    { role: "toolResult", toolCallId: "tc1", toolName: "bash", isError: true, content: [{ type: "text", text: "error 1" }] },
    { role: "toolResult", toolCallId: "tc2", toolName: "read", isError: true, content: [{ type: "text", text: "error 2" }] },
  ];

  // Fuck only the LAST one (tc2)
  const filtered = filterFuckedMessages(messages, new Set(["tc2"]));
  
  assert(filtered.length === 3, "3 messages remain (user, assistant with tc1, toolResult tc1)");
  assert(!filtered.some(m => m.toolCallId === "tc2"), "tc2 toolResult removed");
  assert(!filtered.some(m => m.role === "assistant" && m.content?.some(c => c.type === "toolCall" && c.id === "tc2")), "tc2 toolCall removed from assistant");
  assert(filtered.some(m => m.role === "assistant" && m.content?.some(c => c.type === "toolCall" && c.id === "tc1")), "tc1 toolCall preserved");
  assert(filtered.some(m => m.toolCallId === "tc1"), "tc1 toolResult preserved");
}

// --- Test 2: All tool calls failed (remove entire assistant) ---
console.log("\n=== Test 2: All tool calls in an assistant failed ===");
{
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "do x" }] },
    { role: "assistant", content: [
      { type: "toolCall", id: "tc_a", name: "bash", arguments: {} },
    ]},
    { role: "toolResult", toolCallId: "tc_a", toolName: "bash", isError: true, content: [{ type: "text", text: "fail" }] },
  ];

  const filtered = filterFuckedMessages(messages, new Set(["tc_a"]));
  
  assert(filtered.length === 1, "Only user message remains (entire assistant removed)");
  assert(filtered[0].role === "user", "Only the user message is left");
}

// --- Test 3: No failed tool calls ---
console.log("\n=== Test 3: No failed tool calls ===");
{
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "text", text: "hello" }] },
  ];

  const filtered = filterFuckedMessages(messages, new Set(["nonexistent"]));
  
  assert(filtered.length === 2, "Messages unchanged");
  assert(JSON.stringify(filtered) === JSON.stringify(messages), "Content unchanged");
}

// --- Test 4: Empty fucked set ---
console.log("\n=== Test 4: Empty fucked set should be no-op ===");
{
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }] },
    { role: "toolResult", toolCallId: "tc1", toolName: "bash", isError: false, content: [{ type: "text", text: "ok" }] },
  ];

  const filtered = filterFuckedMessages(messages, new Set());
  
  assert(filtered.length === 3, "Messages unchanged with empty set");
}

// --- Test 5: Re-fuck is idempotent ---
console.log("\n=== Test 5: Re-fuck is idempotent ===");
{
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [
      { type: "toolCall", id: "tc1", name: "bash", arguments: {} },
      { type: "toolCall", id: "tc2", name: "bash", arguments: {} },
    ]},
    { role: "toolResult", toolCallId: "tc1", toolName: "bash", isError: true, content: [{ type: "text", text: "fail" }] },
    { role: "toolResult", toolCallId: "tc2", toolName: "bash", isError: true, content: [{ type: "text", text: "also fail" }] },
  ];

  // First fuck removes tc2 (last failure)
  const filtered1 = filterFuckedMessages(messages, new Set(["tc2"]));
  assert(filtered1.length === 3, "After first fuck: 3 messages");
  assert(filtered1.some(m => m.toolCallId === "tc1"), "tc1 still present");
  
  // Second fuck removes tc1 too
  const filtered2 = filterFuckedMessages(filtered1, new Set(["tc1"]));
  assert(filtered2.length === 1, "After second fuck: only user message");
  
  // Re-fuck the same IDs again on the original - should produce same result
  const filtered3 = filterFuckedMessages(messages, new Set(["tc2", "tc1"]));
  assert(filtered3.length === 1, "Re-fuck same IDs: only user message");
}

// --- Test 6: toolResult without matching toolCall (stale entry) ---
console.log("\n=== Test 6: Stale toolCallId (not in any assistant) ===");
{
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "text", text: "thinking..." }] },
    { role: "toolResult", toolCallId: "orphan", toolName: "bash", isError: false },
  ];

  const filtered = filterFuckedMessages(messages, new Set(["orphan"]));
  
  assert(filtered.length === 2, "toolResult removed even though it has no matching toolCall");
  assert(!filtered.some(m => m.toolCallId === "orphan"), "Orphan toolResult removed");
  // The assistant with only text remains
  assert(filtered.some(m => m.role === "assistant"), "Assistant with text preserved");
}

console.log("\n=== Probe 2 Complete ===");