// gloam_fetch_paid's address guard: every spelling of a private address is refused,
// public addresses still pass, and the guarded fetch never reaches a local service.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { guardedFetch, isPrivateAddress, publicUrlProblem } from "../src/safeFetch.ts";

const PRIVATE = [
  "127.0.0.1",
  "10.1.2.3",
  "169.254.169.254",
  "::",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "0:0:0:0:0:ffff:7f00:1",
  "0000:0000:0000:0000:0000:ffff:7f00:0001",
  "::ffff:a9fe:a9fe",
  "0:0:0:0:0:ffff:a9fe:a9fe",
  "::ffff:0:7f00:1",
  "::7f00:1",
  "::127.0.0.1",
  "64:ff9b::7f00:1",
  "64:ff9b::a9fe:a9fe",
  "64:ff9b:1::1",
  "2002:7f00:1::",
  "2002:a9fe:a9fe::1",
  "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "fe80::1%lo0",
  "fec0::1",
  "ff02::1",
  "not-an-ip",
  "1::2::3",
];

const PUBLIC = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1"];

test("private and local addresses are refused in every spelling", () => {
  for (const ip of PRIVATE) assert.equal(isPrivateAddress(ip), true, ip);
});

test("public addresses still pass", () => {
  for (const ip of PUBLIC) assert.equal(isPrivateAddress(ip), false, ip);
});

test("URLs naming a local address are refused, including the hex mapped form", async () => {
  for (const url of [
    "http://[::ffff:7f00:1]:8098/",
    "http://[::ffff:127.0.0.1]:8098/",
    "http://[0:0:0:0:0:ffff:a9fe:a9fe]/latest/meta-data/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://2130706433/",
    "http://0x7f.1/",
  ]) {
    assert.match((await publicUrlProblem(url)) ?? "", /private or local address/, url);
  }
});

test("the guarded fetch never reaches a local service", async () => {
  const server = http.createServer((_req, res) => res.end("LOCAL-SERVICE-REACHED"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const fetchGuarded = guardedFetch({});
    for (const host of ["[::ffff:7f00:1]", "[::ffff:127.0.0.1]", "[0:0:0:0:0:ffff:7f00:1]", "127.0.0.1"]) {
      await assert.rejects(fetchGuarded(`http://${host}:${port}/`), /private or local address/, host);
    }
  } finally {
    server.close();
  }
});
