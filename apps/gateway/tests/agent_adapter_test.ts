import assert from "node:assert/strict";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  ClaudeAdapter,
  claudeApprovalOptions,
  claudeSessionPermissions,
  shouldAutoAllowClaudeTool,
} from "../src/agents/claude.ts";
import {
  CodexAdapter,
  codexApprovalOptions,
  codexMcpElicitationDecline,
  codexPermissionDescription,
  codexTurnCompletionError,
  isRetryableCodexError,
  normalizeCodexModels,
  normalizeCodexQuestion,
} from "../src/agents/codex.ts";
import type { RunContext } from "../src/agents/types.ts";

Deno.test("Codex retryable error notifications do not terminate a turn", () => {
  assert.equal(isRetryableCodexError({ willRetry: true }), true);
  assert.equal(isRetryableCodexError({ willRetry: false }), false);
});

Deno.test("Codex treats only completed turns as successful", () => {
  assert.equal(codexTurnCompletionError({ status: "completed" }), null);
  assert.match(codexTurnCompletionError({ status: "interrupted" })!.message, /interrupted/);
  assert.match(
    codexTurnCompletionError({ status: "failed", error: { message: "model failed" } })!.message,
    /model failed/,
  );
});

Deno.test("Codex permission approvals describe the requested access", () => {
  const description = codexPermissionDescription({
    permissions: {
      fileSystem: { read: ["/workspace"] },
      network: { enabled: true },
    },
    grantRoot: "/workspace",
    commandActions: ["git fetch"],
    additionalPermissions: { fileSystem: { write: ["/outside"] } },
    networkApprovalContext: { host: "example.com" },
    proposedExecpolicyAmendment: ["git", "fetch"],
    proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }],
  });

  assert.match(description, /fileSystem/);
  assert.match(description, /\/workspace/);
  assert.match(description, /network/);
  assert.match(description, /git fetch/);
  assert.match(description, /additional permissions/i);
  assert.match(description, /network approval context/i);
  assert.match(description, /execution policy amendment/i);
  assert.match(description, /network policy amendments/i);
});

Deno.test("Codex approvals expose only advertised basic decisions", () => {
  assert.deepEqual(codexApprovalOptions({ availableDecisions: ["accept", "decline"] }), [
    { id: "accept", label: "Allow once", kind: "allow" },
    { id: "decline", label: "Deny", kind: "deny" },
  ]);
});

Deno.test("Codex questions honor whether free-text answers are allowed", () => {
  assert.equal(normalizeCodexQuestion({ id: "choice", isOther: false }, 0).allowFreeText, false);
  assert.equal(normalizeCodexQuestion({ id: "other", isOther: true }, 1).allowFreeText, true);
});

Deno.test("Codex declines unsupported MCP elicitation with a valid response", () => {
  assert.deepEqual(codexMcpElicitationDecline(), {
    action: "decline",
    content: null,
    _meta: null,
  });
});

Deno.test("Codex model catalog uses runnable model IDs", () => {
  assert.deepEqual(
    normalizeCodexModels([{
      id: "picker-row",
      model: "gpt-example",
      displayName: "GPT Example",
      description: "Example model",
      isDefault: true,
    }]),
    [{
      id: "gpt-example",
      label: "GPT Example",
      description: "Example model",
      isDefault: true,
    }],
  );
});

Deno.test("Claude offers session approval only when permission suggestions can persist it", () => {
  assert.deepEqual(claudeApprovalOptions(false).map((option) => option.id), ["allow_once", "deny"]);
  assert.deepEqual(claudeApprovalOptions(true).map((option) => option.id), [
    "allow_once",
    "allow_session",
    "deny",
  ]);
});

Deno.test("Claude explicit ask rules override automatic read-tool approval", () => {
  assert.equal(shouldAutoAllowClaudeTool("Read", undefined), true);
  assert.equal(shouldAutoAllowClaudeTool("Read", { source: "projectSettings" }), false);
  assert.equal(shouldAutoAllowClaudeTool("Bash", undefined), false);
});

Deno.test("Claude session approvals cannot persist permission suggestions", () => {
  assert.deepEqual(
    claudeSessionPermissions([{
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test" }],
      behavior: "allow",
      destination: "projectSettings",
    }]),
    [{
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test" }],
      behavior: "allow",
      destination: "session",
    }],
  );
});

Deno.test("Claude model catalog is read from the SDK", async () => {
  let closed = false;
  const adapter = new ClaudeAdapter(
    (() =>
      fakeQuery([], undefined, {
        supportedModels: () =>
          Promise.resolve([{
            value: "sonnet",
            displayName: "Sonnet",
            description: "Balanced model",
          }]),
        close: () => {
          closed = true;
        },
      })) as never,
  );

  assert.deepEqual(await adapter.models(Deno.cwd()), [{
    id: "sonnet",
    label: "Sonnet",
    description: "Balanced model",
  }]);
  assert.equal(closed, true);
});

Deno.test("Codex cancellation during initialization does not create an unhandled rejection", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-codex-cancel-" });
  try {
    const command = join(directory, "fake-codex");
    Deno.writeTextFileSync(command, "#!/bin/sh\ntrap 'exit 0' TERM\nwhile read line; do :; done\n");
    Deno.chmodSync(command, 0o700);
    const controller = new AbortController();
    const adapter = new CodexAdapter();
    adapter.command = command;

    const run = adapter.run(context({ signal: controller.signal }));
    controller.abort();

    await assert.rejects(run);
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("Claude retries a failed resume once without the saved session ID", async () => {
  const resumes: Array<string | undefined> = [];
  const saved: string[] = [];
  const adapter = new ClaudeAdapter(
    ((input: { options?: { resume?: string } }) => {
      resumes.push(input.options?.resume);
      if (input.options?.resume) return fakeQuery([], new Error("Session cannot be resumed"));
      return fakeQuery([
        {
          type: "stream_event",
          session_id: "replacement-session",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
        } as SDKMessage,
        {
          type: "result",
          subtype: "success",
          session_id: "replacement-session",
        } as SDKMessage,
      ]);
    }) as never,
  );

  await adapter.run(context({
    agentSessionId: "missing-session",
    saveAgentSessionId: (id) => saved.push(id),
  }));

  assert.deepEqual(resumes, ["missing-session", undefined]);
  assert.deepEqual(saved, ["replacement-session"]);
});

Deno.test("Claude does not retry a resume after turn output has started", async () => {
  let calls = 0;
  const adapter = new ClaudeAdapter(
    (() => {
      calls++;
      return fakeQuery([{
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } },
      } as SDKMessage], new Error("Turn failed"));
    }) as never,
  );

  await assert.rejects(() => adapter.run(context({ agentSessionId: "existing-session" })), /Turn failed/);
  assert.equal(calls, 1);
});

function fakeQuery(
  messages: SDKMessage[],
  error?: Error,
  overrides: Record<string, unknown> = {},
) {
  const stream = (async function* () {
    for (const message of messages) yield message;
    if (error) throw error;
  })();
  return Object.assign(stream, {
    interrupt: () => Promise.resolve(undefined),
    close: () => {},
    ...overrides,
  });
}

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    sessionId: "session",
    turnId: "turn",
    cwd: Deno.cwd(),
    prompt: "hello",
    attachments: [],
    model: null,
    mode: null,
    agentSessionId: null,
    signal: new AbortController().signal,
    emit: () => {},
    approve: () => Promise.resolve({ optionId: "deny", scope: "once" }),
    ask: () => Promise.resolve({ answers: {}, cancelled: true }),
    saveAgentSessionId: () => {},
    ...overrides,
  };
}
