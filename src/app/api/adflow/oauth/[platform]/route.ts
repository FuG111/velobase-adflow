import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/env";
import { isModuleEnabled } from "@/config/modules";
import { platformSchema } from "@/modules/ad-accounts/server/schema";
import { finishAuthorization } from "@/modules/ad-accounts/server/service";
import { z } from "zod";
export async function GET(
  req: Request,
  context: { params: Promise<{ platform: string }> },
) {
  if (!isModuleEnabled("adflow")) return new Response(null, { status: 404 });
  const session = await auth();
  if (!session?.user.id) return new Response(null, { status: 401 });
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isBlocked: true },
  });
  if (!user || user.isBlocked) return new Response(null, { status: 403 });
  const destination = new URL("/adflow", env.APP_URL);
  try {
    const platform = platformSchema.parse(
      (await context.params).platform.toUpperCase(),
    );
    const input = z
      .object({
        state: z.string().regex(/^[a-f0-9]{64}$/),
        code: z.string().min(1).max(4096),
      })
      .parse(Object.fromEntries(new URL(req.url).searchParams));
    await finishAuthorization(
      session.user.id,
      platform,
      input.state,
      input.code,
    );
    destination.searchParams.set("authorization", "success");
  } catch {
    destination.searchParams.set("authorization", "failed");
  }
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
