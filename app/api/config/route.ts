import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(
    {
      ai: !!process.env.OPENAI_API_KEY,
      cloud: !!(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
      accessCode: !!process.env.GAME_ACCESS_CODE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
