import type { GhlBlueprint, GhlBlueprintDemoLead } from '../../types/index.js';

/**
 * Blueprint for Gravvia's own sub-account: full sales pipeline plus ~20
 * fictional demo leads with opportunities spread across every stage so
 * dashboard widgets (stage bars, pipeline value, conversion donut) populate.
 * All data is deterministic: .example.com domains (reserved, never routable)
 * and 555 phone numbers, so an idempotent re-apply matches the same records.
 */

const STAGES = [
  'New Lead',
  'Contacted',
  'Demo Booked',
  'Demo Completed',
  'Proposal Sent',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
] as const;

type Stage = (typeof STAGES)[number];
type Interest = 'Hot' | 'Warm' | 'Cold';

// first, last, company, domain slug, industry, monthly call volume,
// interest, stage, opportunity value, demo date (demo stages only)
const LEADS: Array<
  [string, string, string, string, string, number, Interest, Stage, number, string?]
> = [
  ['Sarah', 'Mitchell', 'BrightSmile Dental', 'brightsmile-dental', 'Dental', 220, 'Warm', 'New Lead', 3600],
  ['James', 'Porter', 'Porter & Associates', 'porterlaw', 'Law Firm', 90, 'Cold', 'New Lead', 1500],
  ['Elena', 'Vasquez', 'Glow Med Spa', 'glowmedspa', 'Med Spa', 310, 'Hot', 'New Lead', 5400],
  ['Marcus', 'Reed', 'Reed Roofing', 'reedroofing', 'Home Services', 140, 'Warm', 'Contacted', 2400],
  ['Priya', 'Sharma', 'Lotus Wellness', 'lotuswellness', 'Med Spa', 260, 'Hot', 'Contacted', 4800],
  ['Tom', 'Delaney', 'Delaney Realty', 'delaneyrealty', 'Real Estate', 75, 'Cold', 'Contacted', 1200],
  ['Angela', 'Brooks', 'Brooks Pediatrics', 'brookspediatrics', 'Healthcare', 420, 'Hot', 'Demo Booked', 8200, '2026-07-21'],
  ['David', 'Kim', 'Kim Orthodontics', 'kimortho', 'Dental', 180, 'Warm', 'Demo Booked', 3900, '2026-07-23'],
  ['Rachel', 'Nguyen', 'Nguyen Legal Group', 'nguyenlegal', 'Law Firm', 350, 'Hot', 'Demo Booked', 7500, '2026-07-24'],
  ['Chris', 'Alvarez', 'Alvarez Plumbing', 'alvarezplumbing', 'Home Services', 130, 'Warm', 'Demo Completed', 2800, '2026-07-10'],
  ['Monica', 'Feld', 'Feld Dermatology', 'feldderm', 'Healthcare', 500, 'Hot', 'Demo Completed', 9600, '2026-07-14'],
  ['Brian', 'Okafor', 'Okafor Family Dental', 'okafordental', 'Dental', 390, 'Hot', 'Proposal Sent', 8800],
  ['Lisa', 'Tran', 'Tran Spa & Laser', 'transpa', 'Med Spa', 210, 'Warm', 'Proposal Sent', 4200],
  ['George', 'Hansen', 'Hansen HVAC', 'hansenhvac', 'Home Services', 160, 'Warm', 'Proposal Sent', 3000],
  ['Nina', 'Petrov', 'Petrov Law', 'petrovlaw', 'Law Firm', 450, 'Hot', 'Negotiation', 12000],
  ['Alan', 'Whitfield', 'Whitfield Surgical', 'whitfieldsurgical', 'Healthcare', 520, 'Hot', 'Negotiation', 15000],
  ['Dana', 'Cole', 'Cole Chiropractic', 'colechiro', 'Healthcare', 280, 'Hot', 'Closed Won', 6000],
  ['Miguel', 'Santos', 'Santos Realty', 'santosrealty', 'Real Estate', 190, 'Warm', 'Closed Won', 3600],
  ['Olivia', 'Grant', 'Grant Aesthetics', 'grantaesthetics', 'Med Spa', 110, 'Cold', 'Closed Lost', 2000],
  ['Peter', 'Larsson', 'Larsson Legal', 'larssonlegal', 'Law Firm', 240, 'Warm', 'Closed Lost', 500],
];

function buildLead(
  [first, last, company, slug, industry, callVolume, interest, stage, value, demoDate]: (typeof LEADS)[number],
  index: number
): GhlBlueprintDemoLead {
  const tags = ['inbound-lead'];
  if (interest === 'Hot') tags.push('hot-lead');
  if (interest === 'Cold') tags.push('nurture');
  if (stage === 'Demo Booked' || stage === 'Demo Completed') tags.push('demo-requested');
  if (stage === 'Contacted' || stage === 'Demo Completed') tags.push('needs-follow-up');
  if (stage === 'Closed Won') tags.push('closed-won');

  return {
    firstName: first,
    lastName: last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@${slug}.example.com`,
    phone: `+1555010${String(index + 1).padStart(4, '0')}`,
    tags,
    customFields: {
      'Company Industry': industry,
      'Current Call Volume': String(callVolume),
      'Interest Level': interest,
      ...(demoDate ? { 'Demo Date': demoDate } : {}),
    },
    opportunity: {
      name: `${company} — AI Voice Agent`,
      stage,
      monetaryValue: value,
    },
  };
}

export const gravviaSalesBlueprint = {
  name: 'gravvia-sales',
  pipeline: {
    name: 'Gravvia Sales',
    stages: [...STAGES],
  },
  customFields: [
    {
      name: 'Company Industry',
      dataType: 'SINGLE_OPTIONS',
      options: ['Dental', 'Med Spa', 'Law Firm', 'Home Services', 'Real Estate', 'Healthcare', 'Other'],
    },
    { name: 'Current Call Volume', dataType: 'NUMERICAL' },
    { name: 'Interest Level', dataType: 'SINGLE_OPTIONS', options: ['Hot', 'Warm', 'Cold'] },
    { name: 'Demo Date', dataType: 'DATE' },
    { name: 'Retell Call ID', dataType: 'TEXT' },
    { name: 'Call Summary', dataType: 'LARGE_TEXT' },
  ],
  tags: ['inbound-lead', 'demo-requested', 'hot-lead', 'needs-follow-up', 'closed-won', 'nurture'],
  demoLeads: LEADS.map(buildLead),
} satisfies GhlBlueprint;
