import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * Backend Account Deletion Endpoint.
 * Strictly uses SUPABASE_SERVICE_ROLE_KEY on the server only.
 * Deleting the user from auth.users cascades to public.profiles and dependent rows.
 */
async function handleDelete() {
  try {
    // 1. Authenticate the caller using cookies
    const supabase = await createSupabaseServerClient();
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

    // 2. Perform account deletion via Admin client
    const adminClient = createSupabaseAdminClient();
    // delete the auth.user which is connected to public.profiles

    // Explicitly delete from public.profiles first to guarantee cleanup
    // even if foreign key cascade has not yet been applied in the remote database
    const { error: profileDeleteError } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', user.id);

    if (profileDeleteError) {
      console.warn('Could not explicitly delete from public.profiles:', profileDeleteError.message);
    }

    // Delete from auth.users (triggers DB cascade if constraint is active)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
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

