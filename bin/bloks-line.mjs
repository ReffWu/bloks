#!/usr/bin/env node
// A container's one line out, when its network is off.
//
// A container started with no network can reach nothing, Bloks and the
// engine's own service included, and an engine that cannot reach its
// service cannot think. So Bloks copies this into the container for the
// length of a turn and runs it over `docker exec -i`, whose stdio is the
// only path in or out. It listens on two ports of the container's own
// loopback and carries each connection made to them back over its stdout
// to Bloks, which decides what each may reach:
//
//   the first   is Bloks' gate (BLOKS_URL), for the agent's command line
//               and its MCP helpers, which answer only the turn's token
//   the second  is an HTTPS proxy (HTTPS_PROXY), which Bloks lets through
//               only to the hosts of the engine's own service
//
// Nothing here decides anything; it is a pipe with two openings. Frames,
// both ways: one byte of type, four of connection id, four of length,
// then the bytes.
import { createServer } from "node:net";

const READY = 1;
const OPEN = 2;
const DATA = 3;
const END = 4;
const FAIL = 5;

const [bloksPort, proxyPort] = process.argv.slice(2).map(Number);
const sockets = new Map();
let next = 1;

function send(type, id, payload = Buffer.alloc(0)) {
  const head = Buffer.alloc(9);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(id, 1);
  head.writeUInt32BE(payload.length, 5);
  process.stdout.write(Buffer.concat([head, payload]));
}

function listen(port, kind) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      const id = next++;
      sockets.set(id, socket);
      send(OPEN, id, Buffer.from(kind));
      socket.on("data", (chunk) => send(DATA, id, chunk));
      const closed = () => {
        if (sockets.delete(id)) send(END, id);
      };
      socket.on("end", closed);
      socket.on("close", closed);
      socket.on("error", () => {});
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

let pending = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  while (pending.length >= 9) {
    const length = pending.readUInt32BE(5);
    if (pending.length < 9 + length) break;
    const type = pending[0];
    const id = pending.readUInt32BE(1);
    const payload = pending.subarray(9, 9 + length);
    pending = pending.subarray(9 + length);
    const socket = sockets.get(id);
    if (!socket) continue;
    if (type === DATA) socket.write(payload);
    else if (type === END) {
      sockets.delete(id);
      socket.end();
    }
  }
});
// Bloks gone is the turn gone: nothing is left to carry
process.stdin.on("end", () => process.exit(0));

Promise.all([listen(bloksPort, "bloks"), listen(proxyPort, "proxy")]).then(
  () => send(READY, 0, Buffer.from(JSON.stringify({ bloksPort, proxyPort }))),
  (error) => {
    send(FAIL, 0, Buffer.from(String(error?.message ?? error)));
    process.exit(1);
  },
);
