#!/usr/bin/env -S deno run --allow-read --allow-net

import process from "node:process";
import { parseArgs } from "node:util";

import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { hstore } from "npm:@electric-sql/pglite@0.3.14/contrib/hstore";
import { PGLiteSocketServer } from "npm:@electric-sql/pglite-socket@0.0.19";

const args = parseArgs({
  options: {
    db: {
      short: "d",
      type: "string",
      default: "memory://",
    },
    port: {
      short: "p",
      type: "string",
      default: "5432",
    },
    host: {
      short: "H",
      type: "string",
      default: "127.0.0.1",
    },
    verbose: {
      short: "v",
      type: "boolean",
      default: false,
    },
    help: {
      short: "h",
      type: "boolean",
      default: false,
    },
  },
});

const usage = `Options:
  -d, --db=DATABASE   (default: memory://)
  -p, --port=PORT     (default: 5432)
  -H, --host=HOST     (default: 127.0.0.1)
  -v, --verbose
  -h, --help
`;

if (args.values.help) {
  process.stderr.write(usage);
  process.exit();
}

const port = Number.parseInt(args.values.port ?? "", 10);
if (!Number.isInteger(port) || port < 0) {
  process.stderr.write(usage);
  process.exit(-1);
}

const host = args.values.host ?? "";

const db = new class extends PGlite {
  constructor() {
    super({
      extensions: { hstore },
    });
  }

  override execProtocolRawSync(message: Uint8Array): Uint8Array {
    // SSLRequest (F)
    if (
      message.length === 8 &&
      message[0] === 0x00 &&
      message[1] === 0x00 &&
      message[2] === 0x00 &&
      message[3] === 0x08 &&
      message[4] === 0x04 &&
      message[5] === 0xd2 &&
      message[6] === 0x16 &&
      message[7] === 0x2f
    ) {
      return Uint8Array.of(0x4e); // N
    }

    return super.execProtocolRawSync(message);
  }
}();

const server = new PGLiteSocketServer({
  db,
  debug: args.values.verbose,
  inspect: args.values.verbose,
  host,
  port,
});

process.on("SIGTERM", () => server.stop());
process.on("SIGINT", () => server.stop());
process.on("SIGQUIT", () => server.stop());
process.on("SIGHUP", () => server.stop());

server.addEventListener("listening", (event) => {
  const { detail: { port, host } } = event as CustomEvent<
    { port?: number; host?: string }
  >;
  console.log(`Listening: ${host}:${port}`);
});

server.addEventListener("connection", (event) => {
  const { detail: { clientAddress, clientPort } } = event as CustomEvent<
    { clientAddress?: string; clientPort?: number }
  >;
  // FIXME dpu Why?
  console.log(`Connecting: ${clientAddress}:${clientPort}`);
});

server.addEventListener("error", (event) => {
  console.error(event);
});

await server.start();
