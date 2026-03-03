import { getSupabaseAdmin } from '@/lib/supabase-server';
import { randomBytes } from 'crypto';

export interface McpToken {
  id: string;
  name: string;
  token_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpTokenWithPlainToken extends McpToken {
  token: string;
}

function generateToken(): string {
  return 'ymc_' + randomBytes(24).toString('hex');
}

export async function getAllTokens(): Promise<McpToken[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('mcp_tokens')
    .select('id, name, token_prefix, is_active, last_used_at, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch MCP tokens: ${error.message}`);
  }

  return data || [];
}

export async function createToken(name: string): Promise<McpTokenWithPlainToken> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const token = generateToken();
  const tokenPrefix = token.substring(0, 12);

  const { data, error } = await client
    .from('mcp_tokens')
    .insert({
      name,
      token,
      token_prefix: tokenPrefix,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id, name, token, token_prefix, is_active, last_used_at, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Failed to create MCP token: ${error.message}`);
  }

  return data;
}

/**
 * Validate a token and return the record if active.
 * Updates last_used_at in the background.
 */
export async function validateToken(token: string): Promise<McpToken | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('mcp_tokens')
    .select('id, name, token_prefix, is_active, last_used_at, created_at, updated_at')
    .eq('token', token)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  await client
    .from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return data;
}

export async function deleteToken(id: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { error } = await client
    .from('mcp_tokens')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete MCP token: ${error.message}`);
  }
}

export async function getTokenById(id: string): Promise<McpToken | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('mcp_tokens')
    .select('id, name, token_prefix, is_active, last_used_at, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch MCP token: ${error.message}`);
  }

  return data;
}
