'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AlertTriangle } from 'lucide-react';
import { jobStatusTerm, JOB_STATUS } from '@/lib/vocabulary';
import { HintedHeading } from '@/components/Hint';
import { PageHeader } from '@/components/PageHeader';
import { StatusLamp } from '@/components/StatusLamp';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';

interface FailedJob {
  id: string;
  queue_name: string;
  job_id: string;
  error_message: string;
  attempts: number;
  status: string;
  created_at: string;
}

export default function SettingsPage() {
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    api.get('/admin/failed-jobs').then((r) => setFailedJobs(r.data));
  }, []);

  const retryJob = async (job: FailedJob) => {
    setRetrying(job.id);
    try {
      await api.post('/admin/retry-job', { jobId: job.job_id, queueName: job.queue_name });
      setFailedJobs((prev) => prev.filter((j) => j.id !== job.id));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Jobs that exhausted their retries and are waiting on a human decision."
      />

      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-lamp-fair-ink" aria-hidden />
        <h2 className="font-heading text-sm font-semibold text-ink-900">
          Failed jobs
        </h2>
        <span
          data-numeric
          className="rounded-full border border-panel-200 bg-panel-100 px-2 py-0.5 text-2xs font-semibold text-panel-700"
        >
          {failedJobs.length}
        </span>
      </div>

      {failedJobs.length === 0 ? (
        <TableEmpty
          icon={<StatusLamp level="good" size="lg" label="Good" />}
          title="No failed jobs"
          body="Every queued job has completed or is still retrying."
        />
      ) : (
        <TableShell>
          <Table caption={`${failedJobs.length} failed jobs`}>
            <THead>
              <TH>Queue</TH>
              <TH>Error</TH>
              <TH>Attempts</TH>
              <TH>
                <HintedHeading term="Awaiting review" hint={JOB_STATUS.pending.hint ?? ''}>
                  Status
                </HintedHeading>
              </TH>
              <TH align="right" srOnly>Actions</TH>
            </THead>
            <TBody>
              {failedJobs.map((job) => (
                <TR key={job.id}>
                  <TD mono>{job.queue_name}</TD>
                  <TD className="max-w-xs truncate text-xs text-lamp-bad-ink" >
                    {job.error_message}
                  </TD>
                  <TD numeric className="text-panel-600">{job.attempts}</TD>
                  <TD>
                    <span className="whitespace-nowrap rounded-full border border-lamp-fair-rim bg-lamp-fair-wash px-2.5 py-1 text-xs font-medium text-lamp-fair-ink">
                      {jobStatusTerm(job.status).label}
                    </span>
                  </TD>
                  <TD align="right">
                    <button
                      onClick={() => retryJob(job)}
                      disabled={retrying === job.id}
                      aria-label={`Retry ${job.queue_name} job`}
                      className="cursor-pointer whitespace-nowrap px-1.5 py-1 text-xs font-medium text-signal-700 underline decoration-signal-300 underline-offset-2 transition-colors hover:text-signal-800 hover:decoration-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {retrying === job.id ? 'Retrying…' : 'Retry'}
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
