export type JsonObject = Record<string, any>;
type JsonLineRpcOptions = { jsonRpcVersion?: "2.0" };

export class JsonLineRpc {
  #process: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #status: Promise<Deno.CommandStatus>;
  #nextId = 1;
  #pending = new Map<number | string, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();
  #readerTask: Promise<void>;
  #stopTask: Promise<void> | null = null;
  onNotification: (message: JsonObject) => Promise<void> | void = () => {};
  onRequest: (message: JsonObject) => Promise<unknown> = () =>
    Promise.resolve({ error: "Unsupported request" });
  onStderr: (line: string) => void = () => {};

  constructor(command: string, args: string[], cwd: string, private options: JsonLineRpcOptions = {}) {
    this.#process = new Deno.Command(command, { args, cwd, stdin: "piped", stdout: "piped", stderr: "piped" })
      .spawn();
    this.#writer = this.#process.stdin.getWriter();
    this.#status = this.#process.status;
    void this.#status.then(
      () => this.rejectPending(new Error("Agent process closed")),
      (error) => this.rejectPending(error),
    );
    this.#readerTask = Promise.all([this.readStdout(), this.readStderr()]).then(() => undefined);
  }

  async call(method: string, params: JsonObject = {}): Promise<any> {
    const id = this.#nextId++;
    const response = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    void response.catch(() => {});
    await this.write({ id, method, params });
    return await response;
  }

  async notify(method: string, params: JsonObject = {}) {
    await this.write({ method, params });
  }

  async reply(id: number | string, result: unknown, error?: unknown) {
    await this.write(error ? { id, error } : { id, result });
  }

  async stop() {
    this.#stopTask ??= this.stopProcess();
    await this.#stopTask;
  }

  private async stopProcess() {
    const status = this.#status;
    try {
      await this.#writer.close();
    } catch { /* already closed */ }
    try {
      this.#process.kill("SIGTERM");
    } catch { /* already exited */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      status.then(() => true),
      new Promise<false>((resolve) => timer = setTimeout(() => resolve(false), 2000)),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!exited) {
      try {
        this.#process.kill("SIGKILL");
      } catch { /* already exited */ }
      await status;
    }
    await this.#readerTask.catch(() => undefined);
  }

  get status() {
    return this.#status;
  }

  private async write(value: JsonObject) {
    const message = this.options.jsonRpcVersion ? { ...value, jsonrpc: this.options.jsonRpcVersion } : value;
    await this.#writer.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  }

  private async readStdout() {
    await readLines(this.#process.stdout, async (line) => {
      let message: JsonObject;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && ("result" in message || "error" in message)) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        message.error ? pending.reject(message.error) : pending.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        void this.handleRequest(message);
      } else {
        await this.onNotification(message);
      }
    });
    this.rejectPending(new Error("Agent process closed"));
  }

  private async handleRequest(message: JsonObject) {
    try {
      await this.reply(message.id, await this.onRequest(message));
    } catch (error) {
      try {
        await this.reply(message.id, null, {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch { /* the child may already have exited */ }
    }
  }

  private rejectPending(error: unknown) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  private async readStderr() {
    await readLines(this.#process.stderr, (line) => this.onStderr(line));
  }
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => Promise<void> | void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await onLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await onLine(buffer.trim());
}
