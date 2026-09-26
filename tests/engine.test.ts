import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  advance,
  demoAnalyze,
  allowedContext,
  characterPrompt,
  memories,
  type Analysis,
} from "../lib/game/engine";
const newState = () =>
  createState("b28c3e4f-2e91-4aca-9e8b-1d8a97f4bc1d", "test-owner", "demo");
const perfect = (id: Analysis["relatedMemoryId"]): Analysis => ({
  relatedMemoryId: id,
  relevance: 1,
  hintStrength: 1,
  evidenceDepth: 1,
  engagement: 1,
  shouldAdvance: true,
});
test("A direct answer cannot unlock a memory in one turn", () => {
  const result = advance(newState(), perfect("store"), "コンビニで働いてた");
  assert.equal(result.state.memories[0].progress, 25);
  assert.equal(result.unlocked, null);
  assert.equal(result.state.memories[0].stage, 1);
});
test("Parent memory must have a fragment before children can advance", () => {
  assert.equal(
    advance(newState(), perfect("stocking"), "棚へ商品を並べた").gain,
    0,
  );
  const root = advance(newState(), perfect("store"), "夜の店").state;
  assert.equal(advance(root, perfect("stocking"), "棚へ商品を並べた").gain, 25);
});
test("Repetition and irrelevant conversations do not farm progress", () => {
  const first = advance(
    newState(),
    perfect("store"),
    "コンビニで働いてた",
  ).state;
  assert.equal(
    advance(first, perfect("store"), "コンビニで働いてた！").gain,
    0,
  );
  assert.equal(
    advance(first, { ...perfect("store"), shouldAdvance: false }, " unrelated ")
      .gain,
    0,
  );
  assert.equal(
    advance(first, { ...perfect("store"), relevance: 0.1 }, "moon").gain,
    0,
  );
});
test("Four distinct detailed conversations restore a memory", () => {
  let state = newState();
  for (let i = 0; i < 4; i++)
    state = advance(state, perfect("store"), `違う情景 ${i}`).state;
  assert.equal(state.memories[0].unlocked, true);
  assert.equal(state.memories[0].evidenceCount, 4);
  assert.equal(state.memories[0].stage, 3);
});
test("Locked facts never enter character context", () => {
  const state = newState();
  assert.deepEqual(allowedContext(state), []);
  assert.ok(!characterPrompt(state).includes("コンビニ"));
  assert.ok(!characterPrompt(state).includes("クレーム"));
});
test("Important memories clear without restoring every optional node", () => {
  let state = newState();
  for (const id of ["store", "service", "complaint", "regular"] as const) {
    for (let i = 0; i < 4; i++)
      state = advance(state, perfect(id), `${id} detailed evidence ${i}`).state;
  }
  assert.equal(state.completed, true);
  assert.equal(
    state.memories.find((m) => m.id === "stocking")!.unlocked,
    false,
  );
});
test("All five demo memories can be restored using distinct natural evidence", () => {
  let state = newState();
  for (const m of memories) {
    for (let i = 0; i < 6; i++) {
      const msg = `${m.keywords.slice(0, 5).join("、")}。あの頃の情景について、${i}つ目を思い出せるかな。`;
      state = advance(state, demoAnalyze(state, msg), msg).state;
      if (state.memories.find((s) => s.id === m.id)?.unlocked) break;
    }
  }
  assert.equal(state.completed, true);
  assert.equal(state.memories.filter((m) => m.unlocked).length, 5);
});
test("Invalid model scores are rejected", () => {
  assert.throws(() =>
    advance(newState(), { ...perfect("store"), relevance: 100 }, "bad score"),
  );
  assert.throws(() =>
    advance(newState(), { ...perfect("store"), hintStrength: NaN }, "NaN"),
  );
});
