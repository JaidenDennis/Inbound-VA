/**
 * Seed synthetic demo data for one client.
 *
 * WHAT THIS IS FOR
 *
 * Showing the dashboard to someone. The real call history is thin and,
 * for Bare Beauty, mostly hang-ups and debugging sessions — honest, but it
 * demonstrates nothing. This adds recent, coherent traffic so every page has
 * something to show.
 *
 * EVERY ROW IS MARKED. The marker differs per table because `calls` has no
 * metadata column:
 *
 *   calls                 retell_call_id prefixed 'demo_seed_' (TEXT, UNIQUE)
 *   contacts              custom_fields.demo_seed = true, plus a 'demo-seed' tag
 *   appointments          metadata.demo_seed = true
 *   conversations         metadata.demo_seed = true
 *   tickets               subject prefixed nothing; identified via call_id/contact_id
 *   client_action_items   description suffix marker
 *   call_transcripts /    no column available; identified by joining to a
 *   call_summaries        'demo_seed_'-prefixed call
 *
 * Anything excluding demo data from reporting must route through `calls` —
 * there is no single shared flag. This is recorded in the design spec too.
 *
 * Idempotent: --reset removes everything a previous run inserted before
 * inserting again, so re-running converges rather than accumulating.
 *
 *   npx tsx scripts/seed-demo-data.ts <client-slug> --reset
 *   npx tsx scripts/seed-demo-data.ts <client-slug> --clean   (remove only)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const slug = process.argv[2];
const doReset = process.argv.includes('--reset');
const cleanOnly = process.argv.includes('--clean');

if (!slug) {
  console.error('Usage: npx tsx scripts/seed-demo-data.ts <client-slug> [--reset|--clean]');
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const SEED_PREFIX = 'demo_seed_';
const DAY = 86_400_000;
const now = Date.now();

/** Local-clock helper: N days from now at a given hour:minute, as ISO. */
function at(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date(now + daysFromNow * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

interface Turn { role: 'agent' | 'user'; content: string }

interface Scenario {
  /** Days ago the call happened. */
  daysAgo: number;
  hour: number;
  minute: number;
  first: string;
  last: string;
  phone: string;
  email: string;
  durationSeconds: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  followUp: boolean;
  bookingRequested: boolean;
  handoffRequested: boolean;
  leadCaptured: boolean;
  callStatus: 'completed' | 'transferred';
  /** Overrides for the call_records analysis columns; all derived when omitted. */
  callReason?: string;
  qualityScore?: number;
  turns: Turn[];
  /** Optional appointment produced by the call. */
  appointment?: {
    title: string;
    serviceType: string;
    startDaysFromNow: number;
    hour: number;
    minute: number;
    durationMinutes: number;
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  };
}

/**
 * Fifteen calls across the last ten days.
 *
 * Deliberately NOT all successes. A demo where every call books perfectly reads
 * as a mock-up; one where the agent handles a price objection, escalates a
 * medical question it should not answer, and takes a wrong number reads as a
 * system someone actually runs. The mix is roughly 8 booked / 4 informational /
 * 2 escalated / 1 wrong number.
 */
const SCENARIOS: Scenario[] = [
  {
    daysAgo: 0, hour: 9, minute: 12,
    first: 'Danielle', last: 'Okonkwo', phone: '+19045550118', email: 'd.okonkwo@gmail.com',
    durationSeconds: 148, sentiment: 'positive',
    summary: 'Caller booked a first Botox appointment for the forehead and asked about downtime. Agent confirmed pricing at $12 per unit, explained there is no downtime, and scheduled her for Thursday at 10:00 AM.',
    keyTopics: ['Botox'], actionItems: ['Send pre-treatment instructions'],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Botox', serviceType: 'Botox', startDaysFromNow: 2, hour: 10, minute: 0, durationMinutes: 30, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "Hi, I'm interested in getting Botox but I've never done it before." },
      { role: 'agent', content: "That's exciting — a lot of our first-time clients start with the forehead or the area between the brows. Is there a particular area you had in mind?" },
      { role: 'user', content: 'My forehead mostly. How much does it usually run?' },
      { role: 'agent', content: 'Botox is twelve dollars per unit, and the forehead typically takes somewhere between ten and twenty units. Your injector confirms the exact amount at the appointment, so there are no surprises on the day.' },
      { role: 'user', content: "Okay that's reasonable. Is there any downtime? I have work." },
      { role: 'agent', content: "No downtime at all. We just ask that you stay upright for four hours and skip strenuous exercise that day. Most people come in on a lunch break." },
      { role: 'user', content: 'Perfect. Can I get in this week?' },
      { role: 'agent', content: 'I have Thursday at ten in the morning, or Friday at two thirty. Which works better?' },
      { role: 'user', content: "Thursday at ten works." },
      { role: 'agent', content: "Wonderful. Can I get your full name and the best number to reach you?" },
      { role: 'user', content: "Danielle Okonkwo. It's 904-555-0118." },
      { role: 'agent', content: "Thank you Danielle. You're all set for Thursday at ten for Botox. You'll get a confirmation text shortly with pre-treatment instructions. Anything else I can help with?" },
      { role: 'user', content: "No that's it, thank you!" },
      { role: 'agent', content: 'My pleasure. We look forward to seeing you Thursday. Have a lovely day.' },
    ],
  },
  {
    daysAgo: 0, hour: 14, minute: 38,
    first: 'Marissa', last: 'Whitcomb', phone: '+19045550142', email: 'marissa.whitcomb@outlook.com',
    durationSeconds: 96, sentiment: 'neutral',
    summary: 'Caller asked whether the medspa treats melasma and what the pricing would be. Agent explained that a consultation is required to assess the condition and booked a complimentary consultation for Monday.',
    keyTopics: ['Consultation', 'Microneedling'], actionItems: [],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Consultation', serviceType: 'Consultation', startDaysFromNow: 4, hour: 11, minute: 30, durationMinutes: 30, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: 'Hi — do you all treat melasma? I have some dark patches on my cheeks.' },
      { role: 'agent', content: "We do see clients for pigmentation concerns. Because melasma responds differently depending on skin type and what's driving it, our providers always start with a consultation rather than quoting a treatment over the phone." },
      { role: 'user', content: 'How much is the consultation?' },
      { role: 'agent', content: "The consultation is complimentary. You'll sit down with a provider, they'll assess the area, and you'll leave with a plan and pricing." },
      { role: 'user', content: 'Okay, that works. What do you have next week?' },
      { role: 'agent', content: 'I have Monday at eleven thirty or Tuesday at four. Any preference?' },
      { role: 'user', content: 'Monday is better.' },
      { role: 'agent', content: 'Great — can I have your full name and a good callback number?' },
      { role: 'user', content: 'Marissa Whitcomb, 904-555-0142.' },
      { role: 'agent', content: "You're booked for Monday at eleven thirty for a complimentary consultation. Anything else?" },
      { role: 'user', content: 'Nope, thanks.' },
    ],
  },
  {
    daysAgo: 1, hour: 10, minute: 5,
    first: 'Priya', last: 'Raghunathan', phone: '+19045550163', email: 'praghunathan@gmail.com',
    durationSeconds: 211, sentiment: 'positive',
    summary: 'Existing client booked a Hydrafacial and added a package question. Agent explained the six-session package pricing and the Bare Glow Membership, and booked the Hydrafacial for next Wednesday.',
    keyTopics: ['Hydrafacial'], actionItems: ['Email membership details'],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Hydrafacial', serviceType: 'Hydrafacial', startDaysFromNow: 6, hour: 13, minute: 0, durationMinutes: 50, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "Hi Emily, I've been in before — I'd like to book another Hydrafacial." },
      { role: 'agent', content: 'Welcome back. I can get that scheduled. May I have your name so I can pull up your file?' },
      { role: 'user', content: 'Priya Raghunathan.' },
      { role: 'agent', content: "Thank you Priya. What day works for you?" },
      { role: 'user', content: 'Sometime next week. Also — do you do packages? I feel like I should just commit.' },
      { role: 'agent', content: 'We do. A six-session Hydrafacial package brings the per-treatment price down meaningfully compared to booking one at a time. We also have the Bare Glow Membership, which is monthly and includes a facial plus member pricing on everything else.' },
      { role: 'user', content: "Ooh. Which one makes more sense if I'm coming about once a month?" },
      { role: 'agent', content: "At roughly monthly, most clients find the membership works out better, because the included facial covers the visit you were already planning and the member pricing applies to anything else you add. I can have the front desk email you both breakdowns so you can compare." },
      { role: 'user', content: "Yes please, send that. And let's do next Wednesday for the facial." },
      { role: 'agent', content: 'Wednesday at one in the afternoon — does that work?' },
      { role: 'user', content: 'Perfect.' },
      { role: 'agent', content: "You're all set for Wednesday at one for a Hydrafacial, and I've noted to send the membership and package details to your email. Anything else?" },
      { role: 'user', content: "That's everything, thanks Emily." },
      { role: 'agent', content: 'Happy to help. See you Wednesday, Priya.' },
    ],
  },
  {
    daysAgo: 1, hour: 16, minute: 22,
    first: 'Gregory', last: 'Vance', phone: '+19045550177', email: 'gvance88@yahoo.com',
    durationSeconds: 134, sentiment: 'neutral',
    summary: 'Caller asked whether the practice offers laser hair removal for men and how many sessions are typically needed. Agent confirmed the service is offered and booked a consultation.',
    keyTopics: ['Laser Hair Removal', 'Consultation'], actionItems: [],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Consultation', serviceType: 'Consultation', startDaysFromNow: 5, hour: 15, minute: 0, durationMinutes: 30, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: 'Do you do laser hair removal for men? Back and shoulders.' },
      { role: 'agent', content: 'We do — back and shoulders are among our more common areas for male clients.' },
      { role: 'user', content: 'How many sessions am I looking at?' },
      { role: 'agent', content: "Most people need somewhere in the range of six to eight sessions spaced several weeks apart, though your provider will give you a specific number once they've seen the area and your hair type." },
      { role: 'user', content: 'And the cost?' },
      { role: 'agent', content: 'Laser hair removal starts at a hundred and fifty dollars per area, with package pricing available once the provider maps out your plan.' },
      { role: 'user', content: "Alright. Let's do the consultation then." },
      { role: 'agent', content: 'I have Tuesday at three. Would that suit?' },
      { role: 'user', content: 'Yeah, Tuesday works. Gregory Vance, 904-555-0177.' },
      { role: 'agent', content: "Thanks Gregory — Tuesday at three for a consultation. We'll see you then." },
    ],
  },
  {
    daysAgo: 2, hour: 11, minute: 47,
    first: 'Yvonne', last: 'Castellanos', phone: '+19045550194', email: 'yvonne.cast@gmail.com',
    durationSeconds: 178, sentiment: 'negative',
    summary: 'Caller was unhappy that her previous appointment ran forty minutes late and asked to speak with a manager. Agent apologised, took the details, and escalated to the practice manager for a callback.',
    keyTopics: [], actionItems: ['Practice manager to call back re: late appointment'],
    followUp: true, bookingRequested: false, handoffRequested: true, leadCaptured: false,
    callStatus: 'transferred',
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I was in on Friday and I waited forty minutes past my appointment time. I took time off work for that." },
      { role: 'agent', content: "I'm really sorry — that's not the experience we want you to have, and forty minutes is a long time to be kept waiting. Can I get your name so I can look at what happened?" },
      { role: 'user', content: 'Yvonne Castellanos.' },
      { role: 'agent', content: 'Thank you Yvonne. I can see your Friday appointment. I want to get this in front of our practice manager rather than just apologising and leaving it there — would you be open to a call back from her today?' },
      { role: 'user', content: "Yes. I'd like someone to actually acknowledge it." },
      { role: 'agent', content: 'Understood, and that is fair. Is 904-555-0194 the best number, and is there a time that works better for you?' },
      { role: 'user', content: "That number's fine. After four is best." },
      { role: 'agent', content: "I've passed this to our practice manager with a note to call you after four today. Again, I'm sorry about Friday — thank you for telling us rather than just not coming back." },
      { role: 'user', content: 'Thanks.' },
    ],
  },
  {
    daysAgo: 2, hour: 15, minute: 3,
    first: 'Tomas', last: 'Beaulieu', phone: '+19045550136', email: 'tbeaulieu@protonmail.com',
    durationSeconds: 87, sentiment: 'neutral',
    summary: 'Caller asked whether the medspa could prescribe a medication for a skin condition. Agent correctly declined to give medical advice and offered a consultation with a provider instead.',
    keyTopics: ['Consultation'], actionItems: [],
    followUp: false, bookingRequested: false, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I've got some cystic acne and I was wondering if you can prescribe accutane." },
      { role: 'agent', content: "I'm not able to advise on prescriptions or medical treatment — that has to come from a provider who can actually assess you. What I can do is book you a consultation so one of our providers can look at it and tell you what they'd recommend." },
      { role: 'user', content: 'Do they prescribe though? I just want to know before I come in.' },
      { role: 'agent', content: "I genuinely don't want to guess at that and get it wrong. The provider will tell you at the consultation what's within their scope and what would need a dermatology referral, and the consultation itself is complimentary either way." },
      { role: 'user', content: "Okay. Let me think about it and call back." },
      { role: 'agent', content: "Of course. We're here whenever you're ready — no rush." },
    ],
  },
  {
    daysAgo: 3, hour: 9, minute: 55,
    first: 'Shanice', last: 'Delacroix', phone: '+19045550151', email: 'shanice.d@gmail.com',
    durationSeconds: 165, sentiment: 'positive',
    summary: 'Caller booked microneedling for acne scarring after asking about pain and recovery. Agent explained numbing cream and typical redness, and scheduled for the following Monday.',
    keyTopics: ['Microneedling'], actionItems: [],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Microneedling', serviceType: 'Microneedling', startDaysFromNow: 8, hour: 9, minute: 30, durationMinutes: 60, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I have acne scarring on my cheeks and someone recommended microneedling. Does it hurt?" },
      { role: 'agent', content: "We apply a topical numbing cream about twenty to thirty minutes beforehand, so most clients describe it as a sandpapery or prickling feeling rather than sharp pain." },
      { role: 'user', content: 'And afterwards? Am I going to look like a tomato?' },
      { role: 'agent', content: "Honestly, some redness is normal — think of a moderate sunburn for the first twenty four hours, settling over the next day or two. A lot of clients book it on a Friday so they have the weekend." },
      { role: 'user', content: "That's fair. What's the price?" },
      { role: 'agent', content: 'Microneedling is three hundred and fifty dollars a session, and it is one of the treatments included in our package pricing if you end up wanting a series.' },
      { role: 'user', content: "Let's start with one and see. Do you have a Monday?" },
      { role: 'agent', content: 'I have Monday week at nine thirty in the morning.' },
      { role: 'user', content: 'Book it. Shanice Delacroix, 904-555-0151.' },
      { role: 'agent', content: "You're set, Shanice — Monday at nine thirty for microneedling. We'll send aftercare instructions ahead of time so you know what to expect." },
      { role: 'user', content: 'Thank you!' },
    ],
  },
  {
    daysAgo: 3, hour: 13, minute: 29,
    first: 'Unknown', last: 'Caller', phone: '+19045550100', email: '',
    durationSeconds: 22, sentiment: 'neutral',
    summary: 'Wrong number. Caller was trying to reach a dental office and rang off once the agent identified the business.',
    keyTopics: [], actionItems: [],
    followUp: false, bookingRequested: false, handoffRequested: false, leadCaptured: false,
    callStatus: 'completed',
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "Oh — sorry, I was trying to reach Ponte Vedra Dental." },
      { role: 'agent', content: "No problem at all — you've reached Bare Beauty Medspa. Hope you get through to them." },
      { role: 'user', content: 'Thanks, sorry about that.' },
    ],
  },
  {
    daysAgo: 4, hour: 10, minute: 40,
    first: 'Bethany', last: 'Kraus', phone: '+19045550129', email: 'bkraus@icloud.com',
    durationSeconds: 192, sentiment: 'neutral',
    summary: 'Caller compared body contouring options and pushed back on price. Agent explained the treatment, held the price, and offered a complimentary consultation; caller booked.',
    keyTopics: ['Body Contouring', 'Consultation'], actionItems: [],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Consultation', serviceType: 'Consultation', startDaysFromNow: 3, hour: 16, minute: 30, durationMinutes: 30, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I'm looking at body contouring. What do you charge?" },
      { role: 'agent', content: 'Body contouring starts at six hundred dollars per treatment area.' },
      { role: 'user', content: "That's a lot more than the place on Beach Boulevard quoted me." },
      { role: 'agent', content: "I understand, and I'm not going to pretend we're the cheapest option in town. What I can tell you is what that covers here — the treatment is non-invasive, it's performed by a licensed provider rather than a technician, and your plan is mapped out at a consultation instead of sold over the phone." },
      { role: 'user', content: "Do you do any package deals?" },
      { role: 'agent', content: 'We do offer package pricing for multi-session plans, and the provider works that out with you once they know how many areas and sessions you actually need — which is genuinely hard to quote before they have seen you.' },
      { role: 'user', content: "Alright, I'll come in and hear it. When can you see me?" },
      { role: 'agent', content: 'I have Friday at four thirty for a complimentary consultation.' },
      { role: 'user', content: 'Fine. Bethany Kraus, 904-555-0129.' },
      { role: 'agent', content: "Thank you Bethany — Friday at four thirty. No obligation at the consultation, and you'll leave knowing exactly what it would cost." },
    ],
  },
  {
    daysAgo: 5, hour: 12, minute: 15,
    first: 'Rosalind', last: 'Achebe', phone: '+19045550188', email: 'r.achebe@gmail.com',
    durationSeconds: 143, sentiment: 'positive',
    summary: 'Caller rescheduled an existing Hydrafacial appointment after a work conflict. Agent moved it to the following week and confirmed the new time.',
    keyTopics: ['Hydrafacial'], actionItems: [],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: false,
    callStatus: 'completed',
    appointment: { title: 'Hydrafacial', serviceType: 'Hydrafacial', startDaysFromNow: 9, hour: 14, minute: 0, durationMinutes: 50, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I need to move my facial appointment — something came up at work." },
      { role: 'agent', content: 'Not a problem at all. May I have your name?' },
      { role: 'user', content: 'Rosalind Achebe.' },
      { role: 'agent', content: 'Thank you Rosalind. I see your Hydrafacial. What day would work better?' },
      { role: 'user', content: 'Any chance of the following week? Afternoons are easier.' },
      { role: 'agent', content: 'I have Thursday week at two in the afternoon.' },
      { role: 'user', content: "That's much better." },
      { role: 'agent', content: "Done — I've moved you to Thursday the following week at two. You'll get an updated confirmation. Anything else I can do?" },
      { role: 'user', content: "No, that's great. Thanks for being easy about it." },
      { role: 'agent', content: 'Of course. See you then.' },
    ],
  },
  {
    daysAgo: 6, hour: 8, minute: 50,
    first: 'Camille', last: 'Renaud', phone: '+19045550172', email: 'camille.renaud@gmail.com',
    durationSeconds: 119, sentiment: 'neutral',
    summary: 'Caller asked about hours, parking and whether walk-ins are accepted. Agent answered all three and invited her to book.',
    keyTopics: [], actionItems: [],
    followUp: false, bookingRequested: false, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: 'What are your hours? And is there parking?' },
      { role: 'agent', content: "We're open Monday through Friday nine to six, and Saturdays ten to three. There's free parking directly in front of the building." },
      { role: 'user', content: 'Do you take walk-ins?' },
      { role: 'agent', content: "We're appointment-based, so I'd hate for you to drive over and not be seen. If you tell me roughly when you're free I can find you something." },
      { role: 'user', content: "I'm not sure of my schedule yet — I'll call back once I know." },
      { role: 'agent', content: "That's absolutely fine. We're here Monday to Saturday whenever you're ready." },
    ],
  },
  {
    daysAgo: 7, hour: 17, minute: 8,
    first: 'Adaeze', last: 'Mbeki', phone: '+19045550145', email: 'adaeze.m@outlook.com',
    durationSeconds: 205, sentiment: 'positive',
    summary: 'Caller booked Botox and a Hydrafacial on the same visit for an upcoming wedding, and asked about timing relative to the event. Agent advised booking Botox at least two weeks ahead and scheduled accordingly.',
    keyTopics: ['Botox', 'Hydrafacial'], actionItems: ['Confirm combined visit timing with provider'],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: true,
    callStatus: 'completed',
    appointment: { title: 'Botox + Hydrafacial', serviceType: 'Botox', startDaysFromNow: 12, hour: 11, minute: 0, durationMinutes: 80, status: 'confirmed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I'm in a wedding next month and I want to look my best. Botox and a facial maybe?" },
      { role: 'agent', content: 'Lovely — congratulations to whoever is getting married. When is the wedding exactly?' },
      { role: 'user', content: "It's the twentieth of September." },
      { role: 'agent', content: "Good, that gives us room. For Botox I'd want you in at least two weeks before, ideally three, so it has fully settled and there's time to adjust if needed. A Hydrafacial is best a week or so out for that fresh-skin look." },
      { role: 'user', content: "Can I do them both in one visit to save trips?" },
      { role: 'agent', content: "You can do both in one visit — I'll book it as a combined appointment and note that the provider should confirm the ordering on the day. Would late August suit for the Botox timing?" },
      { role: 'user', content: 'Yes. Something late morning?' },
      { role: 'agent', content: 'I have eleven in the morning in about twelve days.' },
      { role: 'user', content: "Perfect. Adaeze Mbeki, 904-555-0145." },
      { role: 'agent', content: "You're booked, Adaeze — eleven o'clock, Botox and a Hydrafacial. I've noted the wedding date so the provider can build the timing around it. Congratulations again." },
      { role: 'user', content: "Thank you so much!" },
    ],
  },
  {
    daysAgo: 8, hour: 11, minute: 33,
    first: 'Lorraine', last: 'Devereux', phone: '+19045550109', email: 'ldevereux@gmail.com',
    durationSeconds: 156, sentiment: 'neutral',
    summary: 'Caller asked whether a treatment was safe while breastfeeding. Agent declined to advise, flagged it for a provider, and arranged a callback rather than booking.',
    keyTopics: [], actionItems: ['Provider to advise on treatment safety while breastfeeding'],
    followUp: true, bookingRequested: false, handoffRequested: true, leadCaptured: true,
    callStatus: 'completed',
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I'd like to book Botox but I'm still breastfeeding. Is that okay?" },
      { role: 'agent', content: "That's a question I have to put to a provider rather than answer myself — anything touching pregnancy or breastfeeding needs a clinician's judgement, not mine." },
      { role: 'user', content: "I just want a yes or no really." },
      { role: 'agent', content: "I understand, and I'd rather give you no answer than the wrong one on something like this. What I can do is have one of our providers call you back directly today so you get a proper answer." },
      { role: 'user', content: "Okay, that's fair. Yes please." },
      { role: 'agent', content: 'Can I take your name and the best number?' },
      { role: 'user', content: 'Lorraine Devereux, 904-555-0109.' },
      { role: 'agent', content: "Thank you Lorraine. A provider will call you back today about whether it's appropriate while breastfeeding, and we'll go from there." },
      { role: 'user', content: 'Appreciate it.' },
    ],
  },
  {
    daysAgo: 9, hour: 14, minute: 55,
    first: 'Simone', last: 'Ferraro', phone: '+19045550158', email: 'simone.ferraro@icloud.com',
    durationSeconds: 174, sentiment: 'positive',
    summary: 'Returning client booked laser hair removal for a second area and asked about spacing between sessions. Agent confirmed the interval and scheduled the next session.',
    keyTopics: ['Laser Hair Removal'], actionItems: [],
    followUp: false, bookingRequested: true, handoffRequested: false, leadCaptured: false,
    callStatus: 'completed',
    appointment: { title: 'Laser Hair Removal', serviceType: 'Laser Hair Removal', startDaysFromNow: -2, hour: 10, minute: 30, durationMinutes: 30, status: 'completed' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I've been coming for laser on my underarms and I want to add my legs." },
      { role: 'agent', content: 'Happy to add that. May I have your name?' },
      { role: 'user', content: 'Simone Ferraro.' },
      { role: 'agent', content: "Thanks Simone. Since legs are a separate area they're priced separately, starting at a hundred and fifty. How far apart have your underarm sessions been?" },
      { role: 'user', content: 'About four weeks I think.' },
      { role: 'agent', content: "That's the right spacing. We can start the legs on your next visit and keep both on the same schedule so you're only coming in once each cycle." },
      { role: 'user', content: "Oh good, that's much easier." },
      { role: 'agent', content: "I've got you down. See you at your next session." },
      { role: 'user', content: 'Thanks Emily.' },
    ],
  },
  {
    daysAgo: 10, hour: 9, minute: 20,
    first: 'Faith', last: 'Okonjo', phone: '+19045550166', email: 'faith.okonjo@gmail.com',
    durationSeconds: 68, sentiment: 'neutral',
    summary: 'Caller cancelled an upcoming consultation due to travel and did not rebook. Agent cancelled the appointment and left the door open.',
    keyTopics: ['Consultation'], actionItems: [],
    followUp: false, bookingRequested: false, handoffRequested: false, leadCaptured: false,
    callStatus: 'completed',
    appointment: { title: 'Consultation', serviceType: 'Consultation', startDaysFromNow: -1, hour: 12, minute: 0, durationMinutes: 30, status: 'cancelled' },
    turns: [
      { role: 'agent', content: 'Thank you for calling Bare Beauty Medspa, this is Emily. How can I help you today?' },
      { role: 'user', content: "I need to cancel my consultation, I'm going to be travelling." },
      { role: 'agent', content: 'Of course. May I have your name?' },
      { role: 'user', content: 'Faith Okonjo.' },
      { role: 'agent', content: "Thank you Faith — I've cancelled that for you. Would you like me to book something for when you're back, or would you rather call us?" },
      { role: 'user', content: "I'll call when I'm back, my dates aren't firm." },
      { role: 'agent', content: "No problem at all. Safe travels, and we'll be here." },
    ],
  },
];

/**
 * Derive the call_records analysis row from the scenario.
 *
 * call_records is a PARALLEL table to calls, joined on retell_call_id, and the
 * client_call_log view the reporting pages read is driven FROM call_records
 * (LEFT JOIN calls). A call with no call_records row is invisible on the calls
 * report no matter how complete its `calls` row is — which is exactly what
 * happened on the first seed run.
 *
 * `outcome` is not stored: the view computes it via call_outcome() from
 * appointment_booked / lead_recaptured / call status / in_voicemail /
 * call_successful, in that precedence. These flags are set so each scenario
 * lands on the outcome its transcript actually describes.
 */
function deriveRecord(s: Scenario): Record<string, unknown> {
  const booked = Boolean(s.appointment && s.appointment.status !== 'cancelled');
  const successful = s.callStatus === 'transferred' ? true : booked || s.leadCaptured;
  const base = s.sentiment === 'negative' ? 7 : s.followUp ? 8 : 9;
  return {
    agent_id: 'agent_2ad66579467380fee2d1b7b6e7',
    in_voicemail: false,
    disconnection_reason: 'user_hangup',
    user_sentiment: s.sentiment.charAt(0).toUpperCase() + s.sentiment.slice(1),
    call_successful: successful,
    appointment_booked: booked,
    // Only counts when a lead was captured WITHOUT a booking, otherwise the
    // outcome precedence would hide the booking behind 'lead_captured'.
    lead_recaptured: !booked && s.leadCaptured,
    missed_call_recovered: false,
    call_reason: s.callReason ?? (s.keyTopics[0] ? `${s.keyTopics[0]} enquiry` : 'General enquiry'),
    requested_service: s.keyTopics[0] ?? null,
    service_available: s.keyTopics.length > 0,
    escalation_reason: s.handoffRequested ? s.actionItems[0] ?? 'Caller asked for a person' : null,
    // 0-10 scale (CHECK call_records_quality_range), not a percentage.
    quality_score: s.qualityScore ?? base,
    quality_accuracy: Math.min(10, base + 1),
    quality_resolution: booked ? Math.min(10, base + 1) : Math.max(0, base - 1),
    quality_tone: s.sentiment === 'negative' ? 8 : 9,
    flagged: s.sentiment === 'negative',
    flag_reasons: s.sentiment === 'negative' ? ['negative_sentiment'] : [],
    analyzed_at: new Date().toISOString(),
    raw_analysis: { demo_seed: true },
  };
}

/** Front-desk tasks. Mixed pending/done so the list reads as lived-in. */
const ACTION_ITEMS: Array<{ title: string; description: string; status: 'pending' | 'done' }> = [
  { title: 'Call Yvonne Castellanos about Friday wait time', description: 'Escalated by Emily. Client waited 40 minutes past her appointment. Practice manager to call after 4pm.', status: 'pending' },
  { title: 'Provider callback: breastfeeding safety question', description: 'Lorraine Devereux asked whether Botox is appropriate while breastfeeding. Emily correctly declined to advise. Needs a clinician.', status: 'pending' },
  { title: 'Email membership and package comparison to Priya Raghunathan', description: 'Requested a side-by-side of the six-session Hydrafacial package vs the Bare Glow Membership.', status: 'pending' },
  { title: 'Confirm combined Botox + Hydrafacial ordering for Adaeze Mbeki', description: 'Wedding on 20 September. Provider to confirm treatment order and timing on the day.', status: 'pending' },
  { title: 'Review 3 calls flagged for follow-up this week', description: 'Calls where the agent could not complete the request. Check whether any need a human callback.', status: 'pending' },
  { title: 'Update Botox pricing in the knowledge base', description: 'Per-unit price confirmed at $12. Make sure the agent quotes the current figure.', status: 'done' },
  { title: 'Add Saturday hours to the agent knowledge base', description: 'Emily was asked about weekend availability twice this month.', status: 'done' },
  { title: 'Send pre-treatment instructions to Danielle Okonkwo', description: 'First-time Botox client booked for Thursday 10am.', status: 'done' },
  { title: 'Verify parking directions in the FAQ', description: 'Callers asking about parking; confirm the answer matches the building signage.', status: 'done' },
];

/** Support tickets. Spread across statuses and priorities. */
const TICKETS: Array<{ subject: string; description: string; priority: string; status: string }> = [
  { subject: 'Client reports 40-minute wait at Friday appointment', description: 'Yvonne Castellanos called to complain that her Friday appointment ran 40 minutes late. Escalated by the voice agent for a practice manager callback.', priority: 'high', status: 'investigating' },
  { subject: 'Agent should not answer breastfeeding safety questions', description: 'Caller asked whether Botox is safe while breastfeeding. The agent correctly declined and escalated. Confirming this is the desired behaviour and that the policy wording covers it.', priority: 'normal', status: 'waiting_on_client' },
  { subject: 'Add melasma to the treatable-conditions FAQ', description: 'Two callers have asked about melasma this month. The agent handles it by booking a consultation, but an explicit FAQ entry would be clearer.', priority: 'low', status: 'investigating' },
  { subject: 'Confirm Saturday hours in agent knowledge base', description: 'Agent quoted Saturday 10-3. Front desk confirmed this is correct as of August.', priority: 'low', status: 'resolved' },
];

async function main(): Promise<void> {
  const { data: client, error: clientErr } = await sb
    .from('clients').select('id, name').eq('slug', slug).single();
  if (clientErr || !client) throw new Error(`No client with slug '${slug}'`);
  const clientId = client.id;

  // ── clean ────────────────────────────────────────────────────────────────
  if (doReset || cleanOnly) {
    // Calls cascade to transcripts, summaries and conversations.
    const { data: seeded } = await sb
      .from('calls').select('id').eq('client_id', clientId).like('retell_call_id', `${SEED_PREFIX}%`);
    const seededIds = (seeded ?? []).map((c) => c.id);

    if (seededIds.length) {
      await sb.from('appointments').delete().in('call_id', seededIds);
      await sb.from('calls').delete().in('id', seededIds);
    }
    // call_records is a parallel table with no FK to calls, so cascade does not
    // reach it — it has to be cleaned on its own key.
    await sb.from('call_records').delete().eq('client_id', clientId).like('retell_call_id', `${SEED_PREFIX}%`);
    await sb.from('contacts').delete().eq('client_id', clientId).contains('custom_fields', { demo_seed: true });
    await sb.from('client_action_items').delete().eq('client_id', clientId).like('description', '%[demo]%');
    await sb.from('tickets').delete().eq('client_id', clientId).like('description', '%[demo]%');
    console.log(`Removed ${seededIds.length} seeded calls and their dependents.`);
    if (cleanOnly) return;
  }

  // ── contacts + calls + transcripts + summaries + conversations ───────────
  let calls = 0;
  let appts = 0;

  for (const [index, s] of SCENARIOS.entries()) {
    const startedAt = new Date(now - s.daysAgo * DAY);
    startedAt.setHours(s.hour, s.minute, 0, 0);
    const endedAt = new Date(startedAt.getTime() + s.durationSeconds * 1000);

    const { data: contact, error: contactErr } = await sb
      .from('contacts')
      .insert({
        client_id: clientId,
        first_name: s.first,
        last_name: s.last,
        phone: s.phone,
        email: s.email || null,
        tags: ['demo-seed', ...(s.leadCaptured ? ['inbound-lead'] : [])],
        custom_fields: { demo_seed: true },
      })
      .select('id')
      .single();
    if (contactErr) throw new Error(`contact ${s.first}: ${contactErr.message}`);

    const retellCallId = `${SEED_PREFIX}${String(index).padStart(3, '0')}_${startedAt.getTime()}`;

    const { data: call, error: callErr } = await sb
      .from('calls')
      .insert({
        client_id: clientId,
        contact_id: contact.id,
        retell_call_id: retellCallId,
        direction: 'inbound',
        from_number: s.phone,
        to_number: '+19047605971',
        status: s.callStatus,
        duration_seconds: s.durationSeconds,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
      })
      .select('id')
      .single();
    if (callErr) throw new Error(`call ${s.first}: ${callErr.message}`);

    // Parallel analysis row. The calls report reads client_call_log, which is
    // driven from call_records — without this the call does not appear at all.
    const { error: recErr } = await sb.from('call_records').insert({
      client_id: clientId,
      retell_call_id: retellCallId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: s.durationSeconds,
      ...deriveRecord(s),
    });
    if (recErr) throw new Error(`call_record ${s.first}: ${recErr.message}`);

    const flat = s.turns.map((t) => t.content).join(' ');
    await sb.from('call_transcripts').upsert(
      { call_id: call.id, client_id: clientId, transcript: s.turns, word_count: flat.split(/\s+/).filter(Boolean).length },
      { onConflict: 'call_id' }
    );
    await sb.from('call_summaries').upsert(
      {
        call_id: call.id, client_id: clientId, summary: s.summary,
        action_items: s.actionItems, key_topics: s.keyTopics,
        sentiment: s.sentiment, follow_up_required: s.followUp,
      },
      { onConflict: 'call_id' }
    );
    await sb.from('conversations').upsert(
      {
        call_id: call.id, client_id: clientId, sentiment: s.sentiment, summary: s.summary,
        lead_captured: s.leadCaptured, booking_requested: s.bookingRequested,
        handoff_requested: s.handoffRequested,
        metadata: { demo_seed: true },
      },
      { onConflict: 'call_id' }
    );
    calls += 1;

    if (s.appointment) {
      const a = s.appointment;
      const start = new Date(now + a.startDaysFromNow * DAY);
      start.setHours(a.hour, a.minute, 0, 0);
      const end = new Date(start.getTime() + a.durationMinutes * 60_000);
      const { error: apptErr } = await sb.from('appointments').insert({
        client_id: clientId,
        contact_id: contact.id,
        call_id: call.id,
        title: a.title,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        timezone: 'America/New_York',
        status: a.status,
        service_type: a.serviceType,
        metadata: { demo_seed: true },
      });
      if (apptErr) throw new Error(`appointment ${s.first}: ${apptErr.message}`);
      appts += 1;
    }
  }

  // ── action items ─────────────────────────────────────────────────────────
  const { error: aiErr } = await sb.from('client_action_items').insert(
    ACTION_ITEMS.map((i) => ({
      client_id: clientId,
      title: i.title,
      description: `${i.description} [demo]`,
      status: i.status,
    }))
  );
  if (aiErr) throw new Error(`action items: ${aiErr.message}`);

  // ── tickets ──────────────────────────────────────────────────────────────
  const { error: tErr } = await sb.from('tickets').insert(
    TICKETS.map((t) => ({
      client_id: clientId,
      subject: t.subject,
      description: `${t.description} [demo]`,
      priority: t.priority,
      status: t.status,
    }))
  );
  if (tErr) throw new Error(`tickets: ${tErr.message}`);

  console.log(
    `${client.name}: seeded ${calls} calls (with transcripts, summaries, conversations), ` +
      `${calls} contacts, ${appts} appointments, ${ACTION_ITEMS.length} action items, ${TICKETS.length} tickets.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
