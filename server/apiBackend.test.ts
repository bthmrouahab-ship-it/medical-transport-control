import { describe, expect, it } from "vitest";
import { stableStringify } from "../client/src/lib/apiBackend";

describe("change detection for saved data", () => {
  it("ignores field order and undefined values", () => {
    expect(stableStringify({ a: 1, b: { c: [1, { d: 2, e: 3 }] }, x: undefined }))
      .toBe(stableStringify({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
