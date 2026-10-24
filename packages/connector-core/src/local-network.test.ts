import assert from "node:assert/strict";
import test from "node:test";

import {
  isHttpsOrLocalNetworkHttpUrl,
  isLocalNetworkHostname,
} from "./local-network.ts";

test("recognizes local network hostnames and address ranges", () => {
  for (const hostname of [
    "localhost",
    "api.localhost",
    "raspi",
    "raspi.local",
    "router.home.arpa",
    "10.0.2.2",
    "100.64.0.1",
    "127.0.0.2",
    "169.254.1.2",
    "172.31.255.254",
    "192.168.51.72",
    "[::1]",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:192.168.51.72",
  ]) {
    assert.equal(isLocalNetworkHostname(hostname), true, hostname);
  }
});

test("does not classify public or malformed destinations as local", () => {
  for (const hostname of [
    "example.com",
    "mcp.example.test",
    "8.8.8.8",
    "100.128.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "2001:4860:4860::8888",
    "bad host",
    "-raspi",
  ]) {
    assert.equal(isLocalNetworkHostname(hostname), false, hostname);
  }
});

test("allows HTTPS everywhere and HTTP only on the local network", () => {
  assert.equal(
    isHttpsOrLocalNetworkHttpUrl(new URL("https://example.com/v1")),
    true,
  );
  assert.equal(
    isHttpsOrLocalNetworkHttpUrl(new URL("http://192.168.51.72:8787/v1")),
    true,
  );
  assert.equal(
    isHttpsOrLocalNetworkHttpUrl(new URL("http://raspi.local:8787/v1")),
    true,
  );
  assert.equal(
    isHttpsOrLocalNetworkHttpUrl(new URL("http://example.com/v1")),
    false,
  );
  assert.equal(
    isHttpsOrLocalNetworkHttpUrl(new URL("ftp://192.168.51.72/file")),
    false,
  );
});
