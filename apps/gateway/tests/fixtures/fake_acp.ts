const outputPath = Deno.args[0];
const current = { model: "default", mode: "ask" };
const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.jsonrpc !== "2.0") Deno.exit(2);
    if (message.id === undefined) continue;
    if (message.method === "session/new") {
      respond(message.id, Deno.args[1] === "dedicated"
        ? {
          sessionId: "fake-session",
          models: {
            currentModelId: current.model,
            availableModels: [{ modelId: "default" }, { modelId: "selected-model" }],
          },
          modes: {
            currentModeId: current.mode,
            availableModes: [{ id: "ask" }, { id: "plan" }],
          },
        }
        : {
          sessionId: "fake-session",
          configOptions: configOptions(),
        });
    } else if (message.method === "session/set_model" || message.method === "session/set_mode") {
      await Deno.writeTextFile(outputPath, `${JSON.stringify({ method: message.method, ...message.params })}\n`, {
        append: true,
        create: true,
      });
      respond(message.id, {});
    } else if (message.method === "session/set_config_option") {
      await Deno.writeTextFile(outputPath, `${JSON.stringify(message.params)}\n`, {
        append: true,
        create: true,
      });
      current[message.params.configId as "model" | "mode"] = message.params.value;
      respond(message.id, { configOptions: configOptions() });
    } else if (message.method === "session/prompt") {
      await Deno.writeTextFile(
        outputPath,
        `${JSON.stringify({ prompt: message.params.prompt })}\n`,
        { append: true, create: true },
      );
      respond(message.id, { stopReason: "end_turn" });
    } else {
      respond(message.id, {});
    }
  }
}

function respond(id: number, result: unknown) {
  console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function configOptions() {
  return [
    {
      id: "provider",
      category: "model",
      type: "select",
      currentValue: "fake-provider",
      options: [{ value: "fake-provider" }],
    },
    {
      id: "model",
      category: "model",
      type: "select",
      currentValue: current.model,
      options: [{ value: "default" }, { value: "selected-model" }],
    },
    {
      id: "mode",
      category: "mode",
      type: "select",
      currentValue: current.mode,
      options: [{ value: "ask" }, { value: "plan" }],
    },
  ];
}
