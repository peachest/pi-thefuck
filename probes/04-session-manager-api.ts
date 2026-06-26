/**
 * Probe 4: Test SessionManager API directly
 *
 * Tests that the SessionManager API works as expected for /fuck's needs:
 * 1. Open a real session file
 * 2. getBranch() - walk from leaf to root
 * 3. Get session ID
 * 4. Verify entry structure matches expectations
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";

const SESSION_FILE = "/mnt/disk1/hyx/.pi/agent/sessions/--mnt-disk1-hyx-projects-pi-mypackage-wishlist--/2026-06-24T07-53-31-015Z_019ef89e-b487-7d82-a0ad-d854e90677fa.jsonl";

async function main() {
  console.log("=== Probe 4: SessionManager API Test ===");

  // Test 1: Open session
  const sm = await SessionManager.open(SESSION_FILE);
  console.log("✅ Session opened successfully");
  console.log("  Session ID:", sm.getSessionId());
  console.log("  Session File:", sm.getSessionFile());
  console.log("  CWD:", sm.getCwd());

  // Test 2: getBranch()
  const branch = sm.getBranch();
  console.log("\n✅ getBranch():", branch.length, "entries");
  
  // Test 3: getLeafId / getLeafEntry
  const leafId = sm.getLeafId();
  const leafEntry = sm.getLeafEntry();
  console.log("\n✅ Leaf ID:", leafId);
  console.log("  Leaf type:", leafEntry?.type);

  // Test 4: getEntries()
  const allEntries = sm.getEntries();
  console.log("\n✅ All entries:", allEntries.length);

  // Test 5: Walk branch and find isError toolResults  
  console.log("\n=== Traversal test ===");
  
  // Branch should be the current path from leaf to root
  let foundFailures = 0;
  for (const entry of branch) {
    if (entry.type === "message") {
      const msg = (entry as any).message;
      if (msg?.role === "toolResult" && msg.isError === true) {
        console.log(`  ❌ Found failed toolResult: ${msg.toolName}(${msg.toolCallId})`);
        foundFailures++;
      }
    }
  }
  console.log(`  Total failed toolResults in branch: ${foundFailures}`);

  // Test 6: buildSessionContext()
  console.log("\n=== buildSessionContext() test ===");
  const context = sm.buildSessionContext();
  console.log("  Messages in context:", context.messages.length);
  const roles = context.messages.map((m: any) => m.role).join(", ");
  console.log("  Roles:", roles);
  
  const failedInContext = context.messages.filter(
    (m: any) => m.role === "toolResult" && m.isError === true
  );
  console.log("  Failed toolResults in context:", failedInContext.length);
  for (const f of failedInContext) {
    console.log(`    ${f.toolName}(${f.toolCallId}): isError=${f.isError}`);
  }

  // Test 7: Verify we can map toolCallId back to assistant messages
  console.log("\n=== ToolCall→Assistant mapping test ===");
  const toolResults = context.messages.filter((m: any) => m.role === "toolResult");
  const assistants = context.messages.filter((m: any) => m.role === "assistant");
  
  for (const tr of toolResults.slice(0, 5)) {
    // For each toolResult, find the last preceding assistant that contains its toolCallId
    const trIdx = context.messages.indexOf(tr);
    let found = false;
    for (let i = trIdx - 1; i >= 0; i--) {
      const m = context.messages[i];
      if (m.role === "assistant" && m.content) {
        const hasCall = m.content.some(
          (c: any) => c.type === "toolCall" && c.id === tr.toolCallId
        );
        if (hasCall) {
          console.log(`  ✅ ${tr.toolName}(${tr.toolCallId}) → assistant at index ${i}`);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      console.log(`  ⚠️  ${tr.toolName}(${tr.toolCallId}) → no matching assistant found (might be from earlier branch)`);
    }
  }

  console.log("\n=== Probe 4 Complete ===");
}

main().catch(console.error);