# GoHighLevel Dashboard Setup (Manual)

GHL has no public API for dashboards, so this is configured once by hand in
the GHL UI. Later, the configured sub-account gets snapshotted for client
rollout (separate project). Budget ~15 minutes.

## Prerequisites

- The sub-account (Location) is connected via the marketplace app and the
  `gravvia-sales` blueprint has been applied (`npm run smoke:ghl` or
  `POST /crm/ghl/provision`), so the **Gravvia Sales** pipeline, custom
  fields, tags, and ~20 demo leads with opportunities exist. The demo data is
  what makes the widgets render non-empty.
- You are logged into the **sub-account** (not the agency view) with a role
  that can manage dashboards (Admin).

## Create the dashboard

1. In the sub-account's left sidebar, open **Dashboard**.
2. Click the pencil/**Edit** icon (top right) → **+ Add Dashboard** (or the
   dashboard-switcher dropdown → **+ New Dashboard**).
3. Name it **Gravvia Sales Overview**, keep it private for now, **Save**.
4. Use **+ Add Widget** for each widget below. After adding all five, drag to
   arrange (suggested: the two numeric tiles top-left/top-right, bar chart
   center, time series + donut on the bottom row) and click **Save**.

## Widgets

### 1. Opportunities by stage (bar)

- **+ Add Widget** → category **Opportunities** → chart type **Bar chart**.
- Title: `Opportunities by Stage`.
- Measure: **Opportunity count**.
- Group by (dimension): **Stage**.
- Filter: **Pipeline is Gravvia Sales** (widget-level filter → field
  "Pipeline").
- Date range: **All time** (demo opportunities have varied created dates).

### 2. Pipeline value (numeric)

- **+ Add Widget** → **Opportunities** → **Numeric / single value**.
- Title: `Open Pipeline Value`.
- Measure: **Sum of monetary value** (Opportunity value).
- Filters: **Pipeline is Gravvia Sales** AND **Status is Open** (excludes
  won/lost so the number is the live pipeline).

### 3. Leads this week (time series)

- **+ Add Widget** → **Contacts** → **Line chart** (time series).
- Title: `New Leads This Week`.
- Measure: **Contact count**.
- X-axis / group by: **Date added**, granularity **Day**.
- Date range: **This week** (or Last 7 days).
- Optional filter: tag **inbound-lead** to count only lead-tagged contacts.

### 4. Conversion rate (donut)

- **+ Add Widget** → **Opportunities** → **Donut / pie chart**.
- Title: `Won vs Lost`.
- Measure: **Opportunity count**.
- Group by: **Status**, filtered to **Status is Won or Lost** and
  **Pipeline is Gravvia Sales**. The donut's won-share is the conversion
  rate of closed deals.

### 5. Appointments booked (numeric)

- **+ Add Widget** → **Appointments / Calendar** → **Numeric**.
- Title: `Appointments Booked`.
- Measure: **Appointment count**, filter **Status is Confirmed/Booked**.
- Date range: **This month**.
- Note: this stays 0 until real bookings flow through the voice agent —
  the demo blueprint does not create calendar events.

## Notes

- **Data refresh**: GHL dashboard widgets refresh on page load; there is no
  push. Small lags (~1 min) after provisioning are normal.
- **Permissions**: dashboards are per sub-account. Use **Share** on the
  dashboard to make it visible to other sub-account users (or set it as the
  default dashboard for the location).
- **Widget naming drift**: GHL renames menu items frequently; if a category
  above doesn't match exactly, look for the equivalent under the widget
  gallery's Opportunities / Contacts / Appointments groupings.
- **Client rollout**: once this sub-account looks right, it becomes the
  snapshot source for client sub-accounts (Snapshots project, separate spec —
  out of scope here).
