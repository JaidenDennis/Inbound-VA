'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AlertTriangle } from 'lucide-react';

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
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <AlertTriangle className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-gray-700">Failed Jobs ({failedJobs.length})</h2>
        </div>
        {failedJobs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No failed jobs</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Queue</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Error</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Attempts</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {failedJobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{job.queue_name}</td>
                  <td className="px-4 py-3 text-red-500 text-xs max-w-xs truncate">{job.error_message}</td>
                  <td className="px-4 py-3 text-gray-500">{job.attempts}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs">{job.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => retryJob(job)}
                      disabled={retrying === job.id}
                      className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                    >
                      {retrying === job.id ? 'Retrying...' : 'Retry'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
