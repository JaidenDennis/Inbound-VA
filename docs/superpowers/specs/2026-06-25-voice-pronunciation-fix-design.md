# Voice Pronunciation Fix — Design Spec
**Date:** 2026-06-25
**Status:** Approved

---

## Problem

The Retell AI voice agent (GPT-4.1 LLM + Retell TTS) stumbles on names and phone numbers during live calls — it groups digits instead of reading them individually, mispronounces unusual names, and sometimes repeats itself mid-readback.

Root causes:
1. The LLM generates its own formatting for phone numbers and names. Even with prompt instructions, it doesn't reliably pace them correctly.
2. Function response `message` strings embed raw phone numbers and names (e.g. `"9045551234"`, `"Nguyen"`). The LLM echoes these as-is, and TTS then groups or stumbles on them.
3. No prompt rule exists for names — only phones have a readback rule today.

---

## Solution: Option B — Speech Formatter Utility + Prompt Enhancements

Two-layer fix:
- **Layer 1 (formatter):** Pre-format phone numbers and names in function response messages before the LLM sees them. The LLM mirrors what it receives, so pre-spaced text produces digit-by-digit / letter-by-letter speech.
- **Layer 2 (prompt):** Add an explicit name readback rule alongside the existing phone rule. The prompt is the LLM's behavioral guide; the formatter is the enforcement mechanism.

---

## Architecture

### New File: `backend/src/utils/speech.ts`

Two pure functions, no external dependencies:

```ts
/**
 * Format a phone number digit by digit for TTS readback.
 * Strips all non-digits, then joins with " - ".
 * "9045551234" → "9 - 0 - 4 - 5 - 5 - 5 - 1 - 2 - 3 - 4"
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.split('').join(' - ');
}

/**
 * Spell a name letter by letter for TTS confirmation readback.
 * "Sarah" → "S - A - R - A - H"
 * Used in confirmation contexts, not casual greeting contexts.
 */
export function spellName(raw: string): string {
  return raw.trim().toUpperCase().split('').join(' - ');
}
```

Both are exported through `backend/src/utils/index.ts`.

---

### Modified File: `backend/src/routes/functions/retell-functions.route.ts`

**Key insight:** The current `message` strings don't embed phone numbers or names at all — they're bare LLM instructions like `"Lead captured for Maria. Offer to book..."`. The LLM therefore has no pre-formatted text to mirror and falls back to generating its own digit groupings.

The fix is to **add** the pre-formatted value to the message alongside an explicit instruction to confirm it. Import `formatPhone` and `spellName` from utils, then update each route:

**`qualify_lead`** — embed formatted phone and name, instruct the LLM to confirm both:
```
`Lead captured for ${name} (spelling: ${spellName(name)}). Phone on file: ${formatPhone(phone)}. Read the phone number back digit by digit to confirm, then confirm the name spelling before offering to book.`
```

**`book_appointment` / `book_consultation`** — embed formatted phone in confirmation message:
```
`Booked ${svcName} for ${contactName} at ${startTime}. Phone: ${formatPhone(phone)}. Confirm the name, date, time, and read the phone number back digit by digit before closing.`
```

**`schedule_callback`** — embed formatted phone in the confirmation:
```
`Callback scheduled for ${callerName}. Phone: ${formatPhone(phone)}${preferredTime}. Read the phone back digit by digit to confirm, then reassure them a team member will follow up.`
```

**`leave_staff_message`** — embed formatted phone:
```
`Message saved for ${callerName}. Phone: ${formatPhone(phone)}. Confirm their number back digit by digit, then reassure them someone will follow up.`
```

**`request_human_handoff`** — embed phone if present:
```
`A team member has been alerted. ${phone ? `Callback number on file: ${formatPhone(phone)}. Read it back digit by digit to confirm.` : 'Offer to take a callback number if no one is available.'}`
```

**`lookup_existing_client`** — no phone in the message (it's a lookup, not a capture), but include name spelling hint:
```
`Returning client ${firstName} ${lastName} found. Greet them warmly and use their name naturally — no need to spell it out here.`
```
(spellName is not used here; spelling is only for new name confirmation, not returning client greetings.)

---

### Modified File: `backend/src/providers/retell/templates/med-spa.template.ts`

**Existing phone rule** — tighten the wording to make it unambiguous:

```
★ CONFIRMING A PHONE NUMBER — read it back DIGIT BY DIGIT, every time ★
Say each digit ONE AT A TIME with a clear pause between digits.
NEVER group digits. NEVER say them as a number.
Example: for 9045551234, say "9 - 0 - 4 - 5 - 5 - 5 - 1 - 2 - 3 - 4".
After reading it back, ask "Did I get that right?" and wait for confirmation before moving on.
```

**New name rule** — added immediately after the phone rule:

```
★ CONFIRMING A NAME — spell it back LETTER BY LETTER, every time ★
When you hear the caller's name, ask them to spell it: "Could you spell that for me?"
Then repeat each letter ONE AT A TIME with a brief pause:
Example: for "Sarah", say "S - A - R - A - H" — then ask "Did I spell that correctly?" and wait.
NEVER assume you pronounced an unusual name correctly without spelling it back first.
```

---

## Data Flow

```
Caller says name/number
       ↓
LLM captures it, calls a function
       ↓
Backend function handler runs
       ↓
formatPhone() / spellName() applied to message string
       ↓
Pre-spaced message returned to LLM
       ↓
LLM mirrors the spacing in its spoken response
       ↓
Retell TTS reads digit-by-digit / letter-by-letter
```

---

## What Is Not Changing

- No new routes or endpoints
- No schema or database changes
- No Retell agent or LLM configuration changes (voice_id, model, etc.)
- SMS, CRM adapters, booking service — untouched
- No SSML — avoids voice-compatibility risk

---

## Testing

- Unit tests for `formatPhone` and `spellName` in `backend/src/__tests__/` covering: standard 10-digit numbers, numbers with formatting already applied, short/partial numbers, names with spaces, single-letter names, empty string edge cases
- Manual Retell test call to verify digit-by-digit readback and letter-by-letter name spelling
- Confirm no raw phone strings appear in function response messages after the change

---

## Files Touched

1. `backend/src/utils/speech.ts` — new file
2. `backend/src/utils/index.ts` — add export
3. `backend/src/routes/functions/retell-functions.route.ts` — apply formatters to messages
4. `backend/src/providers/retell/templates/med-spa.template.ts` — prompt updates
