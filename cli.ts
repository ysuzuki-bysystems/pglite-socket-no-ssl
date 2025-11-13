#!/usr/bin/env -S deno run --allow-read --allow-net

import process from "node:process";
import { createServer } from "node:net";
import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { hstore } from "npm:@electric-sql/pglite@0.3.14/contrib/hstore";
import { PGLiteSocketHandler } from "npm:@electric-sql/pglite-socket@0.0.19";

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

const db = new PGlite({
  dataDir: args.values.db,
  debug: args.values.verbose ? 1 : 0,
  extensions: { hstore },
});

const handler = new PGLiteSocketHandler({
  db,
  closeOnDetach: true,
  inspect: false,
});

const server = createServer();
server.on("connection", (socket) => {
  console.log(`< ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on(
    "close",
    () => console.log(`> ${socket.remoteAddress}:${socket.remotePort}`),
  );

  let buf = Buffer.alloc(0);
  function onreadable() {
    let chunk: Buffer;
    while (buf.length < 8 && (chunk = socket.read()) !== null) {
      buf = Buffer.concat([buf, chunk]);
    }

    if (buf.length < 8) {
      return;
    }

    if (
      Buffer.of(0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f).equals(
        buf.subarray(0, 8),
      )
    ) {
      socket.write(Buffer.from("N"));
      buf = buf.subarray(8);
    }

    if (buf.length > 0) {
      socket.unshift(buf);
    }

    socket.off("readable", onreadable);
    socket.pause();

    db.waitReady.then(() => {
      socket.resume();
      handler.attach(socket).catch((err) => {
        console.error(err);
        socket.end();
      });
    });
  }

  socket.on("readable", onreadable);
});

server.listen(port, host, () => {
  const addr = server.address();
  let addrText;
  if (addr === null || typeof addr === "string") {
    addrText = addr ?? "(unknown)";
  } else {
    addrText = `${addr.address}:${addr.port}`;
  }
  console.log(`Listening: ${addrText}`);
});
