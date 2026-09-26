import { NextResponse } from "next/server";
import { z } from "zod";
import {
  allowedContext,
  personality,
  timedMemory,
  demoReply,
  characterPrompt,
} from "@/lib/game/engine";
import {
  owner,
  guard,
  body,
  verify,
  failure,
  pack,
} from "@/lib/server/session";
// No public endpoint accepts an analysis score or directly changes memory state.
export async function POST(request: Request) {
  try {
    const device = await owner();
    guard(request, device + ":memory");
    const input = z
      .object({
        token: z.string().max(40000),
        action: z.literal("reveal").optional(),
      })
      .parse(await body(request));
    const state = verify(input.token, device);
    if (input.action === "reveal") {
      const next = timedMemory(state);
      const reply = demoReply(next.state, next.unlocked, next.gain);
      if (next.unlocked)
        next.state.history = [
          ...next.state.history,
          { role: "assistant" as const, content: reply },
        ].slice(-16);
      return NextResponse.json({
        ...pack(next.state),
        unlocked: next.unlocked,
        gain: next.gain,
        reply,
        context: characterPrompt(next.state),
      });
    }
    return NextResponse.json({
      memories: state.memories,
      personality: personality(state),
      context: allowedContext(state),
    });
  } catch (e) {
    return failure(e);
  }
}
