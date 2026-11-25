import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { friendlyDbError } from "../lib/supabaseErrors";
import { useAuth } from "./AuthContext";

export type ClassTeacherStatus = "idle" | "loading" | "ready" | "error";

export interface ClassTeacherSection {
  id: string;
  name: string;
}

interface ClassTeacherContextValue {
  status: ClassTeacherStatus;
  sections: ClassTeacherSection[];
  /** True only after a successful query found at least one current assignment. */
  isClassTeacher: boolean;
  error: string | null;
  retry: () => void;
}

const ClassTeacherContext = createContext<ClassTeacherContextValue | undefined>(undefined);

const first = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

interface Loaded {
  /** Teacher id this result belongs to. Used to discard stale data. */
  forTeacherId: string;
  /** Bumped by retry() so the effect re-runs for the same teacher. */
  attempt: number;
  status: "ready" | "error";
  sections: ClassTeacherSection[];
  error: string | null;
}

// One shared "is this teacher a current Class Teacher?" lookup for the
// whole signed-in session. Mounted once in App (inside AuthProvider,
// outside every per-route ProtectedRoute/AppShell) so it is NOT torn down
// and re-created on navigation — each route renders its own AppShell, so
// anything mounted there would refetch on every page change.
//
// Same condition the Class Teacher pages always used:
//   class_teacher_assignments.teacher_id = current profile.id
//   AND is_current = true
//
// This is a UX/navigation layer only. The database (RLS on
// class_teacher_assignments, and the SECURITY DEFINER RPCs) remains the
// real authorization boundary.
export function ClassTeacherProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  // Only teachers are ever looked up; students / super admins stay idle.
  const teacherId = profile?.role === "teacher" ? profile.id : null;

  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!teacherId) {
      // Signed out (or not a teacher): drop the last result so the same
      // teacher signing back in within this tab can't briefly be shown the
      // previous session's answer while the new lookup is in flight.
      setLoaded(null);
      return;
    }
    let cancelled = false;

    async function load(id: string) {
      if (!supabase) {
        if (!cancelled) {
          setLoaded({
            forTeacherId: id,
            attempt,
            status: "error",
            sections: [],
            error: "Supabase is not configured, so Class Teacher access can't be verified.",
          });
        }
        return;
      }
      const { data, error: err } = await supabase
        .from("class_teacher_assignments")
        .select("section_id, sections(name)")
        .eq("teacher_id", id)
        .eq("is_current", true);
      if (cancelled) return;
      if (err) {
        setLoaded({
          forTeacherId: id,
          attempt,
          status: "error",
          sections: [],
          error: friendlyDbError(err, "Your class-teacher sections"),
        });
        return;
      }
      setLoaded({
        forTeacherId: id,
        attempt,
        status: "ready",
        sections: (data ?? []).map((r: any) => ({
          id: r.section_id as string,
          name: first<{ name: string }>(r.sections)?.name ?? "—",
        })),
        error: null,
      });
    }

    load(teacherId);
    return () => {
      cancelled = true;
    };
  }, [teacherId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<ClassTeacherContextValue>(() => {
    // Derived during render (not in an effect) so a stale result for a
    // previous user, or a result from before a retry, can never be read
    // for even one frame: anything not matching the current teacher AND
    // the current attempt counts as "loading".
    if (!teacherId) {
      return { status: "idle", sections: [], isClassTeacher: false, error: null, retry };
    }
    if (!loaded || loaded.forTeacherId !== teacherId || loaded.attempt !== attempt) {
      return { status: "loading", sections: [], isClassTeacher: false, error: null, retry };
    }
    if (loaded.status === "error") {
      return { status: "error", sections: [], isClassTeacher: false, error: loaded.error, retry };
    }
    return {
      status: "ready",
      sections: loaded.sections,
      isClassTeacher: loaded.sections.length > 0,
      error: null,
      retry,
    };
  }, [teacherId, attempt, loaded, retry]);

  return <ClassTeacherContext.Provider value={value}>{children}</ClassTeacherContext.Provider>;
}

export function useClassTeacher(): ClassTeacherContextValue {
  const ctx = useContext(ClassTeacherContext);
  if (!ctx) throw new Error("useClassTeacher must be used within a ClassTeacherProvider");
  return ctx;
}
