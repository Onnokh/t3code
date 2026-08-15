import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  makeOpenCode2TranslationState,
  mergeOpenCode2AssistantText,
  openCode2EventSessionId,
  openCode2ReasoningItemId,
  openCode2TextItemId,
  toOpenCode2ToolLifecycleItemType,
  translateOpenCode2Event,
} from "./opencode2Events.ts";

const SESSION_ID = "ses_test";

function textDelta(delta: string, ordinal = 0, seqless = true) {
  return {
    id: "evt_1",
    type: "session.text.delta",
    ...(seqless ? {} : { durable: { seq: 1 } }),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: "msg_a",
      ordinal,
      delta,
    },
  };
}

describe("openCode2EventSessionId", () => {
  it("reads data.sessionID", () => {
    NodeAssert.equal(openCode2EventSessionId(textDelta("x")), SESSION_ID);
  });
  it("returns undefined for non-session events", () => {
    NodeAssert.equal(openCode2EventSessionId({ type: "server.connected", data: {} }), undefined);
  });
});

describe("mergeOpenCode2AssistantText", () => {
  it("emits only the missing suffix", () => {
    const merged = mergeOpenCode2AssistantText("hello", "hello world");
    NodeAssert.equal(merged.latestText, "hello world");
    NodeAssert.equal(merged.deltaToEmit, " world");
  });
  it("keeps the longer already-emitted text on stale full-text observations", () => {
    const merged = mergeOpenCode2AssistantText("hello world", "hello");
    NodeAssert.equal(merged.latestText, "hello world");
    NodeAssert.equal(merged.deltaToEmit, "");
  });
});

describe("translateOpenCode2Event — text", () => {
  it("streams deltas and completes on text.ended without duplicating text", () => {
    const state = makeOpenCode2TranslationState();
    const first = translateOpenCode2Event(state, textDelta("apple"));
    NodeAssert.deepEqual(first, [
      {
        kind: "content.delta",
        itemId: openCode2TextItemId("msg_a", 0),
        streamKind: "assistant_text",
        delta: "apple",
      },
    ]);
    const second = translateOpenCode2Event(state, textDelta(" banana"));
    NodeAssert.equal(second.length, 1);

    const ended = translateOpenCode2Event(state, {
      type: "session.text.ended",
      durable: { seq: 10 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        ordinal: 0,
        text: "apple banana",
      },
    });
    // All text already streamed: only the completion remains.
    NodeAssert.deepEqual(ended, [
      {
        kind: "assistant-message.completed",
        itemId: openCode2TextItemId("msg_a", 0),
        text: "apple banana",
      },
    ]);
  });

  it("recovers missed deltas from the terminal full text", () => {
    const state = makeOpenCode2TranslationState();
    translateOpenCode2Event(state, textDelta("apple"));
    const ended = translateOpenCode2Event(state, {
      type: "session.text.ended",
      durable: { seq: 11 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        ordinal: 0,
        text: "apple banana cherry",
      },
    });
    NodeAssert.equal(ended.length, 2);
    NodeAssert.deepEqual(ended[0], {
      kind: "content.delta",
      itemId: openCode2TextItemId("msg_a", 0),
      streamKind: "assistant_text",
      delta: " banana cherry",
    });
    NodeAssert.equal(ended[1]?.kind, "assistant-message.completed");
  });

  it("maps reasoning deltas to the reasoning stream and never completes them", () => {
    const state = makeOpenCode2TranslationState();
    const delta = translateOpenCode2Event(state, {
      type: "session.reasoning.delta",
      data: { sessionID: SESSION_ID, assistantMessageID: "msg_a", ordinal: 1, delta: "thinking" },
    });
    NodeAssert.deepEqual(delta, [
      {
        kind: "content.delta",
        itemId: openCode2ReasoningItemId("msg_a", 1),
        streamKind: "reasoning_text",
        delta: "thinking",
      },
    ]);
    const ended = translateOpenCode2Event(state, {
      type: "session.reasoning.ended",
      durable: { seq: 3 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        ordinal: 1,
        text: "thinking",
      },
    });
    NodeAssert.deepEqual(ended, []);
  });
});

describe("translateOpenCode2Event — durable sequence dedupe", () => {
  it("drops durable events at or below the last observed sequence", () => {
    const state = makeOpenCode2TranslationState();
    const first = translateOpenCode2Event(state, {
      type: "session.execution.succeeded",
      durable: { seq: 7 },
      data: { sessionID: SESSION_ID },
    });
    NodeAssert.deepEqual(first, [{ kind: "turn.completed" }]);
    const replay = translateOpenCode2Event(state, {
      type: "session.execution.succeeded",
      durable: { seq: 7 },
      data: { sessionID: SESSION_ID },
    });
    NodeAssert.deepEqual(replay, []);
    NodeAssert.equal(state.lastSeq, 7);
  });

  it("seeded lastSeq suppresses replayed history after resume", () => {
    const state = makeOpenCode2TranslationState();
    state.lastSeq = 20;
    const replay = translateOpenCode2Event(state, {
      type: "session.execution.failed",
      durable: { seq: 19 },
      data: { sessionID: SESSION_ID, error: { type: "x", message: "boom" } },
    });
    NodeAssert.deepEqual(replay, []);
  });
});

describe("translateOpenCode2Event — execution lifecycle", () => {
  it("maps failed executions to a failed turn plus a runtime error", () => {
    const state = makeOpenCode2TranslationState();
    const events = translateOpenCode2Event(state, {
      type: "session.execution.failed",
      durable: { seq: 2 },
      data: { sessionID: SESSION_ID, error: { type: "ProviderError", message: "model exploded" } },
    });
    NodeAssert.equal(events.length, 2);
    NodeAssert.deepEqual(events[0], { kind: "turn.failed", message: "model exploded" });
    NodeAssert.equal(events[1]?.kind, "runtime.error");
  });

  it("maps interruption with its reason", () => {
    const state = makeOpenCode2TranslationState();
    const events = translateOpenCode2Event(state, {
      type: "session.execution.interrupted",
      durable: { seq: 2 },
      data: { sessionID: SESSION_ID, reason: "user" },
    });
    NodeAssert.deepEqual(events, [{ kind: "turn.interrupted", reason: "Interrupted (user)." }]);
  });
});

describe("translateOpenCode2Event — tools", () => {
  it("tracks the tool lifecycle across input.started, called, and success", () => {
    const state = makeOpenCode2TranslationState();
    const started = translateOpenCode2Event(state, {
      type: "session.tool.input.started",
      durable: { seq: 1 },
      data: { sessionID: SESSION_ID, assistantMessageID: "msg_a", id: "call_1", name: "bash" },
    });
    NodeAssert.equal(started.length, 1);
    NodeAssert.deepEqual(started[0], {
      kind: "tool.item",
      phase: "started",
      callId: "call_1",
      itemType: "command_execution",
      status: "inProgress",
      title: "bash",
    });

    const called = translateOpenCode2Event(state, {
      type: "session.tool.called",
      durable: { seq: 2 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        id: "call_1",
        input: { command: "ls" },
        executed: true,
      },
    });
    NodeAssert.equal(called[0]?.kind, "tool.item");
    NodeAssert.equal((called[0] as { phase: string }).phase, "updated");

    const success = translateOpenCode2Event(state, {
      type: "session.tool.success",
      durable: { seq: 3 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        id: "call_1",
        content: [{ type: "text", text: "file-a\nfile-b" }],
      },
    });
    NodeAssert.equal(success[0]?.kind, "tool.item");
    const completed = success[0] as { phase: string; status: string; detail?: string };
    NodeAssert.equal(completed.phase, "completed");
    NodeAssert.equal(completed.status, "completed");
    NodeAssert.equal(completed.detail, "file-a\nfile-b");
    NodeAssert.equal(state.toolNamesByCallId.has("call_1"), false);
  });

  it("maps tool failures with the error message", () => {
    const state = makeOpenCode2TranslationState();
    translateOpenCode2Event(state, {
      type: "session.tool.input.started",
      durable: { seq: 1 },
      data: { sessionID: SESSION_ID, assistantMessageID: "msg_a", id: "call_2", name: "edit" },
    });
    const failed = translateOpenCode2Event(state, {
      type: "session.tool.failed",
      durable: { seq: 2 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        id: "call_2",
        error: { type: "ToolError", message: "no such file" },
      },
    });
    const item = failed[0] as { status: string; detail?: string; itemType: string };
    NodeAssert.equal(item.status, "failed");
    NodeAssert.equal(item.detail, "no such file");
    NodeAssert.equal(item.itemType, "file_change");
  });
});

describe("translateOpenCode2Event — permissions and questions", () => {
  it("opens and resolves permission requests", () => {
    const state = makeOpenCode2TranslationState();
    const asked = translateOpenCode2Event(state, {
      type: "permission.asked",
      data: {
        id: "perm_1",
        sessionID: SESSION_ID,
        action: "bash",
        resources: ["rm -rf ./dist"],
        metadata: { command: "rm -rf ./dist" },
      },
    });
    NodeAssert.equal(asked.length, 1);
    NodeAssert.deepEqual(asked[0], {
      kind: "request.opened",
      requestId: "perm_1",
      requestType: "command_execution_approval",
      detail: "rm -rf ./dist",
      args: { command: "rm -rf ./dist" },
    });
    NodeAssert.equal(state.pendingPermissions.has("perm_1"), true);

    const replied = translateOpenCode2Event(state, {
      type: "permission.replied",
      data: { sessionID: SESSION_ID, requestID: "perm_1", reply: "always" },
    });
    NodeAssert.deepEqual(replied, [
      { kind: "request.resolved", requestId: "perm_1", decision: "acceptForSession" },
    ]);
    NodeAssert.equal(state.pendingPermissions.has("perm_1"), false);
  });

  it("normalizes questions and maps positional answers back to question ids", () => {
    const state = makeOpenCode2TranslationState();
    const asked = translateOpenCode2Event(state, {
      type: "question.asked",
      data: {
        id: "que_1",
        sessionID: SESSION_ID,
        questions: [
          {
            header: "Pick One",
            question: "Which flavor?",
            options: [
              { label: "Vanilla", description: "plain" },
              { label: "Chocolate", description: "rich" },
            ],
          },
        ],
      },
    });
    NodeAssert.equal(asked.length, 1);
    const request = asked[0] as { kind: string; questions: ReadonlyArray<{ id: string }> };
    NodeAssert.equal(request.kind, "user-input.requested");
    NodeAssert.equal(request.questions[0]?.id, "question-0-pick-one");

    const replied = translateOpenCode2Event(state, {
      type: "question.replied",
      data: { sessionID: SESSION_ID, requestID: "que_1", answers: [["Vanilla"]] },
    });
    NodeAssert.deepEqual(replied, [
      {
        kind: "user-input.resolved",
        requestId: "que_1",
        answers: { "question-0-pick-one": "Vanilla" },
      },
    ]);
  });

  it("maps rejected questions to empty answers", () => {
    const state = makeOpenCode2TranslationState();
    translateOpenCode2Event(state, {
      type: "question.asked",
      data: {
        id: "que_2",
        sessionID: SESSION_ID,
        questions: [{ header: "H", question: "Q", options: [] }],
      },
    });
    const rejected = translateOpenCode2Event(state, {
      type: "question.rejected",
      data: { sessionID: SESSION_ID, requestID: "que_2" },
    });
    NodeAssert.deepEqual(rejected, [
      { kind: "user-input.resolved", requestId: "que_2", answers: {} },
    ]);
  });
});

describe("translateOpenCode2Event — metadata and usage", () => {
  it("maps renames to thread metadata", () => {
    const state = makeOpenCode2TranslationState();
    const events = translateOpenCode2Event(state, {
      type: "session.renamed",
      durable: { seq: 4 },
      data: { sessionID: SESSION_ID, title: "  A tidy title  " },
    });
    NodeAssert.deepEqual(events, [{ kind: "thread.renamed", title: "A tidy title" }]);
  });

  it("maps step usage to a token usage snapshot", () => {
    const state = makeOpenCode2TranslationState();
    const events = translateOpenCode2Event(state, {
      type: "session.step.ended",
      durable: { seq: 5 },
      data: {
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a",
        finish: "stop",
        cost: 0,
        tokens: { input: 100, output: 20, reasoning: 30, cache: { read: 400, write: 0 } },
      },
    });
    NodeAssert.deepEqual(events, [
      {
        kind: "token-usage",
        usage: {
          usedTokens: 150,
          inputTokens: 100,
          outputTokens: 20,
          reasoningOutputTokens: 30,
          cachedInputTokens: 400,
        },
      },
    ]);
  });

  it("ignores unknown event types", () => {
    const state = makeOpenCode2TranslationState();
    NodeAssert.deepEqual(
      translateOpenCode2Event(state, { type: "pty.created", data: { sessionID: SESSION_ID } }),
      [],
    );
  });
});

describe("toOpenCode2ToolLifecycleItemType", () => {
  it("classifies common tool names", () => {
    NodeAssert.equal(toOpenCode2ToolLifecycleItemType("bash"), "command_execution");
    NodeAssert.equal(toOpenCode2ToolLifecycleItemType("write"), "file_change");
    NodeAssert.equal(toOpenCode2ToolLifecycleItemType("websearch"), "web_search");
    NodeAssert.equal(toOpenCode2ToolLifecycleItemType("mcp_call"), "mcp_tool_call");
    NodeAssert.equal(toOpenCode2ToolLifecycleItemType("task"), "collab_agent_tool_call");
    NodeAssert.equal(toOpenCode2ToolLifecycleItemType("glob"), "dynamic_tool_call");
  });
});
