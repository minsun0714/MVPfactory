/** Trusted workspace-only MCP file tools; no shell, network, or environment access. */
import { createInterface } from "node:readline";
import {
  realpath,
  lstat,
  mkdir,
  readFile,
  writeFile,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {string} root @param {string} name @param {unknown} input */
export async function fileTool(root, name, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Arguments must be an object.");
  const args = /** @type {Record<string, unknown>} */ (input);
  const path = args.path;
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  )
    throw new Error("A relative file path is required.");
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        [".git", ".codex", ".agents", "node_modules", ".next"].includes(part) ||
        /^\.env(?:\.|$)/.test(part) ||
        /^AGENTS\.md$/i.test(part),
    )
  )
    throw new Error("This path is not allowed.");
  let target = await realpath(root);
  for (let i = 0; i < parts.length; i++) {
    target = join(target, parts[i]);
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
        throw new Error("Links are not allowed.");
      if (i < parts.length - 1 && !stat.isDirectory())
        throw new Error("Invalid parent directory.");
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  if (name === "write_file") {
    if (
      typeof args.content !== "string" ||
      Buffer.byteLength(args.content) > 2 * 1024 * 1024
    )
      throw new Error("File content must be a string up to 2 MiB.");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, args.content, { mode: 0o600 });
    return "File written.";
  }
  if (name === "read_file") {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw new Error("Not a readable source file.");
    return await readFile(target, "utf8");
  }
  if (name === "delete_file") {
    if (!(await lstat(target)).isFile())
      throw new Error("Only files can be deleted.");
    await unlink(target);
    return "File deleted.";
  }
  throw new Error("Unknown file tool.");
}

const tools = ["write_file", "read_file", "delete_file"].map((name) => ({
  name,
  description: `${name} inside the generated app workspace only. Use write_file to create or replace actual source files.`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      ...(name === "write_file" ? { content: { type: "string" } } : {}),
    },
    required: name === "write_file" ? ["path", "content"] : ["path"],
    additionalProperties: false,
  },
}));

async function main() {
  const root = await realpath(process.argv[2]);
  if (!(await lstat(root)).isDirectory())
    throw new Error("Workspace is not a directory.");
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serialize operations so tool calls cannot race one another.
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 3 * 1024 * 1024) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    if (!request || typeof request !== "object" || !("id" in request)) continue;
    let result;
    if (request.method === "initialize")
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "factory-source-files", version: "1.0.0" },
      };
    else if (request.method === "ping") result = {};
    else if (request.method === "tools/list") result = { tools };
    else if (request.method === "tools/call") {
      try {
        result = {
          content: [
            {
              type: "text",
              text: await fileTool(
                root,
                request.params?.name,
                request.params?.arguments,
              ),
            },
          ],
        };
      } catch {
        result = {
          isError: true,
          content: [
            {
              type: "text",
              text: "File operation rejected. Check relative path, source-only file type, size, and file existence. Links, environment files and agent configuration are forbidden.",
            },
          ],
        };
      }
    } else {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Method not found" },
        }) + "\n",
      );
      continue;
    }
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write("Source file tool failed to start.\n");
    process.exitCode = 1;
  });
}
