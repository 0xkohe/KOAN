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
    if (message.id !== undefined) {
      console.log(JSON.stringify({
        id: message.id,
        result: { echoedMethod: message.method, jsonRpcVersion: message.jsonrpc },
      }));
      console.log(JSON.stringify({ method: "unknown/futureEvent", params: { safe: true } }));
    }
  }
}
