import { getSupabaseAdmin } from '@/lib/supabase-server';
import { USERS_COLLECTION_ID, AUTH_ROLES } from '../auth-constants';
import { createItem } from '../repositories/collectionItemRepository';
import { setValues } from '../repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '../repositories/collectionFieldRepository';
import type { User } from '@supabase/supabase-js';

/**
 * User Sync Service
 *
 * Synchronizes Supabase Auth users with the CMS "Users" collection.
 * This allows user data to be managed within the Ycode CMS and linked to
 * dynamic registration/profile forms.
 */

/**
 * Sync a Supabase user to the CMS "Users" collection.
 * Creates a new item if it doesn't exist, otherwise updates existing.
 *
 * @param user - Supabase User object
 * @param customData - Optional additional data from registration forms
 */
export async function syncUserToCms(user: User, customData: Record<string, string> = {}): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');

  // 1. Check if user already has a CMS item
  const existingItem = await findUserCmsItem(user.id);

  // 2. Fetch all fields for the Users collection
  const fields = await getFieldsByCollectionId(USERS_COLLECTION_ID, false);
  
  // Create a map of keys to field IDs
  const fieldMap = new Map<string, string>();
  fields.forEach(f => {
    if (f.key) fieldMap.set(f.key, f.id);
  });

  const emailFieldId = fieldMap.get('email');
  const nameFieldId = fieldMap.get('name');
  const supabaseIdFieldId = fieldMap.get('supabase_user_id');
  const roleFieldId = fieldMap.get('role');
  const avatarFieldId = fieldMap.get('avatar');

  const values: Record<string, string> = { ...customData };
  
  if (emailFieldId && user.email) values[emailFieldId] = user.email;
  if (nameFieldId && user.user_metadata?.full_name) values[nameFieldId] = user.user_metadata.full_name;
  if (supabaseIdFieldId) values[supabaseIdFieldId] = user.id;
  if (roleFieldId) values[roleFieldId] = user.app_metadata?.role || AUTH_ROLES.USER;
  if (avatarFieldId && (user.user_metadata?.avatar_url || user.user_metadata?.avatar)) {
    values[avatarFieldId] = user.user_metadata.avatar_url || user.user_metadata.avatar;
  }

  if (existingItem) {
    // Update existing item values
    await setValues(existingItem.id, values, false);
    await setValues(existingItem.id, values, true);
  } else {
    // Create new item in Users collection
    const newItem = await createItem({
      collection_id: USERS_COLLECTION_ID,
      is_published: false,
    });

    const id = newItem.id;

    // Create item values for draft
    await setValues(id, values, false);
    
    // Create published version immediately
    await createItem({
      id: id,
      collection_id: USERS_COLLECTION_ID,
      is_published: true,
    });
    
    // Create item values for published
    await setValues(id, values, true);
  }
}

/**
 * Find a CMS item ID for a given Supabase User ID.
 */
async function findUserCmsItem(supabaseUserId: string): Promise<{ id: string } | null> {
  const client = await getSupabaseAdmin();
  if (!client) return null;

  // Find the 'supabase_user_id' field ID
  const fields = await getFieldsByCollectionId(USERS_COLLECTION_ID, false);
  const supabaseIdField = fields.find(f => f.key === 'supabase_user_id');

  if (!supabaseIdField) return null;

  // Query collection_item_values for this specific user ID
  const { data, error } = await client
    .from('collection_item_values')
    .select('item_id')
    .eq('field_id', supabaseIdField.id)
    .eq('value', supabaseUserId)
    .eq('is_published', false)
    .is('deleted_at', null)
    .single();

  if (error || !data) return null;

  return { id: data.item_id };
}
