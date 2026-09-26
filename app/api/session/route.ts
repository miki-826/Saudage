import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createState } from "@/lib/game/engine";
import {
  owner,
  guard,
  body,
  verify,
  pack,
  failure,
  saveCloud,
  loadCloud,
  AppError,
} from "@/lib/server/session";
export async function POST(request: Request) {
  try {
    const device = await owner(true);
    guard(request, device + ":session");
    const input = z
      .object({
        action: z.enum(["new", "load", "save"]),
        token: z.string().max(40000).optional(),
        mode: z.literal("live").optional(),
      })
      .parse(await body(request));
    if (input.action === "new") {
      if (!process.env.OPENAI_API_KEY)
        throw new AppError("会話を始めるにはOpenAI APIの設定が必要です。", 503);
      return NextResponse.json({
        ...pack(createState(randomUUID(), device, "live")),
        cloud: false,
      });
    }
    if (input.action === "load") {
      const state = input.token
        ? verify(input.token, device)
        : await loadCloud(device);
      if (!state)
        return NextResponse.json(
          { error: "保存された記憶はまだありません。" },
          { status: 404 },
        );
      return NextResponse.json(pack(state));
    }
    if (!input.token) throw new Error("Missing token");
    const state = verify(input.token, device);
    const cloud = await saveCloud(state);
    return NextResponse.json({ ...pack(state), cloud });
  } catch (e) {
    return failure(e);
  }
}
