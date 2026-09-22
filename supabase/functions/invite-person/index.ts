import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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
      .eq('id', userData.user.id)
      .maybeSingle();

    if (meError || !me || (me.role !== 'owner' && me.role !== 'cm')) {
      return json({ error: 'not_authorized' }, 403);
    }

    const body = (await req.json()) as InviteBody;
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

    const { error: personError } = await admin.from('people').insert({
      id: invited.user.id,
      company_id: me.company_id,
      role,
      trade,
      display_name: displayName,
      email,
      phone,
    });

    if (personError) {
      return json({ error: personError.message }, 400);
    }

    if (siteId) {
      const { error: assignError } = await admin.from('site_assignments').insert({
        site_id: siteId,
        person_id: invited.user.id,
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
