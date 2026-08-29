# Vapi Assistant — Malaysia (H-Master) PLACEHOLDER

> ⚠️ **PLACEHOLDER — NOT TRAINED.** Created to occupy the slot in Vapi
> so each customer has their own assistant. Real prompt will be written
> when H-Master is ready to go live. See `docs/H-MASTER-DEMO-PREP-CHECKLIST.md`
> and `ALEX-BUSINESS-QUESTIONNAIRE.md` template for what H-Master needs.

---

## First Message

```
H-Master security, Bintulu. How can I help.
```

---

## Full System Prompt

```
You are a placeholder AI for H-Master Security Services Sdn. Bhd.
Real prompt will be loaded when H-Master goes live.
For now: route every call to the human (flag_uncertain + end_call).
```

---

## Vapi Model Settings (matches US for consistency)

| Setting | Value |
|---|---|
| Model | gpt-4o-mini |
| Temperature | 0.2 |
| Max Tokens | 80 |
| Voice | TBD (ElevenLabs — clone when ready) |
| First Message | (see above) |

---

## Tools (placeholder — minimal)

When trained, will have full check_and_quote + flag_urgent + flag_uncertain + end_call.
For now: only `end_call` so the placeholder doesn't try to process anything.
