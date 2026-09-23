import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type InviteBody = {
  email?: string;
  display_name?: string;
  role?: 'operative' | 'cm' | 'owner';
  trade?: string | null;
  site_id?: string | null;
  phone?: string | null;
  person_id?: string | null;
};

type Caller = {
  id: string;
  company_id: string;
  role: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'not_authorized' }, 401);
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: 'not_authorized' }, 401);
    }

    const { data: me, error: meError } = await admin
      .from('people')
      .select('id, company_id, role')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (meError || !me || (me.role !== 'owner' && me.role !== 'cm')) {
      return json({ error: 'not_authorized' }, 403);
    }

    const body = (await req.json()) as InviteBody;
    const personId = body.person_id?.trim() || '';
    if (personId) {
      return attachLogin(admin, me, personId, body.email);
    }

    // New person invite.
    const email = body.email?.trim().toLowerCase();
    const displayName = body.display_name?.trim();
    const role = body.role ?? 'operative';
    const trade = body.trade?.trim() || null;
    const siteId = body.site_id || null;
    const phone = body.phone?.trim() || null;

    if (!email || !displayName) {
      return json({ error: 'email_and_name_required' }, 400);
    }
    if (!['operative', 'cm', 'owner'].includes(role)) {
      return json({ error: 'invalid_role' }, 400);
    }
    if (me.role === 'cm' && role !== 'operative') {
      return json({ error: 'not_authorized' }, 403);
    }

    if (siteId) {
      const { data: site } = await admin
        .from('sites')
        .select('id, company_id')
        .eq('id', siteId)
        .maybeSingle();
      if (!site || site.company_id !== me.company_id) {
        return json({ error: 'site_not_found' }, 404);
      }
      if (me.role === 'cm') {
        const { data: assignment } = await admin
          .from('site_assignments')
          .select('id')
          .eq('site_id', siteId)
          .eq('person_id', me.id)
          .maybeSingle();
        if (!assignment) {
          return json({ error: 'not_authorized' }, 403);
        }
      }
    }

    const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') ?? 'http://127.0.0.1:8081/set-password';
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { display_name: displayName },
    });

    if (inviteError || !invited.user) {
      return json({ error: inviteError?.message ?? 'invite_failed' }, 400);
    }

    const { data: created, error: personError } = await admin
      .from('people')
      .insert({
        auth_user_id: invited.user.id,
        company_id: me.company_id,
        role,
        trade,
        display_name: displayName,
        email,
        phone,
      })
      .select('id')
      .single();

    if (personError || !created) {
      return json({ error: personError?.message ?? 'invite_failed' }, 400);
    }

    if (siteId) {
      const { error: assignError } = await admin.from('site_assignments').insert({
        site_id: siteId,
        person_id: created.id,
      });
      if (assignError) {
        return json({ error: assignError.message }, 400);
      }
    }

    return json({ ok: true, user_id: invited.user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invite_failed';
    return json({ error: message }, 500);
  }
});

async function attachLogin(admin: SupabaseClient, me: Caller, personId: string, rawEmail: string | undefined) {
  const email = rawEmail?.trim().toLowerCase() ?? '';
  if (!email) return json({ error: 'email_required' }, 400);

  const { data: existing, error: existingError } = await admin
    .from('people')
    .select('id, company_id, role, auth_user_id, display_name')
    .eq('id', personId)
    .maybeSingle();

  if (existingError || !existing || existing.company_id !== me.company_id || existing.role !== 'operative') {
    return json({ error: 'not_authorized' }, 403);
  }
  if (existing.auth_user_id) {
    return json({ error: 'already_has_login' }, 400);
  }

  const { data: companyEmails, error: emailError } = await admin
    .from('people')
    .select('id, email')
    .eq('company_id', me.company_id);
  if (emailError) return json({ error: 'invite_failed' }, 400);

  const taken = (companyEmails ?? []).some(
    (row) => row.id !== existing.id && typeof row.email === 'string' && row.email.trim().toLowerCase() === email
  );
  if (taken) return json({ error: 'email_in_use' }, 400);

  if (me.role === 'cm') {
    const { data: theirs } = await admin.from('site_assignments').select('site_id').eq('person_id', existing.id);
    const { data: mine } = await admin.from('site_assignments').select('site_id').eq('person_id', me.id);
    const mineIds = new Set((mine ?? []).map((row) => row.site_id));
    const shared = (theirs ?? []).some((row) => mineIds.has(row.site_id));
    if (!shared) return json({ error: 'not_authorized' }, 403);
  }

  const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') ?? 'http://127.0.0.1:8081/set-password';
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { display_name: existing.display_name ?? '' },
  });
  if (inviteError || !invited.user) {
    return json({ error: inviteError?.message ?? 'invite_failed' }, 400);
  }

  const { data: updated, error: updateError } = await admin
    .from('people')
    .update({ auth_user_id: invited.user.id, email })
    .eq('id', existing.id)
    .is('auth_user_id', null)
    .select('id')
    .maybeSingle();

  if (updateError || !updated) {
    return json({ error: updateError ? 'invite_failed' : 'already_has_login' }, 400);
  }

  return json({ ok: true, user_id: invited.user.id });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
