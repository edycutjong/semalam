import { SIM_VERSION } from "@semalam/sim";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, sim: SIM_VERSION });
}
