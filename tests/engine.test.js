import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuess, validateHardMode, normalizeWord } from "../src/index.js";

test("normalizes words", () => {
  assert.equal(normalizeWord("  CRANE "), "crane");
});

test("marks exact matches green and misplaced matches yellow", () => {
  assert.deepEqual(evaluateGuess("crane", "cared"), ["correct", "present", "present", "absent", "present"]);
});

test("duplicate letters are not over-counted", () => {
  assert.deepEqual(evaluateGuess("allee", "apple"), ["correct", "present", "absent", "absent", "correct"]);
});

test("hard mode requires revealed green positions", () => {
  const history = [{ word: "crane", result: ["correct", "absent", "present", "absent", "absent"] }];
  assert.equal(validateHardMode("bravo", history).valid, false);
  assert.equal(validateHardMode("cigar", history).valid, true);
});

test("hard mode enforces yellow letters and counts", () => {
  const history = [{ word: "allee", result: ["absent", "present", "absent", "correct", "absent"] }];
  assert.equal(validateHardMode("cello", history).valid, false);
  assert.equal(validateHardMode("hotel", history).valid, true);
});
