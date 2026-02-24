import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { formatTable, outputResult, outputError, outputSuccess } from "../output.ts";

describe("formatTable", () => {
  it("formats simple data into aligned columns", () => {
    const rows = [
      { name: "Alice", age: 30, role: "admin" },
      { name: "Bob", age: 25, role: "user" },
    ];
    const result = formatTable(rows);
    const lines = result.split("\n");

    // Header line
    expect(lines[0]).toContain("NAME");
    expect(lines[0]).toContain("AGE");
    expect(lines[0]).toContain("ROLE");

    // Separator line
    expect(lines[1]).toMatch(/^[-\s]+$/);

    // Data lines
    expect(lines[2]).toContain("Alice");
    expect(lines[2]).toContain("30");
    expect(lines[2]).toContain("admin");

    expect(lines[3]).toContain("Bob");
    expect(lines[3]).toContain("25");
    expect(lines[3]).toContain("user");
  });

  it("handles missing/null column values with dash", () => {
    const rows = [
      { name: "Alice", email: "alice@test.com" },
      { name: "Bob", email: null },
    ];
    const result = formatTable(rows);
    const lines = result.split("\n");

    expect(lines[3]).toContain("Bob");
    expect(lines[3]).toContain("-");
  });

  it("handles undefined column values with dash", () => {
    const rows = [
      { name: "Alice", email: "alice@test.com" },
      { name: "Bob" },
    ];
    const result = formatTable(rows, ["name", "email"]);
    const lines = result.split("\n");

    expect(lines[3]).toContain("-");
  });

  it("uses specified columns when provided", () => {
    const rows = [
      { name: "Alice", age: 30, role: "admin", secret: "hidden" },
    ];
    const result = formatTable(rows, ["name", "role"]);
    const lines = result.split("\n");

    expect(lines[0]).toContain("NAME");
    expect(lines[0]).toContain("ROLE");
    expect(lines[0]).not.toContain("AGE");
    expect(lines[0]).not.toContain("SECRET");
  });

  it("truncates long values at 40 characters", () => {
    const longValue = "A".repeat(50);
    const rows = [{ name: longValue }];
    const result = formatTable(rows);
    const lines = result.split("\n");

    // Data line should contain truncated value with "..."
    expect(lines[2]).toContain("...");
    expect(lines[2].length).toBeLessThan(60); // some padding but not 50+
  });

  it("returns message for empty rows", () => {
    const result = formatTable([]);
    expect(result).toBe("No results found.");
  });

  it("handles object values by JSON stringifying", () => {
    const rows = [{ name: "Test", data: { key: "value" } }];
    const result = formatTable(rows);
    expect(result).toContain('{"key":"value"}');
  });
});

describe("outputResult", () => {
  let stdoutData: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdoutData = "";
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutData += chunk.toString();
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("outputs JSON when json flag is true", () => {
    const data = { name: "test", value: 42 };
    outputResult(data, { json: true });
    const parsed = JSON.parse(stdoutData.trim());
    expect(parsed).toEqual(data);
  });

  it("outputs formatted JSON with indentation", () => {
    const data = { a: 1 };
    outputResult(data, { json: true });
    expect(stdoutData).toContain("  ");
  });

  it("outputs table for array data without json flag", () => {
    const data = [
      { name: "Alice", role: "admin" },
      { name: "Bob", role: "user" },
    ];
    outputResult(data, { json: false });
    expect(stdoutData).toContain("NAME");
    expect(stdoutData).toContain("ROLE");
    expect(stdoutData).toContain("Alice");
    expect(stdoutData).toContain("Bob");
  });

  it("outputs key-value pairs for object data without json flag", () => {
    const data = { name: "test", value: "42" };
    outputResult(data, { json: false });
    expect(stdoutData).toContain("name");
    expect(stdoutData).toContain("test");
    expect(stdoutData).toContain("value");
    expect(stdoutData).toContain("42");
  });

  it("outputs string data as-is", () => {
    outputResult("hello world", { json: false });
    expect(stdoutData.trim()).toBe("hello world");
  });
});

describe("outputError", () => {
  let stderrData: string;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrData = "";
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      stderrData += chunk.toString();
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("writes error message to stderr with prefix", () => {
    outputError("something went wrong");
    expect(stderrData).toBe("Error: something went wrong\n");
  });
});

describe("outputSuccess", () => {
  let stdoutData: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdoutData = "";
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      stdoutData += chunk.toString();
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("writes success message to stdout", () => {
    outputSuccess("operation completed");
    expect(stdoutData).toBe("operation completed\n");
  });
});
