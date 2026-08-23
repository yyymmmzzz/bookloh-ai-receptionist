# SEA Market Technical Stack (Singapore / Malaysia / Indonesia)

**Author:** Mavis (mavis) · **Date:** 2026-08-23 · **Status:** Planning doc

This document covers the technical stack for expanding HandyLine AI from
Houston (US) into Southeast Asia (Singapore, Malaysia, Indonesia). It
identifies the STT and TTS models for each market, integration patterns with
Vapi, an implementation roadmap, and the operational considerations
(cost, compliance, infrastructure) that drive the decisions.

## TL;DR

| Market | STT pick | TTS pick | Time-to-launch | Cost ceiling |
|---|---|---|---|---|
| 🇸🇬 Singapore | **malaya-speech large-conformer-singlish** (WER 7%) | ElevenLabs clone of local speaker | **4-6 weeks** | ~$200 setup + $30/mo infra |
| 🇲🇾 Malaysia | **malaya-speech conformer-stack-2mixed** (WER 10%) | ElevenLabs clone of local speaker | **8-12 weeks** | ~$500 setup + $30/mo infra |
| 🇮🇩 Indonesia | **SeaLLMs-Audio** (Damour SG) | ElevenLabs clone of local speaker | **12-16 weeks** | ~$1K setup + $50/mo infra |

**Key insight:** STT (understanding customers) is the hard problem. TTS
(AI voice) is solved by 1-hour voice cloning. Three things unlock
production-grade STT: real local recordings for training, a self-hosted
ASR proxy (because Vapi doesn't allow custom STT), and explicit handling
of code-switching and noisy backgrounds.

## 1. STT Model Selection

### 1.1 Singapore

**Primary: `mesolitica/malaya-speech-conformer-singlish` (large, 404MB)**
- WER: **7.01%** (vs Whisper-large-v3 ~5-8% on standard English)
- License: MIT, HF Hub available
- Architecture: Conformer (~400M params)
- Strong on: Singlish, code-switching English + Mandarin + Malay
- Weak on: very elderly speakers, heavy background noise

**Fallback: AssemblyAI (commercial, $0.0043/min)**
- Zero engineering — change Vapi `transcriptionProvider: "assemblyai"`
- Strong multilingual, GDPR/PDPA compliant
- ~$4.30 per 1000 calls × 3 min

**Stretch: MERaLiON-2-10B (Singapore A*STAR)**
- Best-in-class multimodal: ASR + translation + emotion + QA
- 260K hours training, 62M instruction samples
- Open weights, HF Hub
- **Use case:** if we later need emotion detection or voice QA features
- Heavier to deploy (~10B params)

### 1.2 Malaysia

**Primary: `mesolitica/malaya-speech-conformer-stack-2mixed` (130MB)**
- WER: **10.36%** (covers Malay + Singlish + Mandarin 3-way code-switching)
- License: MIT
- Best for Manglish (Malaysian English with Malay code-switching)
- **Important:** WER 10% is borderline — must fine-tune with local data

**Stretch: Whisper-large-v3 + LoRA fine-tune**
- Use case: when we have 100+ hours of real MY customer calls
- Cost: $2-5K for fine-tuning on 1× A100 80GB

### 1.3 Indonesia

**Primary: SeaLLMs-Audio (Alibaba DAMO Singapore)**
- Covers: Indonesian + Thai + Vietnamese + English + Mandarin
- Best fit for ASEAN expansion beyond MY/SG

**Fallback: Whisper-large-v3 + Indonesian LoRA fine-tune**
- Less coverage of Bahasa Indonesia out of the box
- Path forward: collect 200+ hours of Indonesian phone calls

### 1.4 Cross-market unified approach

**AccentAdapt-Whisper (ICISN 2026 best paper)**
- Lightweight CNN accent detector
- Auto-routes to the right Whisper variant per call
- Zero external API cost, no fine-tuning needed
- **Useful when:** we have multiple SEA models deployed and want smart routing

## 2. TTS Model Selection

### 2.1 ElevenLabs (current stack)

| Voice type | Recording time | Cost | Quality |
|---|---|---|---|
| **Instant Clone** | 30s-1min | $5/mo (Creator) — $22/mo (Pro) | 85-90% parity |
| **Professional Clone** | 30min-3h | +$99 one-time | 95%+ parity |

**Recommendation:** Instant Clone for MVP (~$5-22/mo per voice). Record 2-3
different local speakers per market for variety. Upgrade to Professional
Clone once we land 10+ paying customers per market.

### 2.2 Cartesia Sonic (alternative)

- Latency: ~80ms (vs ElevenLabs ~200ms) — better for real-time
- $0.040/1K chars
- Recommended if we need sub-200ms latency

### 2.3 Singlish/Manglish vocabulary in prompt

Singlish verbal tics (lah, lor, meh, can, cannot, leh, sia, hor, paiseh)
should be used **sparingly** in AI responses — over-use sounds fake.
Best approach: 1-2 tics per conversation, not every sentence.

```
SYSTEM_PROMPT excerpt:
"You're friendly and use Singaporean English naturally. Drop 1-2 casual
tics per response (e.g. 'lah', 'lor', 'leh') but don't over-do it. Avoid
'can' in formal context; prefer 'able to' for clarity when summarizing
the job back to the customer."
```

## 3. Vapi Integration Architecture

### 3.1 Current (US / Houston)

```
Customer → Vapi (Deepgram STT) → gpt-4o (LLM) → ElevenLabs Yimo (TTS) → Customer
                         ↓
              Vapi webhook → /api/vapi/webhook
                              ↓
              Supabase work_orders + llm_usage
```

### 3.2 With custom STT (target SEA architecture)

```
Customer → Vapi (audio captured) → Vapi webhook
                                      ↓
                            /api/vapi/webhook
                                      ↓
                       POST audio_url → /api/asr/sg  (self-hosted)
                                      ↓
                  mesolitica/malaya-speech-conformer-singlish
                                      ↓
                          transcript text
                                      ↓
                          LLM extraction (openai-summarize)
                                      ↓
                          Supabase work_orders
```

**Why we need a proxy:** Vapi does NOT allow inserting custom STT.
We can:
- A) Use Vapi's built-in OpenAI Whisper transcriptionProvider (works for SEA
  but no specialized model), OR
- B) Build ASR proxy: receive audio via Vapi webhook, run malaya-speech,
  write transcript back to work_orders. This adds ~2-5s latency but
  gives us full control and the best models.

**Recommendation:** Start with Vapi's OpenAI Whisper (option A, zero
engineering), then upgrade to ASR proxy (option B) once we have 50+
SEA customers.

## 4. Self-hosted ASR Proxy

### 4.1 Architecture

```
┌────────────────────────────────────────────────────────┐
│  Vercel: webhook handler receives audio_url from Vapi │
│  → POST to ASR proxy with audio URL                     │
│  → Proxy downloads audio, runs malaya-speech, returns text │
│  → Vercel stores transcript in Supabase                   │
└────────────────────────────────────────────────────────┘
```

### 4.2 Deployment options (Vercel Hobby Plan = 50MB max, models are 130-400MB)

| Platform | Cost | Cold start | Verdict |
|---|---|---|---|
| **Modal** (modal.com) | $0.0001/sec GPU | ~5s | ✅ Best — pay-per-second, no idle cost |
| **Replicate** | $0.0002/sec | ~10s | ✅ Simple API |
| **Railway + Docker** | $5/mo+ | ~10s | ⚠️ Always-on cost |
| **Fly.io + GPU** | $10/mo+ | ~5s | ⚠️ Min 1GB VRAM for Singlish model |
| **Vercel Hobby** | free | N/A | ❌ 50MB limit, model too big |

**Recommendation:** Modal for MVP (~$5-10/mo for demo traffic, scales to
$50-100/mo at 10K calls). Replicate as backup.

### 4.3 Code sketch

```typescript
// /api/asr-sg/route.ts (deployed on Modal)
import { pipeline } from '@huggingface/transformers';
import { downloadAudio } from './utils';

let transcriber: any = null;
async function getTranscriber() {
  if (!transcriber) {
    transcriber = await pipeline(
      'automatic-speech-recognition',
      'mesolitica/malaya-speech-conformer-singlish',
      { quantized: true } // 4x smaller, 30% faster, 95% accuracy
    );
  }
  return transcriber;
}

export async function POST(req: Request) {
  const { audio_url, call_id } = await req.json();
  const audioBuffer = await downloadAudio(audio_url);
  const t = await getTranscriber();
  const result = await t(audioBuffer, {
    chunk_length_s: 30,
    return_timestamps: true,
  });
  return Response.json({
    call_id,
    transcript: result.text,
    segments: result.chunks,
    model: 'large-conformer-singlish',
    wer_estimate: 0.07,
  });
}
```

## 5. Implementation Roadmap

### Phase 1: Singapore (4-6 weeks)

| Week | Task | Owner | Deliverable |
|---|---|---|---|
| 1 | Record 3 local speakers (1-2 min each) | Bookloh SG team | 3 audio files (clean, no noise) |
| 1 | ElevenLabs clone → Vapi credentials | Mavis | 3 voice IDs in Vapi dashboard |
| 2 | Deploy malaya-speech on Modal | Mavis | `/api/asr-sg` endpoint + cold-start test |
| 2 | Add Singlish glossary to system-prompt.md | Mavis | `vapi/system-prompt-sg.md` |
| 3 | Find 3-5 Singaporean testers (Bookloh network) | Bookloh SG | 5 test transcripts |
| 4 | Iterate on WER + prompt based on real calls | Mavis | WER < 12% in production |
| 5 | Multi-assistant Vapi config (US + SG side-by-side) | Mavis | Country router in dashboard |
| 6 | PDPA opt-in recording notice + retention policy | Legal + Mavis | Compliant deployment |

**Total cost:** $200 (cloning) + $30/mo (Modal/hosting) = ~$500 to first 100
calls.

### Phase 2: Malaysia (8-12 weeks after SG launch)

| Week | Task | Owner |
|---|---|---|
| 1-2 | Collect 50+ hours of Bookloh MY customer calls (anonymized) | Bookloh MY |
| 3-4 | Fine-tune conformer-stack-2mixed on collected data | Mavis + ML contractor |
| 5-6 | Deploy fine-tuned model on Modal | Mavis |
| 7-8 | Multi-language prompt (Manglish + Malay code-switching) | Mavis |
| 9-10 | A/B test (fine-tuned vs off-shelf) | Mavis |
| 11-12 | PDPA MY compliance + launch | Legal + Mavis |

**Total cost:** $500 (data collection) + $3K (fine-tuning) + $50/mo (hosting) = ~$5K.

### Phase 3: Indonesia (12-16 weeks)

| Week | Task | Owner |
|---|---|---|
| 1-4 | Collect 200+ hours of Indonesian phone calls | Indonesian partner |
| 5-8 | Fine-tune SeaLLMs-Audio | Mavis + ML contractor |
| 9-12 | Bahasa Indonesia prompt + cultural adaptations | Local consultant |
| 13-16 | Launch | Mavis |

**Total cost:** ~$10-15K.

## 6. Cost per 1000 calls (3 min avg)

| Component | Off-shelf STT | Self-hosted STT |
|---|---|---|
| STT (Vapi Deepgram) | $0.77 | $0 (Vapi default) |
| STT (AssemblyAI) | $4.30 | n/a |
| STT (OpenAI Whisper) | $6.00 | n/a |
| STT (malaya-speech self-hosted) | n/a | $0.30 (Modal serverless) |
| LLM (gpt-4o-mini) | $0.15 | $0.15 |
| LLM extraction (gpt-4o-mini) | $0.001 | $0.001 |
| TTS (ElevenLabs Yimo clone) | $5-22 | $5-22 |
| Twilio SMS | $0.50 | $0.50 |
| **Total per 1000 calls** | **$7-28** | **$6-23** |

Self-hosted saves ~$0.50/1000 calls on STT but adds infrastructure risk.
For <500 calls/day, off-shelf is more cost-effective. Self-host at >5000
calls/day.

## 7. Compliance (PDPA + GDPR-style)

| Requirement | Implementation |
|---|---|
| **Recording consent** | Vapi firstMessage + voice disclosure: "This call may be recorded for quality and service purposes" |
| **Opt-out** | Customer says "don't record" → flag in work_order, do not save audio |
| **Retention** | Auto-delete recordings after 90 days (Supabase Storage lifecycle rule) |
| **Access rights** | Customer email/phone is the access key — re-call with ID verification to delete data |
| **Data residency** | Self-host ASR in region (Singapore for SG, Malaysia for MY) for PDPA Article 26 (cross-border transfer) |

## 8. Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| malaya-speech maintainer stops updating | Medium | Medium | Pin commit, fork to private repo, replace with Whisper fine-tune |
| Whisper WER > 15% on Manglish | High (initially) | High | Must fine-tune with local data, not off-shelf |
| Vapi pricing increases 2x | Low | Medium | Self-hosted ASR cuts STT cost 50%+ |
| PDPA non-compliance fine | Low | High | Built-in opt-in + retention + access flow |
| Code-switching kills STT (English + Malay mixed) | High | Medium | Use mixed-model (conformer-stack-2mixed), not pure English model |
| Cold start latency on Modal | Medium | Medium | Pre-warm function with cron ping every 5min, or use Replicate (faster cold start) |

## 9. Quick Decision Matrix (for next 2 weeks)

**If we want to demo SG support to investors in 4 weeks:**
1. **Week 1:** Record 3 local speakers (Bookloh SG), ElevenLabs clone, deploy to Vapi as new assistant
2. **Week 2:** Switch Vapi transcriptionProvider to OpenAI Whisper (works for SG without proxy)
3. **Week 3:** Add Singlish glossary to system prompt, A/B test with 5 real callers
4. **Week 4:** Dashboard country router, demo to investors

**If we want production-grade STT (WER < 8% on Manglish):**
- Add Phase 1-3 of SG roadmap
- Plan $5-10K investment for SEA STT

**If we just want to say "SEA-ready" in BP/PPT:**
- Add a single line to pitch deck: "Architecture supports SEA via pluggable STT proxy + voice cloning (3-4 month time-to-market per country)"
- No code changes needed
