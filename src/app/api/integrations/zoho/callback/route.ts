import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ code, message: "Exchange this code for a refresh token." });
}
