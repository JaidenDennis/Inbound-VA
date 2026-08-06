import { redirect } from 'next/navigation';

/**
 * The performance page moved to /dashboard/reports. Kept as a redirect rather
 * than deleted: clients have this URL bookmarked and emailed to each other, and
 * a 404 would look like the reporting was taken away.
 */
export default function StatsPage() {
  redirect('/dashboard/reports');
}
