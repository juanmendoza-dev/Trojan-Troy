import { describe, expect, it } from "vitest";
import { advanceStatus } from "./messageStatus";

describe("advanceStatus", () => {
  it("advances from sent to delivered", () => {
    expect(advanceStatus("sent", "delivered")).toBe("delivered");
  });

  it("advances from delivered to read", () => {
    expect(advanceStatus("delivered", "read")).toBe("read");
  });

  it("advances directly from sent to read", () => {
    expect(advanceStatus("sent", "read")).toBe("read");
  });

  it("never regresses from read to delivered", () => {
    expect(advanceStatus("read", "delivered")).toBe("read");
  });

  it("never regresses from delivered to sent", () => {
    expect(advanceStatus("delivered", "sent")).toBe("delivered");
  });

  it("is a no-op when the status is unchanged", () => {
    expect(advanceStatus("delivered", "delivered")).toBe("delivered");
  });
});
