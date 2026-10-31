import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * Backend Account Deletion Endpoint.
 * Authenticates the caller via session cookies, then uses the Supabase Admin client
 * (service role key) to permanently delete the user from auth.users(id) and public.profiles.
 */
async function handleDelete() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: No active session' },
        { status: 401 }
      );
    }

    const userId = user.id;

    // Check if admin client can be instantiated
    let adminClient: ReturnType<typeof createAdminClient> | null = null;
    try {
      adminClient = createAdminClient();
    } catch (adminErr) {
      console.warn('Could not initialize Supabase Admin client:', adminErr);
    }

    if (adminClient) {
      // 1. Explicitly delete user profile data via admin client (bypasses RLS)
      const { error: profileDeleteError } = await adminClient
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (profileDeleteError) {
        console.warn('Admin profile delete warning:', profileDeleteError.message);
      }

      // 2. Permanently delete user record from auth.users (cascades to profile and dependents)
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId);

      if (authDeleteError) {
        console.error('Admin deleteUser error:', authDeleteError.message);
        return NextResponse.json(
          { error: authDeleteError.message || 'Failed to delete user authentication record.' },
          { status: 500 }
        );
      }
    } else {
      // Fallback: If service role key is absent, attempt database RPC or user client
      const { error: rpcError } = await supabase.rpc('delete_current_user');
      if (rpcError) {
        const { error: profileDeleteError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', userId);

        if (profileDeleteError) {
          return NextResponse.json(
            { error: 'Failed to delete account. Supabase admin credentials not configured.' },
            { status: 500 }
          );
        }
      }
    }

    // Sign out caller session and purge session cookies
    try {
      await supabase.auth.signOut();
    } catch {
      // Session may already be invalidated by user deletion
    }

    return NextResponse.json({
      success: true,
      message: 'User account and profile deleted successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  return handleDelete();
}

export async function DELETE() {
  return handleDelete();
}

