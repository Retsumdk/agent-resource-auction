import { describe, test, expect } from "bun:test";
import { existsSync } from "fs";

describe("agent-resource-auction", () => {
  test("Core index file exists", () => {
    expect(existsSync("src/index.ts")).toBe(true);
  });
  
  test("State directory structure", () => {
    expect(existsSync("data")).toBe(true);
  });
});
