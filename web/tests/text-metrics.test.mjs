import test from "node:test";
import assert from "node:assert/strict";
import { characterCount } from "../src/lib/text-metrics.ts";

test("character counts include spaces and separators", () => {
  assert.equal(characterCount("Cresswind | Lady Lake"), 21);
  assert.equal(characterCount(""), 0);
  assert.equal(characterCount("  Home  "), 8);
});

test("character counts match Python exports for non-BMP Unicode", () => {
  // JavaScript string.length counts this emoji as two UTF-16 code units.
  assert.equal(characterCount("🏡 Homes | Café"), 14);
});
