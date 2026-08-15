import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { AcpAdapter, advertisedModels } from "../src/agents/acp.ts";
import type { RunContext } from "../src/agents/types.ts";

Deno.test("ACP model catalog supports dedicated and config-option formats", () => {
  assert.deepEqual(
    advertisedModels({
      models: {
        currentModelId: "fast",
        availableModels: [
          { modelId: "fast", name: "Fast" },
          { modelId: "smart", description: "More capable" },
        ],
      },
    }),
    [
      { id: "fast", label: "Fast", isDefault: true },
      { id: "smart", label: "smart", description: "More capable" },
    ],
  );
  assert.deepEqual(
    advertisedModels({
      configOptions: [{
        id: "model",
        category: "model",
        currentValue: "balanced",
        options: [{ value: "balanced", label: "Balanced" }],
      }],
    }),
    [{ id: "balanced", label: "Balanced", isDefault: true }],
  );
});

Deno.test("ACP applies advertised model and mode config options", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/fake_acp.ts", import.meta.url));
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-acp-" });
  const output = `${directory}/config.jsonl`;
  try {
    const image = `${directory}/image.png`;
    const notes = `${directory}/notes.txt`;
    await Deno.writeFile(image, new Uint8Array([1, 2, 3]));
    await Deno.writeTextFile(notes, "notes");
    const adapter = new AcpAdapter("opencode", "deno", [
      "run",
      "--quiet",
      `--allow-write=${output}`,
      fixture,
      output,
    ]);
    const context: RunContext = {
      sessionId: "session",
      turnId: "turn",
      cwd: directory,
      prompt: "hello",
      attachments: [
        { id: "image", name: "image.png", mediaType: "image/png", path: image },
        { id: "notes", name: "notes.txt", mediaType: "text/plain", path: notes },
      ],
      model: "selected-model",
      mode: "plan",
      agentSessionId: null,
      signal: new AbortController().signal,
      emit: () => {},
      approve: () => Promise.reject(new Error("unexpected approval")),
      ask: () => Promise.reject(new Error("unexpected question")),
      saveAgentSessionId: (id) => assert.equal(id, "fake-session"),
    };
    await adapter.run(context);
    const configured = (await Deno.readTextFile(output)).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(configured, [
      { sessionId: "fake-session", configId: "model", value: "selected-model" },
      { sessionId: "fake-session", configId: "mode", value: "plan" },
      {
        prompt: [
          {
            type: "text",
            text: `hello\n\nAttached local files:\n- notes.txt: ${notes}\n\nAttached images:\n- image.png`,
          },
          { type: "image", data: "AQID", mimeType: "image/png" },
        ],
      },
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ACP applies dedicated advertised model and mode controls", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/fake_acp.ts", import.meta.url));
  const directory = await Deno.makeTempDir({ dir: "/tmp", prefix: "koan-acp-dedicated-" });
  const output = `${directory}/config.jsonl`;
  try {
    const adapter = new AcpAdapter("cline", "deno", [
      "run",
      "--quiet",
      `--allow-write=${output}`,
      fixture,
      output,
      "dedicated",
    ]);
    const context: RunContext = {
      sessionId: "session",
      turnId: "turn",
      cwd: directory,
      prompt: "hello",
      attachments: [],
      model: "selected-model",
      mode: "plan",
      agentSessionId: null,
      signal: new AbortController().signal,
      emit: () => {},
      approve: () => Promise.reject(new Error("unexpected approval")),
      ask: () => Promise.reject(new Error("unexpected question")),
      saveAgentSessionId: (id) => assert.equal(id, "fake-session"),
    };

    await adapter.run(context);

    const configured = (await Deno.readTextFile(output)).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(configured, [
      { method: "session/set_model", sessionId: "fake-session", modelId: "selected-model" },
      { method: "session/set_mode", sessionId: "fake-session", modeId: "plan" },
      { prompt: [{ type: "text", text: "hello" }] },
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
