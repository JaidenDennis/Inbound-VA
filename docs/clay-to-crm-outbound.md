# Clay → CRM: automatic outbound lead ingest

Clay pushes each enriched row to the backend, the backend writes it to the CRM.
No CSV export, no manual upload.

```
Clay row enriched → HTTP API column → POST /webhooks/clay/lead
                                    → contacts row (system of record)
                                    → crm-sync queue → CRM adapter → GoHighLevel
```

The endpoint does not talk to GoHighLevel directly. It queues the write on the
same crm-sync pipeline the voice agent uses, so a Clay lead inherits retries,
dead-lettering, `crm_sync_logs`, and the `MANUAL_REVIEW` parking that everything
else gets. It is also CRM-agnostic: whichever adapter the client's active
connection names is the one that runs.

---

## 1. Backend setup

| Variable | Required | Purpose |
| --- | --- | --- |
| `CLAY_INGEST_SECRET` | yes | Shared secret Clay presents. 16+ chars. **Unset disables the endpoint (503)** — it never falls open. |
| `CLAY_DEFAULT_CLIENT_ID` | yes¹ | Client whose active CRM connection receives the leads. Gravvia's own sub-account for outbound. |
| `CLAY_RATE_LIMIT_MAX` | no | Requests per `RATE_LIMIT_WINDOW_MS` for this endpoint. Default 600 — Clay fires one request per row, so a table run bursts well past the global cap. |

¹ Optional if every Clay payload carries an explicit `clientId`.

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The target client needs an **active CRM connection** already installed
(`GET /crm/gohighlevel/oauth/install` → `POST /crm/ghl/provision`). Without one
the endpoint answers `404`; with a connection flagged `needs_reauth` it answers
`409` rather than queueing writes that would fail.

---

## 2. Clay setup

In the table holding the leads, add an **HTTP API** column:

- **Method** `POST`
- **URL** `https://<your-api>/webhooks/clay/lead`
- **Headers**
  - `Authorization: Bearer <CLAY_INGEST_SECRET>`
  - `Content-Type: application/json`
- **Body** — map columns to the fields below
- **Run condition** — set one (e.g. email is not empty) so half-enriched rows
  don't fire

A `202` means the lead was accepted and queued. `4xx` bodies carry a readable
reason, which Clay shows in the cell.

### Body fields

Every field is optional except that **a lead must have `email` or `phone`**.
Empty strings are treated as absent, so blank Clay cells are safe to map.

| Field | Notes |
| --- | --- |
| `recordId` | Clay's row id. **Map this** — it is the idempotency anchor, so re-running the column doesn't create a second opportunity. |
| `firstName`, `lastName` | Or send `fullName` and it is split on the first space. |
| `email`, `phone` | At least one required. Phone is normalized to E.164 (`(904) 760-5971` → `+19047605971`). |
| `company` | Stored on the contact, sent to the CRM as the company name, and used as the opportunity title. |
| `jobTitle`, `linkedinUrl`, `website` | Go into the CRM note (no dedicated fields). |
| `industry`, `callVolume`, `interest` | CRM custom fields — see mapping below. |
| `value` | Opportunity monetary value. |
| `opportunityName` | Overrides the generated title. |
| `source` | Defaults to `clay-outbound`. |
| `tags` | Added to `clay` + `outbound-lead`. |
| `notes` | Clay's research — lands as a note on the CRM contact. |
| `customFields` | Object of extra CRM custom fields. |
| `clientId` | Overrides `CLAY_DEFAULT_CLIENT_ID` (for pushing into a client sub-account instead). |

Example body:

```json
{
  "recordId": "{{Row ID}}",
  "fullName": "{{Full Name}}",
  "email": "{{Work Email}}",
  "phone": "{{Phone}}",
  "company": "{{Company}}",
  "jobTitle": "{{Title}}",
  "industry": "{{Industry}}",
  "callVolume": "{{Monthly Calls}}",
  "interest": "{{Interest Level}}",
  "linkedinUrl": "{{LinkedIn}}",
  "notes": "{{Claygent Research}}"
}
```

---

## 3. What lands in the CRM

Per lead:

1. **Contact** — upserted, tagged `clay` + `outbound-lead`, carrying company and
   the enrichment custom fields.
2. **Opportunity** — in the connection's pipeline/stage, titled
   `<Company> — <label>`.
3. **Note** — company, title, LinkedIn, website, and Clay's research.

### Per-connection configuration (`crm_connections.crm_config`)

Nothing about a specific client lives in source. Set these on the connection to
steer where outbound lands:

| Key | Effect |
| --- | --- |
| `outboundPipelineId` | Pipeline for Clay opportunities. Falls back to `crm_connections.pipeline_id`. |
| `outboundStageId` | Starting stage (e.g. the "New Lead" stage id). Falls back to `crm_config.stageId`. |
| `outboundOpportunityLabel` | Suffix in the generated title. Default `Outbound Lead`; set to `AI Voice Agent` to match the Gravvia Sales blueprint. |
| `clayFieldNames` | Renames the internal custom-field keys, e.g. `{"industry": "Vertical"}`. Defaults: `Company Industry`, `Current Call Volume`, `Interest Level` (the Gravvia Sales blueprint names). |

### How custom fields resolve

GHL identifies a custom field by its **id** (`3sv6UEo5PoErAAyF9Yxi`) or its
**dotted field key** (`contact.company_industry`), and silently ignores an entry
it cannot resolve — a dropped field produces no error anywhere.

`crm_connections.custom_field_mapping` holds the translation from internal field
names to GHL ids. GHL provisioning writes it as part of the `customFields` step,
so any connection provisioned with `POST /crm/ghl/provision` is correct by
construction. The adapter matches names case-insensitively and picks the right
wire shape automatically (dot ⇒ `key`, no dot ⇒ `id`).

**Connections provisioned before this existed** — or whose fields were created
by hand in the GHL UI — need a one-time backfill:

```bash
cd backend
npm run map:ghl-fields -- --dry-run    # show what would be written
npm run map:ghl-fields                 # every active GHL connection
npm run map:ghl-fields -- --client-id=<uuid>
```

Verify with `GET /clients/:id` or in the DB: `custom_field_mapping` should list
each GHL field name against its id. Tags, company, name, email, phone, the
opportunity and the note never depended on this and always land.

---

## 4. Idempotency and failure

- Re-running the Clay column on the same row reuses the same job id (anchored on
  `recordId`), so no duplicate opportunity.
- A CRM error retries on the queue; exhausted retries land in `failed_jobs` with
  `status = manual_review` and an alert email if `ALERT_EMAIL` is set.
- Per-lead outcomes: `GET /crm/:clientId/logs`.

Smoke test once deployed:

```bash
curl -sS -X POST "$API_BASE_URL/webhooks/clay/lead" \
  -H "Authorization: Bearer $CLAY_INGEST_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"recordId":"smoke-1","fullName":"Test Lead","email":"test@example.com","company":"Example Co","industry":"Dental"}'
```

Expect `202` with `{ "queued": true, ... }`, then the contact and opportunity in
the CRM within a few seconds.
