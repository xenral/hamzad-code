// Serves a directory on this machine, for checking the installer against freshly packed files:
//   bun hamzad/test/serve.ts dist/hamzad 8765
//   HAMZAD_CLI_URL=http://127.0.0.1:8765 bash dist/hamzad/install

import path from "path"

const root = path.resolve(process.argv[2] ?? ".")
const server = Bun.serve({
  port: Number(process.argv[3] ?? 8765),
  hostname: "127.0.0.1",
  async fetch(request) {
    const file = path.join(root, decodeURIComponent(new URL(request.url).pathname))
    if (!file.startsWith(root) || !(await Bun.file(file).exists())) return new Response("Not found", { status: 404 })
    return new Response(Bun.file(file))
  },
})
console.log(`serving ${root} on http://127.0.0.1:${server.port}`)
