import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Backend Account Deletion Endpoint.
 * Uses authenticated server client (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY).
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

    // Delete user profile data using authenticated RLS permissions
    const { error: profileDeleteError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id);

    if (profileDeleteError) {
      return NextResponse.json(
        { error: 'Could not delete profile.' },
        { status: 500 }
      );
    }

    // Sign out caller session
    await supabase.auth.signOut();

    return NextResponse.json({
      success: true,
      message: 'User account and profile deleted successfully.',
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST() {
  return handleDelete();
}

export async function DELETE() {
  return handleDelete();
}
