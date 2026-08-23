/**
 * /api/v1/assistants — country → Vapi assistant_id router
 *
 * Given a phone number, return the right Vapi assistant_id.
 * Used by the dashboard's "Country" picker AND by Vapi's phone number
 * routing when we eventually set up multiple inbound numbers.
 *
 * Currently supported:
 *   +1  → US assistant (VAPI_ASSISTANT_ID)
 *   +65 → SG assistant (VAPI_SG_ASSISTANT_ID)
 *   +60 → MY assistant (VAPI_MY_ASSISTANT_ID)  — future
 *
 * For demo simplicity this is a Vercel API route returning JSON.
 * In production, Vapi can call this endpoint to dynamically pick
 * the assistant per call.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CountryAssistant {
  country: string;
  prefix: string;
  assistantId: string | undefined;
  transcriptionProvider: string;
  voice: string;
  status: "ready" | "pending" | "missing";
}

export async function GET(req: NextRequest) {
  // List all known country → assistant mappings
  const mappings: CountryAssistant[] = [
    {
      country: "US",
      prefix: "+1",
      assistantId: process.env.VAPI_ASSISTANT_ID,
      transcriptionProvider: "deepgram",
      voice: "11labs (Yimo clone, US English)",
      status: process.env.VAPI_ASSISTANT_ID ? "ready" : "missing",
    },
    {
      country: "SG",
      prefix: "+65",
      assistantId: process.env.VAPI_SG_ASSISTANT_ID,
      transcriptionProvider: "assemblyai",
      voice: "11labs (SG English clone — pending)",
      status: process.env.VAPI_SG_ASSISTANT_ID ? "ready" : "pending",
    },
    {
      country: "MY",
      prefix: "+60",
      assistantId: process.env.VAPI_MY_ASSISTANT_ID,
      transcriptionProvider: "assemblyai",
      voice: "11labs (Malay-English clone — pending)",
      status: process.env.VAPI_MY_ASSISTANT_ID ? "ready" : "pending",
    },
  ];

  // Optional: look up by phone number query param
  const phone = req.nextUrl.searchParams.get("phone");
  if (phone) {
    const match = mappings.find((m) => phone.startsWith(m.prefix));
    if (match) {
      return NextResponse.json({
        phone,
        ...match,
        hint: match.status === "ready"
          ? `Use assistant_id ${match.assistantId} for this call`
          : `Country matched but ${match.country} assistant is not yet created. Run scripts/update-vapi-assistant-${match.country.toLowerCase()}.js to create.`,
      });
    } else {
      return NextResponse.json({
        phone,
        country: "unknown",
        hint: "No country prefix matched. Falling back to US assistant.",
      });
    }
  }

  return NextResponse.json({ mappings });
}
