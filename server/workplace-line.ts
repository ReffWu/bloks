// This end of a network-off container's line (bin/bloks-line.mjs).
//
// The line carries connections out of the container over docker exec's
// stdio. Each one arrives here labelled with the opening it came through,
// and this is where it is decided what it may reach: the gate, for the
// one opening, and for the other an HTTPS proxy that lets a CONNECT
// through to the engine's own hosts on 443 and refuses everything else.
// A plain HTTP request, a CONNECT anywhere else, a port other than 443,
// all get a 403 and are closed.
import { connect, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";

const READY = 1;
const OPEN = 2;
const DATA = 3;
const END = 4;
const FAIL = 5;

/** A proxy request bigger than this before its blank line is not one. */
const MAX_HEAD = 16 * 1024;

export function frame(type: number, id: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(9);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(id, 1);
  head.writeUInt32BE(payload.length, 5);
  return Buffer.concat([head, payload]);
}

/** Whether a CONNECT target is one this engine's service answers on. */
export function allowedTarget(target: string, hosts: readonly string[]): boolean {
  const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(target);
  if (!match) return false;
  return match[2] === "443" && hosts.includes(match[1].toLowerCase());
}

export interface LineHost {
  /** The ports it listens on inside the container, once it does. */
  ready: Promise<{ bloksPort: number; proxyPort: number }>;
  close(): void;
}

/**
 * Speaks the line over a child's stdio. `gate` is where the Bloks opening
 * goes; `hosts` is all the proxy opening may reach. `dial` is net.connect,
 * replaceable so a test can watch where things go.
 */
export function hostLine(io: { stdin: Writable; stdout: Readable }, options: { gate: { host: string; port: number }; hosts: readonly string[]; dial?: typeof connect }): LineHost {
  const dial = options.dial ?? connect;
  const open = new Map<number, Socket | { head: Buffer }>();
  let settle!: { resolve: (ports: { bloksPort: number; proxyPort: number }) => void; reject: (error: Error) => void };
  const ready = new Promise<{ bloksPort: number; proxyPort: number }>((resolve, reject) => (settle = { resolve, reject }));
  ready.catch(() => {});
  const send = (type: number, id: number, payload?: Buffer) => {
    if (!io.stdin.writableEnded) io.stdin.write(frame(type, id, payload));
  };
  const finish = (id: number) => {
    const held = open.get(id);
    if (!held) return;
    open.delete(id);
    send(END, id);
    if ("destroy" in held) held.destroy();
  };
  const pipe = (id: number, socket: Socket) => {
    open.set(id, socket);
    socket.on("data", (chunk: Buffer) => send(DATA, id, chunk));
    socket.on("end", () => finish(id));
    socket.on("close", () => finish(id));
    socket.on("error", () => finish(id));
  };
  const refuse = (id: number) => {
    send(DATA, id, Buffer.from("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"));
    finish(id);
  };
  const proxyData = (id: number, held: { head: Buffer }, chunk: Buffer) => {
    held.head = Buffer.concat([held.head, chunk]);
    const end = held.head.indexOf("\r\n\r\n");
    if (end === -1) {
      if (held.head.length > MAX_HEAD) refuse(id);
      return;
    }
    const [line] = held.head.subarray(0, end).toString("latin1").split("\r\n");
    const rest = held.head.subarray(end + 4);
    const match = /^CONNECT (\S+) HTTP\/1\.[01]$/.exec(line ?? "");
    if (!match || !allowedTarget(match[1], options.hosts)) return refuse(id);
    const [host, port] = [match[1].slice(0, match[1].lastIndexOf(":")), Number(match[1].slice(match[1].lastIndexOf(":") + 1))];
    const upstream = dial({ host, port });
    open.set(id, upstream);
    upstream.once("connect", () => {
      send(DATA, id, Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n"));
      if (rest.length) upstream.write(rest);
    });
    upstream.on("data", (data: Buffer) => send(DATA, id, data));
    upstream.on("end", () => finish(id));
    upstream.on("close", () => finish(id));
    upstream.on("error", () => finish(id));
  };

  let pending: Buffer = Buffer.alloc(0);
  io.stdout.on("data", (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 9) {
      const length = pending.readUInt32BE(5);
      if (pending.length < 9 + length) break;
      const type = pending[0];
      const id = pending.readUInt32BE(1);
      const payload = Buffer.from(pending.subarray(9, 9 + length));
      pending = pending.subarray(9 + length);
      if (type === READY) {
        try {
          const ports = JSON.parse(payload.toString("utf8"));
          settle.resolve({ bloksPort: Number(ports.bloksPort), proxyPort: Number(ports.proxyPort) });
        } catch {
          settle.reject(new Error("the line said something that was not its ports"));
        }
      } else if (type === FAIL) {
        settle.reject(new Error(payload.toString("utf8").slice(0, 300) || "the line could not listen"));
      } else if (type === OPEN) {
        const kind = payload.toString("utf8");
        if (kind === "bloks") pipe(id, dial({ host: options.gate.host, port: options.gate.port }));
        else if (kind === "proxy") open.set(id, { head: Buffer.alloc(0) });
        else send(END, id);
      } else if (type === DATA) {
        const held = open.get(id);
        if (!held) continue;
        if ("head" in held) proxyData(id, held, payload);
        else held.write(payload);
      } else if (type === END) {
        const held = open.get(id);
        open.delete(id);
        if (held && "end" in held) held.end();
      }
    }
  });
  io.stdout.on("end", () => settle.reject(new Error("the line closed before it was ready")));

  return {
    ready,
    close() {
      for (const id of [...open.keys()]) finish(id);
      if (!io.stdin.writableEnded) io.stdin.end();
    },
  };
}
