import { Knex } from 'knex';

/**
 * Migration: Initialize Authentication System
 * 
 * 1. Assign 'admin' role to existing Supabase users.
 * 2. Create the system "Users" collection in CMS (if not exists).
 * 3. Seed initial auth settings in app_settings (upsert).
 * 4. Sync existing admins to the Users collection.
 */

const USERS_COLLECTION_ID = '550e8400-e29b-41d4-a716-446655440000';
const FIELD_EMAIL_ID = '550e8400-e29b-41d4-a716-446655440001';
const FIELD_NAME_ID = '550e8400-e29b-41d4-a716-446655440002';
const FIELD_SUPABASE_ID = '550e8400-e29b-41d4-a716-446655440003';
const FIELD_ROLE_ID = '550e8400-e29b-41d4-a716-446655440004';
const FIELD_AVATAR_ID = '550e8400-e29b-41d4-a716-446655440005';

export async function up(knex: Knex): Promise<void> {
  // 1. Assign 'admin' role to existing users in auth.users
  // Idempotent: Only for users that don't have a role yet.
  await knex.raw(`
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
    WHERE raw_app_meta_data->>'role' IS NULL
  `);

  // 2. Create the "Users" collection (Draft and Published)
  for (const isPublished of [false, true]) {
    // Check if collection exists
    const existing = await knex('collections')
      .where({ id: USERS_COLLECTION_ID, is_published: isPublished })
      .first();

    if (!existing) {
      await knex('collections').insert({
        id: USERS_COLLECTION_ID,
        name: 'Users',
        uuid: knex.raw('gen_random_uuid()'),
        is_published: isPublished,
        order: -1, // Always at the top
      });

      // Email Field
      await knex('collection_fields').insert({
        id: FIELD_EMAIL_ID,
        collection_id: USERS_COLLECTION_ID,
        name: 'Email',
        key: 'email',
        type: 'email',
        order: 0,
        fillable: false,
        is_published: isPublished,
      });

      // Name Field
      await knex('collection_fields').insert({
        id: FIELD_NAME_ID,
        collection_id: USERS_COLLECTION_ID,
        name: 'Name',
        key: 'name',
        type: 'text',
        order: 1,
        is_published: isPublished,
      });

      // Supabase User ID Field (Hidden)
      await knex('collection_fields').insert({
        id: FIELD_SUPABASE_ID,
        collection_id: USERS_COLLECTION_ID,
        name: 'Supabase User ID',
        key: 'supabase_user_id',
        type: 'text',
        order: 2,
        hidden: true,
        fillable: false,
        is_published: isPublished,
      });

      // Role Field (Hidden)
      await knex('collection_fields').insert({
        id: FIELD_ROLE_ID,
        collection_id: USERS_COLLECTION_ID,
        name: 'Role',
        key: 'role',
        type: 'text',
        order: 3,
        hidden: true,
        fillable: false,
        is_published: isPublished,
      });

      // Avatar Field
      await knex('collection_fields').insert({
        id: FIELD_AVATAR_ID,
        collection_id: USERS_COLLECTION_ID,
        name: 'Avatar',
        key: 'avatar',
        type: 'image',
        order: 4,
        is_published: isPublished,
      });
    }
  }

  // 3. Seed initial auth settings in app_settings (Idempotent upsert)
  const authConfigExists = await knex('app_settings')
    .where({ app_id: 'auth_system', key: 'config' })
    .first();

  if (!authConfigExists) {
    await knex('app_settings').insert({
      app_id: 'auth_system',
      key: 'config',
      value: JSON.stringify({
        enabled: false,
        login_page_id: null,
        register_page_id: null,
        users_collection_id: USERS_COLLECTION_ID,
      }),
    });
  }

  const providersExists = await knex('app_settings')
    .where({ app_id: 'auth_system', key: 'providers' })
    .first();

  if (!providersExists) {
    await knex('app_settings').insert({
      app_id: 'auth_system',
      key: 'providers',
      value: JSON.stringify({
        email: { enabled: true },
        google: { enabled: false, client_id: '', client_secret: '' },
        github: { enabled: false, client_id: '', client_secret: '' },
      }),
    });
  }

  // 4. Seed default translations for 'en'
  const enLocale = await knex('locales').where('code', 'en').first();
  if (enLocale) {
    const defaultTranslations = [
      { key: 'error_email_required', value: 'Email is required' },
      { key: 'error_password_required', value: 'Password is required' },
      { key: 'error_invalid_credentials', value: 'Invalid email or password' },
      { key: 'error_user_exists', value: 'A user with this email already exists' },
      { key: 'error_registration_failed', value: 'Registration failed. Please try again.' },
      { key: 'success_login', value: 'Logged in successfully' },
      { key: 'success_registration', value: 'Registration successful' },
      { key: 'label_login', value: 'Log in' },
      { key: 'label_logout', value: 'Log out' },
      { key: 'label_my_profile', value: 'My Profile' },
    ];

    for (const t of defaultTranslations) {
      for (const isPublished of [false, true]) {
        const transExists = await knex('translations')
          .where({
            locale_id: enLocale.id,
            source_type: 'auth',
            source_id: 'auth_system',
            content_key: t.key,
            is_published: isPublished,
          })
          .first();

        if (!transExists) {
          await knex('translations').insert({
            locale_id: enLocale.id,
            source_type: 'auth',
            source_id: 'auth_system',
            content_key: t.key,
            content_type: 'text',
            content_value: t.value,
            is_completed: true,
            is_published: isPublished,
          });
        }
      }
    }
  }

  // 5. Sync existing admins to the Users collection
  const admins = await knex.raw('SELECT id, email, raw_user_meta_data FROM auth.users');
  for (const admin of (admins.rows || [])) {
    // Generate the ID once for this user so draft and published share it
    const id = knex.raw('gen_random_uuid()');

    for (const isPublished of [false, true]) {
      // Check if item already exists for this version
      const existingItem = await knex('collection_item_values')
        .where({
          field_id: FIELD_SUPABASE_ID,
          value: admin.id,
          is_published: isPublished
        })
        .first();

      if (!existingItem) {
        // Create collection item
        const [newItem] = await knex('collection_items')
          .insert({
            id,
            collection_id: USERS_COLLECTION_ID,
            is_published: isPublished,
          })
          .returning('id');

        const savedId = typeof newItem === 'string' ? newItem : (newItem?.id || id);

        // Create values
        await knex('collection_item_values').insert([
          { item_id: savedId, field_id: FIELD_EMAIL_ID, value: admin.email, is_published: isPublished },
          { item_id: savedId, field_id: FIELD_NAME_ID, value: admin.raw_user_meta_data?.full_name || '', is_published: isPublished },
          { item_id: savedId, field_id: FIELD_SUPABASE_ID, value: admin.id, is_published: isPublished },
          { item_id: savedId, field_id: FIELD_ROLE_ID, value: 'admin', is_published: isPublished },
          { item_id: savedId, field_id: FIELD_AVATAR_ID, value: admin.raw_user_meta_data?.avatar_url || '', is_published: isPublished },
        ]);
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove settings
  await knex('app_settings').where('app_id', 'auth_system').delete();

  // Remove Users collection and fields
  await knex('collection_fields').where('collection_id', USERS_COLLECTION_ID).delete();
  await knex('collections').where('id', USERS_COLLECTION_ID).delete();
}
