import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  advance,
  demoAnalyze,
  conversationHint,
  directAnalysis,
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
test("A correct topic unlocks a memory in one turn", () => {
  const result = advance(newState(), perfect("store"), "コンビニで働いてた");
  assert.equal(result.state.memories[0].progress, 100);
  assert.equal(result.unlocked, "store");
  assert.equal(result.state.memories[0].stage, 3);
});
test("Correct topics can restore child memories immediately", () => {
  assert.equal(
    advance(newState(), perfect("stocking"), "棚へ商品を並べた").gain,
    100,
  );
  const root = advance(newState(), perfect("store"), "夜の店").state;
  assert.equal(
    advance(root, perfect("stocking"), "棚へ商品を並べた").gain,
    100,
  );
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
test("An unlocked memory is not awarded again", () => {
  let state = newState();
  for (let i = 0; i < 4; i++)
    state = advance(state, perfect("store"), `違う情景 ${i}`).state;
  assert.equal(state.memories[0].unlocked, true);
  assert.equal(state.memories[0].evidenceCount, 1);
  assert.equal(state.memories[0].stage, 3);
});
test("Hints never change memory state, even after repeated hints", () => {
  const state = newState();
  state.createdAt = "2020-01-01T00:00:00.000Z";
  const before = structuredClone(state);
  for (let i = 0; i < 100; i++) assert.ok(conversationHint(state, i));
  assert.deepEqual(state, before);
});
test("Store words unlock the store memory and unrelated words do not", () => {
  for (const message of ["コンビニ", "お店", "お店で働いてた", "店"]) {
    const state = newState();
    const analysis = directAnalysis(state, message);
    assert.ok(analysis);
    assert.equal(advance(state, analysis, message).unlocked, "store");
  }
  assert.equal(directAnalysis(newState(), "宇宙船で旅行したい"), null);
});
test("Locked facts never enter character context", () => {
  const state = newState();
  assert.deepEqual(allowedContext(state), []);
  assert.ok(!characterPrompt(state).includes("コンビニ"));
  assert.ok(!characterPrompt(state).includes("クレーム"));
});
test("The ending waits for all five memories", () => {
  let state = newState();
  for (const id of ["store", "service", "complaint", "regular"] as const) {
    for (let i = 0; i < 4; i++)
      state = advance(state, perfect(id), `${id} detailed evidence ${i}`).state;
  }
  assert.equal(state.completed, false);
  assert.equal(
    state.memories.find((m) => m.id === "stocking")!.unlocked,
    false,
  );
  state = advance(state, perfect("stocking"), "商品を並べる").state;
  assert.equal(state.completed, true);
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

test("Semantic judgements unlock memories in any order without exact keywords", () => {
  let state = newState();
  const turns = [
    ["regular", "毎朝同じ飲み物を買う顔なじみ"],
    ["complaint", "強い口調で文句を言われて怖かった"],
    ["service", "お金を受け取って袋を渡す"],
    ["stocking", "箱から出して陳列する"],
    ["store", "夜中も買い物できる場所"],
  ] as const;
  for (const [index, [id, message]] of turns.entries()) {
    const result = advance(state, { ...perfect(id), relevance: 0.7 }, message);
    assert.equal(result.unlocked, id);
    state = result.state;
    assert.equal(state.completed, index === 4);
  }
});
