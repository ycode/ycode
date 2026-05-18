import { NextResponse } from 'next/server';
import { getSiteUser } from '@/lib/supabase-auth';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { USERS_COLLECTION_ID } from '@/lib/auth-constants';
import { getAuthTranslation } from '@/lib/services/authLocalisationService';
import { noCache } from '@/lib/api-response';

/**
 * GET /api/auth/me
 * 
 * Returns current authenticated site user session and CMS profile data.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') || 'en';

  try {
    const labels = {
      login: await getAuthTranslation('label_login', 'Log in', locale),
      logout: await getAuthTranslation('label_logout', 'Log out', locale),
      profile: await getAuthTranslation('label_my_profile', 'My Profile', locale),
    };

    const auth = await getSiteUser();
    if (!auth || !auth.user) {
      return noCache({ user: null, labels });
    }

    const { user } = auth;
    
    // Fetch CMS profile data
    const adminClient = await getSupabaseAdmin();
    if (!adminClient) return noCache({ user });

    // Find the 'supabase_user_id' field ID
    const { data: fieldData } = await adminClient
      .from('collection_fields')
      .select('id')
      .eq('collection_id', USERS_COLLECTION_ID)
      .eq('key', 'supabase_user_id')
      .eq('is_published', true)
      .single();

    if (fieldData) {
      // Get the item ID for this user
      const { data: itemValue } = await adminClient
        .from('collection_item_values')
        .select('item_id')
        .eq('field_id', fieldData.id)
        .eq('value', user.id)
        .eq('is_published', true)
        .single();

      if (itemValue) {
        // Get all fields and values for this item
        const { data: profileValues } = await adminClient
          .from('collection_item_values')
          .select(`
            value,
            collection_fields!inner(id, name, key, type)
          `)
          .eq('item_id', itemValue.item_id)
          .eq('is_published', true);

        if (profileValues) {
          const cmsData: Record<string, any> = {};
          profileValues.forEach((pv: any) => {
            const key = pv.collection_fields.key || pv.collection_fields.id;
            cmsData[key] = pv.value;
          });

          return noCache({
            user: {
              ...user,
              cms_profile: cmsData,
              item_id: itemValue.item_id
            },
            labels
          });
        }
      }
    }

    return noCache({ user, labels });

  } catch (error) {
    console.error('Error fetching user session:', error);
    return noCache({ error: 'Internal server error' }, 500);
  }
}
