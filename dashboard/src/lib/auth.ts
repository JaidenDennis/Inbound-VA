'use server';

import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'secret');

export async function getServerSession() {
  const cookieStore = cookies();
  const token = cookieStore.get('gravvia_token')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { sub: string; email: string; role: string; clientId: string | null };
  } catch {
    return null;
  }
}
