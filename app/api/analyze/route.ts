import { NextResponse } from "next/server";
import { z } from "zod";
import {
  advance,
  demoAnalyze,
  demoReply,
  characterPrompt,
} from "@/lib/game/engine";
import { analyze, reply } from "@/lib/server/openai";
import {
  owner,
  guard,
  body,
  verify,
  pack,
  failure,
  requireAccess,
} from "@/lib/server/session";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const device = await owner();
    guard(request, device + ":turn", 30);
    const input = z
      .object({
        token: z.string().max(40000),
        message: z.string().trim().min(1).max(1500),
        voice: z.boolean().optional(),
        signals: z
          .object({
            smileDelta: z.number().min(-1).max(1),
            headMovement: z.number().min(0).max(1),
            eyeMovement: z.number().min(0).max(1),
            mouthMovement: z.number().min(0).max(1),
          })
          .nullable()
          .optional(),
      })
      .parse(await body(request));
    const state = verify(input.token, device);
    if (state.completed)
      return NextResponse.json({
        ...pack(state),
        unlocked: null,
        gain: 0,
        reply: state.history.at(-1)?.content,
        context: characterPrompt(state),
      });
    if (state.mode === "live") requireAccess(request);
    const assessment =
      state.mode === "demo"
        ? demoAnalyze(state, input.message)
        : await analyze(state, input.message, input.signals ?? null);
    const next = advance(state, assessment, input.message);
    let response = demoReply(next.state, next.unlocked, next.gain);
    let warning: string | null = null;
    if (state.mode === "live" && !input.voice && !next.state.completed) {
      try {
        response = await reply(next.state);
      } catch {
        warning =
          "記憶の判定は完了しました。AIの返答が届かなかったため、物語の台詞を表示しています。";
      }
    }
    next.state.history = [
      ...next.state.history,
      { role: "assistant" as const, content: response },
    ].slice(-16);
    while (
      next.state.history.length > 2 &&
      next.state.history.reduce((n, m) => n + m.content.length, 0) > 6500
    )
      next.state.history.shift();
    return NextResponse.json({
      ...pack(next.state),
      unlocked: next.unlocked,
      gain: next.gain,
      reply: response,
      warning,
      context: characterPrompt(next.state),
    });
  } catch (e) {
    return failure(e);
  }
}
