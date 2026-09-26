import { NextResponse } from "next/server";
import { z } from "zod";
import {
  advance,
  directAnalysis,
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
        spoken: z.string().trim().max(1500).optional(),
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
    let warning: string | null = null;
    let assessment;
    const direct = directAnalysis(state, input.message);
    if (direct) assessment = direct;
    else if (state.mode === "demo")
      assessment = demoAnalyze(state, input.message);
    else
      try {
        assessment = await analyze(state, input.message, input.signals ?? null);
      } catch {
        // A failed judgement call used to end the turn outright, leaving her
        // with nothing to say. Keyword scoring keeps the conversation moving.
        assessment = demoAnalyze(state, input.message);
        warning =
          "AIの判定に届かなかったため、この一手はかんたんな判定で進めています。";
      }
    const next = advance(state, assessment, input.message);
    let response = demoReply(next.state, next.unlocked, next.gain);
    if (
      state.mode === "live" &&
      !input.voice &&
      !next.state.completed &&
      !next.unlocked
    ) {
      try {
        response = await reply(next.state);
      } catch {
        warning =
          "記憶の判定は完了しました。AIの返答が届かなかったため、物語の台詞を表示しています。";
      }
    }
    // During a voice call GPT-Live is the one speaking, so the transcript of
    // what she actually said is the real assistant turn. Writing the fallback
    // line into history instead is what made her repeat herself.
    const logged =
      input.voice && input.spoken && !next.state.completed
        ? input.spoken
        : response;
    next.state.history = [
      ...next.state.history,
      { role: "assistant" as const, content: logged },
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
