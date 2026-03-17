import { describe, test, expect } from "bun:test";
import { RefreshFailureGate } from "@lazyusage/core";

describe("RefreshFailureGate", () => {
  test("canAttempt returns true initially", () => {
    const gate = new RefreshFailureGate();
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(true);
  });

  test("recordSuccess resets state after failure", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("timeout");
    gate.recordSuccess();
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(true);
  });

  test("recordFailure with invalid_grant sets terminal block", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("invalid_grant");
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
  });

  test("terminal block persists across multiple canAttempt calls", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("invalid_grant");
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
  });

  test("token change auto-heals terminal block", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("invalid_grant");
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
    // New token should auto-heal
    expect(gate.canAttempt("sk-ant-ort01-newtoken456")).toBe(true);
  });

  test("transient failure blocks with backoff", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("timeout");
    // Should be blocked (backoff active)
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
  });

  test("recordSuccess after transient failure allows retry", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("timeout");
    gate.recordSuccess();
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(true);
  });

  test("reset clears all state", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("invalid_grant");
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
    gate.reset();
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(true);
  });

  test("token change auto-heals transient backoff", () => {
    const gate = new RefreshFailureGate();
    gate.canAttempt("sk-ant-ort01-abc123xyz");
    gate.recordFailure("timeout");
    expect(gate.canAttempt("sk-ant-ort01-abc123xyz")).toBe(false);
    expect(gate.canAttempt("sk-ant-ort01-differenttoken")).toBe(true);
  });
});
