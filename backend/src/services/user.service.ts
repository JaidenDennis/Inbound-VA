import bcrypt from 'bcryptjs';
import { supabase } from '../db/index.js';
import { logger } from '../utils/index.js';
import type { User, UserRole } from '../types/index.js';

// Columns safe to return to clients — never expose password_hash.
const PUBLIC_COLUMNS = 'id,email,name,role,client_id,is_active,last_login_at,created_at,updated_at';

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  client_id: string | null;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}

export class UserService {
  async list(clientId: string | null, page = 1, limit = 50): Promise<{ data: User[]; count: number }> {
    const from = (page - 1) * limit;
    let query = supabase
      .from('users')
      .select(PUBLIC_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (clientId) query = query.eq('client_id', clientId);
    const { data, count } = await query;
    return { data: (data ?? []) as User[], count: count ?? 0 };
  }

  async findById(id: string): Promise<User | null> {
    const { data } = await supabase.from('users').select(PUBLIC_COLUMNS).eq('id', id).maybeSingle();
    return data as User | null;
  }

  /**
   * Look up by email for the duplicate check on update.
   *
   * Lower-cased because create() stores addresses lower-cased; comparing raw
   * input against stored values would miss "Sam@x.com" vs "sam@x.com" and let
   * the insert fail at the constraint instead of at the check.
   */
  async findByEmail(email: string): Promise<User | null> {
    const { data } = await supabase
      .from('users')
      .select(PUBLIC_COLUMNS)
      .eq('email', email.toLowerCase())
      .maybeSingle();
    return data as User | null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const password_hash = await bcrypt.hash(input.password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: input.email.toLowerCase(),
        name: input.name,
        password_hash,
        role: input.role,
        client_id: input.client_id,
        is_active: true,
      })
      .select(PUBLIC_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('A user with that email already exists');
      throw new Error(error.message);
    }
    logger.info({ userId: data.id, role: data.role, clientId: data.client_id }, 'User created');
    return data as User;
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email.toLowerCase();
    if (input.role !== undefined) patch.role = input.role;
    if (input.is_active !== undefined) patch.is_active = input.is_active;
    if (input.password) patch.password_hash = await bcrypt.hash(input.password, 10);

    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('id', id)
      .select(PUBLIC_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('A user with that email already exists');
      throw new Error(error.message);
    }
    return data as User;
  }
}

export const userService = new UserService();
