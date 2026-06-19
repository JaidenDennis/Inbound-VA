'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { format } from 'date-fns';

interface Appointment {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  timezone: string;
  service_type: string | null;
}

export default function BookingsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState('');

  const fetchAppointments = (cid: string) => {
    if (!cid) return;
    setLoading(true);
    api.get(`/booking/availability?clientId=${cid}&date=${new Date().toISOString().split('T')[0]}`)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Load first available client
    api.get('/clients?limit=1').then((r) => {
      const first = r.data.data?.[0];
      if (first) setClientId(first.id);
    });
  }, []);

  useEffect(() => {
    if (clientId) fetchAppointments(clientId);
  }, [clientId]);

  const statusColor: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-600',
    rescheduled: 'bg-blue-100 text-blue-700',
  };

  if (loading) return <div className="text-gray-400 animate-pulse">Loading appointments...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Bookings</h1>
      {appointments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          No appointments found.
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{a.title}</p>
                <p className="text-sm text-gray-500">{format(new Date(a.start_time), 'PPp')} · {a.timezone}</p>
                {a.service_type && <p className="text-xs text-gray-400 mt-0.5">{a.service_type}</p>}
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[a.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
