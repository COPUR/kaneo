import { describe, expect, it } from "vite-plus/test";
import { isAllowedHost } from "./allowed-host.js";

describe("isAllowedHost", () => {
  const allowed = ["localhost", "127.0.0.1", "[::1]"];

  it("ignores the port", () => {
    expect(isAllowedHost("localhost:7101", allowed)).toBe(true);
    expect(isAllowedHost("127.0.0.1", allowed)).toBe(true);
  });

  it("handles IPv6 literals", () => {
    expect(isAllowedHost("[::1]:7101", allowed)).toBe(true);
  });

  it("rejects other names and a missing header", () => {
    expect(isAllowedHost("evil.example:7101", allowed)).toBe(false);
    expect(isAllowedHost("localhost.evil.example", allowed)).toBe(false);
    expect(isAllowedHost(undefined, allowed)).toBe(false);
  });
});
