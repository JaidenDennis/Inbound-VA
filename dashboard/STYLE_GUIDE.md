# Gravvia Engage - UI Style Guide

## Professional Design System

Professional B2B SaaS dashboard design system following Enterprise Gateway + Data-Dense Dashboard patterns.

---

## Color Palette

### Primary Colors
- **Navy Blue (#1E40AF)** - Primary brand color, used for main CTA and navigation
- **Sky Blue (#0284C7)** - Secondary actions and hover states
- **Amber (#F59E0B)** - Accent color for highlights, alerts, and important CTAs

### Semantic Colors
- **Success (#10B981)** - Positive actions, confirmations, completed states
- **Warning (#F59E0B)** - Cautions, warnings, pending states
- **Error (#EF4444)** - Destructive actions, errors, failed states
- **Info (#3B82F6)** - Information, neutral actions

### Neutrals (Grayscale)
- **Gray-900 (#0F172A)** - Primary text, headlines
- **Gray-700 (#334155)** - Secondary text, labels
- **Gray-600 (#475569)** - Tertiary text, muted text
- **Gray-50 (#F8FAFC)** - Light backgrounds, subtle containers
- **White (#FFFFFF)** - Card backgrounds, primary surfaces

---

## Typography

### Font Families
- **Headings**: Fira Code (monospace, technical, professional)
- **Body**: Fira Sans (sans-serif, readable, modern)
- **Code/Data**: Fira Code (monospace)

### Font Sizes & Usage
| Size | Usage | Weight |
|------|-------|--------|
| 36px | H1 (Page Title) | Bold (700) |
| 30px | H2 (Section Title) | Semibold (600) |
| 24px | H3 (Card Title) | Semibold (600) |
| 20px | H4 (Subheading) | Medium (500) |
| 16px | Body Text, Labels | Normal (400) |
| 14px | Secondary Text, Help | Normal (400) |
| 12px | Caption, Meta | Normal (400) |

### Line Heights
- Headings: 1.2 (tight)
- Body: 1.5 (normal)
- Relaxed content: 1.75

---

## Spacing System

| Spacing | Value | Usage |
|---------|-------|-------|
| xs | 4px | Inner button padding, minimal gaps |
| sm | 8px | Small component gaps |
| md | 16px | Standard padding, gaps between sections |
| lg | 24px | Large section gaps |
| xl | 32px | Page-level spacing |

### Examples
- Button padding: `px-4 py-3` (16px)
- Card padding: `p-6` (24px)
- Page padding: `p-8` (32px)
- Gap between cards: `gap-6` (24px)

---

## Component Examples

### KPI Cards
```tsx
<KPICard
  label="Total Calls (30d)"
  value="1,234"
  icon={Phone}
  color="primary"
  trend={12}
  trendLabel="vs last month"
/>
```

**Styling**: 
- Background: White with gray border
- Icon: Colored background (primary, secondary, accent, success)
- Value: Large bold text (3xl)
- Trend: Pill badge with up/down indicator
- Hover: Subtle shadow lift

### Data Tables
```tsx
<DataTable
  columns={[
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status', render: (v) => <Badge>{v}</Badge> },
    { key: 'date', label: 'Date' },
  ]}
  data={data}
  onRowClick={handleRowClick}
/>
```

**Styling**:
- Header: Light gray background (gray-50)
- Rows: Hover state with subtle background shift
- Borders: Subtle gray-200 dividers
- Text: Consistent font sizing and colors
- Responsive: Horizontal scroll on mobile

### Page Headers
```tsx
<PageHeader
  title="Calls"
  description="Manage and view all inbound calls"
  breadcrumbs={[
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Calls' },
  ]}
  action={<Button>+ New Call</Button>}
/>
```

**Styling**:
- Title: Large bold heading (36px)
- Description: Muted gray text
- Breadcrumbs: Small text with dividers
- Action: Right-aligned button group

### Badges
```tsx
<Badge label="Active" variant="success" size="md" />
<Badge label="Pending" variant="warning" size="md" />
<Badge label="Error" variant="error" size="md" />
```

**Variants**: primary, secondary, success, warning, error, gray
**Sizes**: sm (small), md (medium)

---

## Interaction Patterns

### Hover States
- **Cards**: Add subtle shadow lift + border color change
- **Buttons**: Slightly darker background + shadow
- **Rows**: Light background highlight (gray-50)
- **Links**: Underline + color shift

### Focus States
- **All interactive elements**: Visible focus ring (primary-600 border)
- **Keyboard navigation**: Clear tab order matching visual hierarchy

### Transitions
- **Micro-interactions**: 150-200ms duration
- **Page transitions**: 200-300ms duration
- **Loading states**: Smooth fade-in of content

---

## Icons

**Usage**: Lucide icons (24x24px default)
- **Navigation**: LayoutDashboard, Building2, Phone, Calendar, etc.
- **Actions**: Plus, Edit, Delete, Share, Download
- **Status**: CheckCircle, AlertCircle, XCircle, Clock
- **UI**: ChevronDown, ChevronUp, Menu, X, Search

**Guidelines**:
- Use consistent icon set across all pages
- Size icons appropriately (w-4 h-4 for inline, w-6 h-6 for cards)
- Match icon color to text color in most cases
- Use colored backgrounds for emphasis (see KPI Cards)

---

## Responsive Design

### Breakpoints
| Breakpoint | Width | Device |
|-----------|-------|--------|
| Mobile | 375px | Small phone |
| Tablet | 768px | iPad |
| Desktop | 1024px | Laptop |
| Wide | 1280px | Large screen |

### Grid Adjustments
```tsx
// KPI Cards: 1 column (mobile) → 2 columns (tablet) → 3+ columns (desktop)
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

// Data Tables: Horizontal scroll on mobile, full width on desktop
<div className="overflow-x-auto">
  <table className="w-full">
```

---

## Common Patterns

### Empty States
```tsx
<div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
  <Icon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
  <p className="text-gray-500 text-lg">No data available</p>
  <p className="text-gray-400 text-sm mt-1">Try adjusting filters or check back soon</p>
</div>
```

### Loading States
```tsx
// Skeleton loader for data tables
<tr className="border-b border-gray-100">
  {columns.map((col) => (
    <td className="px-6 py-4">
      <div className="h-4 bg-gray-200 rounded animate-pulse" />
    </td>
  ))}
</tr>
```

### Form Inputs
```tsx
<input
  type="text"
  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent"
/>
```

---

## Accessibility Checklist

- [ ] Color contrast ratio minimum 4.5:1 for text
- [ ] Focus states visible on all interactive elements
- [ ] Icon buttons have aria-label
- [ ] Form inputs have associated labels
- [ ] Semantic HTML (buttons, links, inputs)
- [ ] Keyboard navigation works (Tab order)
- [ ] Respects prefers-reduced-motion
- [ ] Alternative text for meaningful images

---

## Implementation Notes

### Using Tailwind Classes
```tsx
// Primary button
<button className="bg-primary-600 text-white px-4 py-3 rounded-lg hover:bg-primary-700 transition-colors duration-200">
  Click Me
</button>

// Secondary variant
<button className="bg-gray-100 text-gray-900 px-4 py-3 rounded-lg hover:bg-gray-200 transition-colors duration-200">
  Cancel
</button>

// Danger variant
<button className="bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-lg hover:bg-red-100 transition-colors duration-200">
  Delete
</button>
```

### Common Component Patterns
```tsx
// Container with max-width
<div className="max-w-7xl mx-auto px-8">

// Card container
<div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-lg transition-shadow duration-200">

// Grid layout
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

// Flex alignment
<div className="flex items-center justify-between gap-4">
```

---

## Design System Files

- `design-tokens.ts` - Color, spacing, typography constants
- `KPICard.tsx` - KPI card component
- `DataTable.tsx` - Professional data table
- `PageHeader.tsx` - Page header with breadcrumbs
- `Badge.tsx` - Status/tag badges
- `Sidebar.tsx` - Professional navigation
- `tailwind.config.ts` - Tailwind configuration with custom colors/fonts
