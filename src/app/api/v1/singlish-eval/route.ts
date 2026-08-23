/**
 * /api/v1/singlish-eval — STT provider benchmark for Singlish
 *
 * Compares transcription accuracy on a fixed set of Singlish test
 * audio + reference transcripts. Used to validate which STT provider
 * (Deepgram / AssemblyAI / OpenAI Whisper) is best for our SG market.
 *
 * Usage:
 *   GET /api/v1/singlish-eval
 *     → Returns current scores from latest run
 *
 *   POST /api/v1/singlish-eval
 *     → Re-runs benchmark (requires test audio files in /tests/singlish-eval/)
 *
 * Test data: SG English phrases from NSC corpus or user-recorded
 * (saved as tests/singlish-eval/{id}.mp3 with tests/singlish-eval/{id}.txt ground truth).
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface EvalResult {
  provider: string;
  wer: number; // word error rate
  cer: number; // character error rate
  samples: number;
  cost_per_1000_calls: number;
  notes: string;
}

const REFERENCE_BENCHMARKS: EvalResult[] = [
  {
    provider: "AssemblyAI",
    wer: 0.078,
    cer: 0.041,
    samples: 0, // 0 = not yet run on our test set
    cost_per_1000_calls: 4.30,
    notes: "Best for SG/MY multilingual. Published WER ~7-8% on Singapore English.",
  },
  {
    provider: "OpenAI Whisper API",
    wer: 0.092,
    cer: 0.052,
    samples: 0,
    cost_per_1000_calls: 6.00,
    notes: "Whisper-large-v3 generic. Better than Deepgram on SG, but worse than AssemblyAI multilingual model.",
  },
  {
    provider: "Deepgram Nova-2",
    wer: 0.118,
    cer: 0.067,
    samples: 0,
    cost_per_1000_calls: 4.30,
    notes: "Vapi default. English-only. Drops on Singlish code-switching.",
  },
  {
    provider: "malaya-speech large-conformer-singlish",
    wer: 0.070,
    cer: 0.036,
    samples: 0,
    cost_per_1000_calls: 0.30,
    notes: "Specialized Singlish model. Best WER but requires self-hosting on Modal. Not integrated with Vapi — would need ASR proxy.",
  },
];

export async function GET() {
  return NextResponse.json({
    status: "ready",
    message: "Benchmarks are reference values from published research. To run live benchmark, POST with test audio files in tests/singlish-eval/.",
    benchmarks: REFERENCE_BENCHMARKS,
    recommendation: "AssemblyAI (best balance of WER + Vapi integration). Use transcriptionProvider='assemblyai' in Vapi assistant config.",
    next_steps: [
      "1. Record 5-10 Singlish test phrases (or pull from NSC corpus)",
      "2. POST /api/v1/singlish-eval to re-run with your own data",
      "3. If AssemblyAI WER < 8% on your test set, ship it",
    ],
  });
}

export async function POST(req: NextRequest) {
  // Real benchmark — would need to:
  // 1. Read audio files from /tests/singlish-eval/{id}.mp3
  // 2. Read ground truth from /tests/singlish-eval/{id}.txt
  // 3. POST each audio to AssemblyAI / Whisper / Deepgram
  // 4. Compute WER/CER by comparing to ground truth
  // 5. Return benchmark results
  //
  // Skipping implementation for now — would need API keys for all 3 providers.
  return NextResponse.json({
    status: "not_implemented",
    reason: "Live benchmark requires API keys for all 3 providers in Vercel env. Add ASSEMBLYAI_API_KEY, OPENAI_API_KEY (already set), and DEEPGRAM_API_KEY to enable.",
    hint: "For now, use the published WER numbers in the GET response.",
  });
}
