import {
  createHmac,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stateSchema, type GameState } from "@/lib/game/engine";

const cookieName = "live-device";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function secret() {
  const key = process.env.SESSION_SECRET || process.env.OPENAI_API_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === "production")
    throw new AppError(
      "セーブ用の SESSION_SECRET をVercelに設定してください。",
      503,
    );
  return "local-development-only-live";
}
export async function owner(create = false) {
  const jar = await cookies();
  let id = jar.get(cookieName)?.value;
  if (!id && create) {
    id = randomUUID();
    jar.set(cookieName, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  if (!id) throw new AppError("ホームから物語をはじめてください。", 401);
  return createHash("sha256").update(id).digest("hex");
}
export function sign(state: GameState) {
  const data = Buffer.from(JSON.stringify(state)).toString("base64url");
  return (
    data + "." + createHmac("sha256", secret()).update(data).digest("base64url")
  );
}
export function verify(token: string, device: string) {
  if (token.length > 40000) throw new AppError("セーブデータが大きすぎます。");
  const [data, signature] = token.split(".");
  if (!data || !signature) throw new AppError("セーブデータを読み込めません。");
  const expected = createHmac("sha256", secret()).update(data).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError("セーブデータの検証に失敗しました。");
  let state: GameState;
  try {
    state = stateSchema.parse(
      JSON.parse(Buffer.from(data, "base64url").toString()),
    );
  } catch {
    throw new AppError("セーブデータの形式が正しくありません。");
  }
  if (state.owner !== device)
    throw new AppError("このブラウザのセーブデータではありません。", 403);
  return state;
}
export function pack(state: GameState) {
  return {
    token: sign(state),
    state: { ...state, owner: undefined, seen: undefined },
  };
}
const rate = new Map<string, { count: number; reset: number }>();
export function guard(request: Request, key: string, limit = 40) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  if (
    origin &&
    (new URL(origin).host !== host ||
      request.headers.get("sec-fetch-site") === "cross-site")
  )
    throw new AppError("許可されていないアクセスです。", 403);
  const now = Date.now();
  if (rate.size > 2000)
    for (const [k, v] of rate) if (v.reset < now) rate.delete(k);
  const entry = rate.get(key);
  if (entry && entry.reset > now) {
    if (entry.count >= limit)
      throw new AppError("少し間をあけて、もう一度お試しください。", 429);
    entry.count++;
  } else rate.set(key, { count: 1, reset: now + 60000 });
}
export function requireAccess(request: Request) {
  if (
    process.env.GAME_ACCESS_CODE &&
    request.headers.get("x-game-code") !== process.env.GAME_ACCESS_CODE
  )
    throw new AppError("設定からプレイコードを入力してください。", 403);
}
export async function body(request: Request) {
  const text = await request.text();
  if (text.length > 60000) throw new AppError("入力が大きすぎます。", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("入力形式が正しくありません。");
  }
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof Error && error.name === "ZodError")
    return NextResponse.json(
      { error: "入力内容を確認してください。" },
      { status: 400 },
    );
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    { error: "処理できませんでした。時間をおいて、もう一度お試しください。" },
    { status: 500 },
  );
}
export function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
}
export async function saveCloud(state: GameState) {
  const db = database();
  if (!db) return false;
  const { error } = await db.rpc("save_live_session", {
    p_id: state.id,
    p_owner: state.owner,
    p_state: state,
    p_token: sign(state),
  });
  if (error)
    throw new AppError(
      "クラウドに保存できませんでした。端末のセーブは保持しています。SupabaseのSQL設定を確認してください。",
      502,
    );
  return true;
}
export async function loadCloud(device: string) {
  const db = database();
  if (!db) return null;
  const { data, error } = await db
    .from("game_sessions")
    .select("token")
    .eq("owner_hash", device)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError("クラウドの記憶を読み込めませんでした。", 502);
  return data?.token ? verify(data.token, device) : null;
}
