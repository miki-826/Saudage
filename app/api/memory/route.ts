import { NextResponse } from "next/server";
import { z } from "zod";
import { allowedContext, personality } from "@/lib/game/engine";
import { owner, guard, body, verify, failure } from "@/lib/server/session";
// No public endpoint accepts an analysis score or directly changes memory state.
export async function POST(request: Request) {
  try {
    const device = await owner();
    guard(request, device + ":memory");
    const input = z
      .object({ token: z.string().max(40000) })
      .parse(await body(request));
    const state = verify(input.token, device);
    return NextResponse.json({
      memories: state.memories,
      personality: personality(state),
      context: allowedContext(state),
    });
  } catch (e) {
    return failure(e);
  }
}
