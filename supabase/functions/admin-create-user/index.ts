// ECE Hub Buddy — Edge Function: admin-create-user
//
// The ONLY place in this project that touches the Supabase service-role
// key. It exists because creating a real `auth.users` row requires the
// Auth Admin API, which the browser must never be trusted with.
//
// Everything else this function does (reading/writing `public.users`,
// inserting `student_assignments` / `teacher_assignments`) is done with
// the CALLING ADMIN'S OWN JWT, not the service role — so it goes through
// the exact same RLS policies and triggers as if the admin had done it
// from the existing admin pages. No second permission system, no new
// RPC, no new trusted flag: `protect_sensitive_user_columns()` already
// only restricts non-admin callers, so an admin's own profile/role
// update and assignment insert were never blocked.
//
// Deployed with verify_jwt = true: the Supabase gateway itself rejects
// any request with no valid JWT before this code even runs. This
// function then independently re-checks that the JWT belongs to a
// super_admin — the gateway check proves "some signed-in user", not
// "an authorized one".

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USN_RE = /^[A-Z0-9]{6,15}$/;
const EMPLOYEE_ID_RE = /^[A-Z0-9]{4,20}$/;

interface RequestBody {
  role: "student" | "teacher";
  full_name: string;
  email: string;
  phone?: string | null;
  temp_password: string;
  usn?: string | null;
  employee_id?: string | null;
  academic_year_id: string;
  regulation_id: string;
  program_id: string;
  semester_id: string;
  section_id: string;
  subject_id?: string | null; // teacher only
}

function friendlyPgError(error: { code?: string; message?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "23505") return "That value (email, USN, or employee ID) is already in use.";
  if (error.code === "23503") return "One of the selected academic values no longer exists. Reload and try again.";
  if (error.code === "23514") return "One of the values entered isn't in an allowed format.";
  return error.message || "Something went wrong.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "Server is not configured correctly." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

  // Acts AS the calling admin — RLS + triggers apply exactly as if this
  // were the admin's own browser session. Never used to read/write
  // outside what the admin's own RLS already allows.
  const asAdmin = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asAdmin.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in." }, 401);
  const callerId = userData.user.id;

  const { data: callerProfile, error: callerErr } = await asAdmin
    .from("users")
    .select("role")
    .eq("id", callerId)
    .maybeSingle();
  if (callerErr || !callerProfile || callerProfile.role !== "super_admin") {
    return json({ error: "Only a super admin can create users." }, 403);
  }

  let body: Partial<RequestBody>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const role = body.role;
  const full_name = (body.full_name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const phone = body.phone?.trim() || null;
  const temp_password = body.temp_password ?? "";
  const usn = body.usn?.trim().toUpperCase() || null;
  const employee_id = body.employee_id?.trim().toUpperCase() || null;
  const { academic_year_id, regulation_id, program_id, semester_id, section_id, subject_id } = body;

  if (role !== "student" && role !== "teacher") {
    return json({ error: "Role must be student or teacher." }, 400);
  }
  if (!full_name) return json({ error: "Full name is required." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (temp_password.length < 8) return json({ error: "Temporary password must be at least 8 characters." }, 400);
  for (const [label, v] of [
    ["Academic year", academic_year_id],
    ["Regulation", regulation_id],
    ["Program", program_id],
    ["Semester", semester_id],
    ["Section", section_id],
  ] as const) {
    if (!v || !UUID_RE.test(v)) return json({ error: `${label} selection is required.` }, 400);
  }
  if (role === "teacher" && (!subject_id || !UUID_RE.test(subject_id))) {
    return json({ error: "Subject selection is required for a teacher." }, 400);
  }
  if (role === "student" && usn && !USN_RE.test(usn)) {
    return json({ error: "USN must be 6-15 uppercase letters/numbers." }, 400);
  }
  if (role === "teacher" && employee_id && !EMPLOYEE_ID_RE.test(employee_id)) {
    return json({ error: "Employee ID must be 4-20 uppercase letters/numbers." }, 400);
  }

  // Proactive duplicate checks (readable, immediate feedback). The
  // database's own unique constraints are still the real, race-safe
  // guard applied below when the profile is actually written.
  const { data: existingEmail } = await asAdmin.from("users").select("id").eq("email", email).maybeSingle();
  if (existingEmail) return json({ error: "An account with this email already exists." }, 409);
  if (usn) {
    const { data: existingUsn } = await asAdmin.from("users").select("id").eq("usn", usn).maybeSingle();
    if (existingUsn) return json({ error: "A student with this USN already exists." }, 409);
  }
  if (employee_id) {
    const { data: existingEmp } = await asAdmin.from("users").select("id").eq("employee_id", employee_id).maybeSingle();
    if (existingEmp) return json({ error: "A teacher with this employee ID already exists." }, 409);
  }

  // Only place the service-role key is used — creating the real Auth
  // account. `handle_new_user` (migration 02) synchronously inserts the
  // matching public.users row with role='student' as its safe default.
  const asService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: created, error: createErr } = await asService.auth.admin.createUser({
    email,
    password: temp_password,
    email_confirm: true,
    user_metadata: { full_name, phone },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message?.toLowerCase().includes("already")
      ? "An account with this email already exists."
      : createErr?.message || "Could not create the account.";
    return json({ error: msg }, 400);
  }
  const newUserId = created.user.id;

  async function rollback() {
    try {
      await asService.auth.admin.deleteUser(newUserId);
    } catch {
      // best-effort: if this also fails, the account is left orphaned
      // with no application profile/assignment — recoverable by an
      // admin deleting it manually from Supabase Auth.
    }
  }

  // Profile finalization — through the ADMIN'S OWN client, so this is
  // the same is_admin()-gated update path the existing admin UI already
  // uses (StudentsPage/TeachersPage), not a new privileged path.
  const profileUpdate: Record<string, unknown> = { role, full_name, phone };
  if (role === "student") profileUpdate.usn = usn;
  if (role === "teacher") profileUpdate.employee_id = employee_id;

  const { error: profileErr } = await asAdmin.from("users").update(profileUpdate).eq("id", newUserId);
  if (profileErr) {
    await rollback();
    return json({ error: friendlyPgError(profileErr) }, 400);
  }

  // Assignment — admin-only RLS on student_assignments/teacher_assignments
  // (migration 10) already permits this insert for is_admin() callers.
  const assignmentErr =
    role === "student"
      ? (
          await asAdmin.from("student_assignments").insert({
            student_id: newUserId,
            academic_year_id,
            regulation_id,
            program_id,
            semester_id,
            section_id,
            is_current: true,
          })
        ).error
      : (
          await asAdmin.from("teacher_assignments").insert({
            teacher_id: newUserId,
            section_id,
            subject_id,
          })
        ).error;

  if (assignmentErr) {
    await rollback();
    return json({ error: friendlyPgError(assignmentErr) }, 400);
  }

  return json({
    success: true,
    user: { id: newUserId, email, full_name, role },
  });
});
