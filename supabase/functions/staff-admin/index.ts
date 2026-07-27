import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Client-Info, Apikey',
};

type StaffRole = 'admin' | 'registration' | 'scanner';

interface StaffRow {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
}

const VALID_ROLES: StaffRole[] = ['admin', 'registration', 'scanner'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader =
      req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server misconfiguration' }, 500);
    }

    // Caller-scoped client to verify the JWT and read the caller's profile
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Invalid or expired session' }, 401);
    }

    const callerId = user.id;

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('staff_profiles')
      .select('id, name, role, active')
      .eq('id', callerId)
      .maybeSingle();

    if (profileErr || !callerProfile) {
      return json({ error: 'Staff profile not found' }, 403);
    }
    if (!callerProfile.active) {
      return json({ error: 'Your account is inactive' }, 403);
    }
    if (callerProfile.role !== 'admin') {
      return json({ error: 'Administrator access required' }, 403);
    }

    // Privileged client (service role) for auth.admin + staff_profiles writes
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/staff-admin/, '').replace(/^\/+/, '');
    const segments = path.split('/').filter(Boolean);
    const action = segments[0] ?? '';
    const targetId = segments[1] ?? null;

    const body = req.method !== 'GET' ? await req.json().catch(() => ({})) : {};

    // ─── CREATE / INVITE ───────────────────────────────────────────────
    if (action === 'create' && req.method === 'POST') {
      const name: string = (body.name ?? '').toString().trim();
      const email: string = (body.email ?? '').toString().trim().toLowerCase();
      const role: StaffRole = body.role;
      const password: string = body.password ?? null;

      if (!name || name.length > 200) {
        return json({ error: 'A valid name (1–200 characters) is required' }, 400);
      }
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: 'A valid email is required' }, 400);
      }
      if (!VALID_ROLES.includes(role)) {
        return json({ error: 'Invalid role' }, 400);
      }

      // Create the auth user (invite-style: no password by default)
      const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
        email,
        password: password || undefined,
        email_confirm: true,
        user_metadata: { name },
      });

      if (authErr) {
        return json({ error: authErr.message }, 400);
      }

      const newUserId = authUser.user.id;

      // Insert the matching staff_profiles row
      const { error: profileInsertErr } = await admin
        .from('staff_profiles')
        .insert({ id: newUserId, name, role, active: true });

      if (profileInsertErr) {
        // Partial-failure recovery: remove the orphaned auth user so a retry
        // does not collide with a duplicate-email error.
        await admin.auth.admin.deleteUser(newUserId);
        return json({ error: 'Failed to create staff profile' }, 500);
      }

      // Audit event
      await admin.from('audit_events').insert({
        actor_id: callerId,
        action: 'staff_created',
        target_type: 'staff',
        target_id: newUserId,
        details: {
          name,
          email,
          role,
          active: true,
        } as Record<string, unknown>,
      });

      return json({
        id: newUserId,
        name,
        email,
        role,
        active: true,
      });
    }

    // ─── UPDATE (name / role / active) ─────────────────────────────────
    if (action === 'update' && targetId && req.method === 'PUT') {
      if (targetId === callerId) {
        // Self-protection: block self-demotion and self-deactivation
        const newRole: StaffRole | undefined = body.role;
        const newActive: boolean | undefined = body.active;
        if (newRole !== undefined && newRole !== 'admin') {
          return json({ error: 'You cannot demote yourself' }, 400);
        }
        if (newActive === false) {
          return json({ error: 'You cannot deactivate yourself' }, 400);
        }
      }

      // Fetch current state
      const { data: current, error: fetchErr } = await admin
        .from('staff_profiles')
        .select('id, name, role, active')
        .eq('id', targetId)
        .maybeSingle();

      if (fetchErr || !current) {
        return json({ error: 'Staff member not found' }, 404);
      }

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const nm = (body.name as string).toString().trim();
        if (!nm || nm.length > 200) {
          return json({ error: 'A valid name is required' }, 400);
        }
        patch.name = nm;
      }
      if (body.role !== undefined) {
        if (!VALID_ROLES.includes(body.role)) {
          return json({ error: 'Invalid role' }, 400);
        }
        patch.role = body.role;
      }
      if (body.active !== undefined) {
        patch.active = Boolean(body.active);
      }

      if (Object.keys(patch).length === 0) {
        return json({ error: 'No fields to update' }, 400);
      }

      // Last-admin protection: if demoting or deactivating an admin, ensure
      // at least one other active admin remains afterwards.
      const isDemotingFromAdmin = current.role === 'admin' && patch.role !== undefined && patch.role !== 'admin';
      const isDeactivatingAdmin = current.role === 'admin' && patch.active === false;
      if (isDemotingFromAdmin || isDeactivatingAdmin) {
        const { count } = await admin
          .from('staff_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('active', true);
        if ((count ?? 0) <= 1) {
          return json(
            { error: 'Cannot demote or deactivate the last active administrator' },
            400,
          );
        }
      }

      const { error: updateErr } = await admin
        .from('staff_profiles')
        .update(patch)
        .eq('id', targetId);

      if (updateErr) {
        return json({ error: 'Failed to update staff member' }, 500);
      }

      // Build audit detail with old/new
      const oldRow = current as StaffRow;
      const details: Record<string, unknown> = {};
      if (patch.name !== undefined && patch.name !== oldRow.name) {
        details.name = { old: oldRow.name, new: patch.name };
      }
      if (patch.role !== undefined && patch.role !== oldRow.role) {
        details.role = { old: oldRow.role, new: patch.role };
      }
      if (patch.active !== undefined && patch.active !== oldRow.active) {
        details.active = { old: oldRow.active, new: patch.active };
      }

      let auditAction = 'staff_updated';
      if (patch.role !== undefined && patch.role !== oldRow.role) auditAction = 'staff_role_changed';
      else if (patch.active === true && oldRow.active === false) auditAction = 'staff_activated';
      else if (patch.active === false && oldRow.active === true) auditAction = 'staff_deactivated';

      await admin.from('audit_events').insert({
        actor_id: callerId,
        action: auditAction,
        target_type: 'staff',
        target_id: targetId,
        details: Object.keys(details).length ? details : { updated: true },
      });

      return json({ id: targetId, updated: patch });
    }

    // ─── PASSWORD RESET EMAIL ──────────────────────────────────────────
    if (action === 'reset' && targetId && req.method === 'POST') {
      // Fetch the user's email from auth.users via admin client
      const { data: u, error: uErr } = await admin
        .from('staff_profiles')
        .select('id, name')
        .eq('id', targetId)
        .maybeSingle();

      if (uErr || !u) {
        return json({ error: 'Staff member not found' }, 404);
      }

      // Look up email through auth admin API
      const { data: userRow, error: userLookupErr } = await admin.auth.admin.getUserById(targetId);
      if (userLookupErr || !userRow.user) {
        return json({ error: 'Auth user not found' }, 404);
      }

      const emailAddr = userRow.user.email;
      if (!emailAddr) {
        return json({ error: 'No email on file for this user' }, 400);
      }

      const { error: resetErr } = await admin.auth.admin.resetPasswordForEmail(emailAddr);
      if (resetErr) {
        return json({ error: resetErr.message }, 500);
      }

      await admin.from('audit_events').insert({
        actor_id: callerId,
        action: 'staff_password_reset_sent',
        target_type: 'staff',
        target_id: targetId,
        details: { email: emailAddr },
      });

      return json({ sent: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: (err as Error).message ?? 'Server error' }, 500);
  }
});
