import { NextResponse } from "next/server";
import { z } from "zod";
import { liveConfig, openai } from "@/lib/server/openai";
import {
  owner,
  guard,
  body,
  verify,
  failure,
  requireAccess,
  AppError,
} from "@/lib/server/session";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const device = await owner();
    guard(request, device + ":live", 4);
    requireAccess(request);
    const input = z
      .object({
        token: z.string().max(40000),
        sdp: z.string().min(10).max(18000),
      })
      .parse(await body(request));
    const state = verify(input.token, device);
    if (state.mode === "demo")
      throw new AppError("体験モードではテキスト会話をご利用ください。", 400);
    const result = await openai("live/sessions", {
      session: liveConfig(state),
      transport: { type: "webrtc", sdp: input.sdp },
    });
    return NextResponse.json({
      session: { id: result.session.id },
      transport: { sdp: result.transport.sdp },
    });
  } catch (e) {
    return failure(e);
  }
}
