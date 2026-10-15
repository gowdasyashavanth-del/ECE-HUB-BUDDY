import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ConfigNeededPage } from "./pages/ConfigNeededPage";
import { PortalSelectionPage } from "./pages/PortalSelectionPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { PortalLoginPage } from "./pages/PortalLoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PWAInstallCard } from "./components/pwa/PWAInstallCard";
import { PWAUpdateToast } from "./components/pwa/PWAUpdateToast";
import { LoadingState } from "./components/ui/LoadingState";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { lazyNamed } from "./lib/lazyNamed";

// Profile
const ProfilePage = lazyNamed(() => import("./pages/ProfilePage"), "ProfilePage");

// Student Pages
const StudentDashboard = lazyNamed(() => import("./pages/student/StudentDashboard"), "StudentDashboard");
const StudentTimetablePage = lazyNamed(() => import("./pages/student/StudentTimetablePage"), "StudentTimetablePage");
const StudentAttendancePage = lazyNamed(() => import("./pages/student/StudentAttendancePage"), "StudentAttendancePage");
const StudentIaPage = lazyNamed(() => import("./pages/student/StudentIaPage"), "StudentIaPage");
const SubjectDetailPage = lazyNamed(() => import("./pages/student/SubjectDetailPage"), "SubjectDetailPage");
const FormulaHubPage = lazyNamed(() => import("./pages/student/FormulaHubPage"), "FormulaHubPage");
const TestsListPage = lazyNamed(() => import("./pages/student/TestsListPage"), "TestsListPage");
const TakeTestPage = lazyNamed(() => import("./pages/student/TakeTestPage"), "TakeTestPage");
const AnnouncementsFeed = lazyNamed(() => import("./pages/student/AnnouncementsFeed"), "AnnouncementsFeed");
const ResultsHistoryPage = lazyNamed(() => import("./pages/student/ResultsHistoryPage"), "ResultsHistoryPage");
const NotesPage = lazyNamed(() => import("./pages/student/NotesPage"), "NotesPage");
const StudentPlannerPage = lazyNamed(() => import("./pages/student/StudentPlannerPage"), "StudentPlannerPage");
const StudentAnalyticsPage = lazyNamed(() => import("./pages/student/StudentAnalyticsPage"), "StudentAnalyticsPage");
const StudyModePage = lazyNamed(() => import("./pages/student/StudyModePage"), "StudyModePage");
const SmartStudyPage = lazyNamed(() => import("./pages/student/SmartStudyPage"), "SmartStudyPage");

// Teacher Pages
const TeacherDashboard = lazyNamed(() => import("./pages/teacher/TeacherDashboard"), "TeacherDashboard");
const TeacherSubjectWorkspacePage = lazyNamed(() => import("./pages/teacher/TeacherSubjectWorkspacePage"), "TeacherSubjectWorkspacePage");
const StudentPerformancePage = lazyNamed(() => import("./pages/teacher/StudentPerformancePage"), "StudentPerformancePage");
const MyStudentsPage = lazyNamed(() => import("./pages/teacher/MyStudentsPage"), "MyStudentsPage");
const TeacherTimetablePage = lazyNamed(() => import("./pages/teacher/TeacherTimetablePage"), "TeacherTimetablePage");
const TeacherAttendancePage = lazyNamed(() => import("./pages/teacher/TeacherAttendancePage"), "TeacherAttendancePage");
const TeacherIaPage = lazyNamed(() => import("./pages/teacher/TeacherIaPage"), "TeacherIaPage");
const TeacherCrPage = lazyNamed(() => import("./pages/teacher/TeacherCrPage"), "TeacherCrPage");
const TeacherLabBatchesPage = lazyNamed(() => import("./pages/teacher/TeacherLabBatchesPage"), "TeacherLabBatchesPage");
const TeacherPlannerPage = lazyNamed(() => import("./pages/teacher/TeacherPlannerPage"), "TeacherPlannerPage");
const TeacherAnalyticsPage = lazyNamed(() => import("./pages/teacher/TeacherAnalyticsPage"), "TeacherAnalyticsPage");

// Admin Pages
const AdminDashboard = lazyNamed(() => import("./pages/admin/AdminDashboard"), "AdminDashboard");
const AdminAnalyticsPage = lazyNamed(() => import("./pages/admin/AdminAnalyticsPage"), "AdminAnalyticsPage");
const AdminPlannerPage = lazyNamed(() => import("./pages/admin/AdminPlannerPage"), "AdminPlannerPage");
const AcademicStructurePage = lazyNamed(() => import("./pages/admin/AcademicStructurePage"), "AcademicStructurePage");
const AcademicEntityPage = lazyNamed(() => import("./pages/admin/academic/AcademicEntityPage"), "AcademicEntityPage");
const TeachersPage = lazyNamed(() => import("./pages/admin/TeachersPage"), "TeachersPage");
const TeacherAssignmentsPage = lazyNamed(() => import("./pages/admin/TeacherAssignmentsPage"), "TeacherAssignmentsPage");
const ClassTeachersPage = lazyNamed(() => import("./pages/admin/ClassTeachersPage"), "ClassTeachersPage");
const CrDesignationsPage = lazyNamed(() => import("./pages/admin/CrDesignationsPage"), "CrDesignationsPage");
const LabBatchesPage = lazyNamed(() => import("./pages/admin/LabBatchesPage"), "LabBatchesPage");
const AdminTimetablePage = lazyNamed(() => import("./pages/admin/AdminTimetablePage"), "AdminTimetablePage");
const AdminAttendancePage = lazyNamed(() => import("./pages/admin/AdminAttendancePage"), "AdminAttendancePage");
const AdminIaPage = lazyNamed(() => import("./pages/admin/AdminIaPage"), "AdminIaPage");
const AdminResultsPage = lazyNamed(() => import("./pages/admin/AdminResultsPage"), "AdminResultsPage");
const UserManagementPage = lazyNamed(() => import("./pages/admin/UserManagementPage"), "UserManagementPage");
const StudentsPage = lazyNamed(() => import("./pages/admin/StudentsPage"), "StudentsPage");
const StudentAssignmentsPage = lazyNamed(() => import("./pages/admin/StudentAssignmentsPage"), "StudentAssignmentsPage");

// Content & Learning Managers
const ContentManager = lazyNamed(() => import("./components/content/ContentManager"), "ContentManager");
const FormulaManager = lazyNamed(() => import("./components/content/FormulaManager"), "FormulaManager");
const QuestionManager = lazyNamed(() => import("./components/content/QuestionManager"), "QuestionManager");
const TestManager = lazyNamed(() => import("./components/content/TestManager"), "TestManager");
const ResultsViewer = lazyNamed(() => import("./components/content/ResultsViewer"), "ResultsViewer");
const NotesManager = lazyNamed(() => import("./components/content/NotesManager"), "NotesManager");
const AnnouncementManager = lazyNamed(() => import("./components/content/AnnouncementManager"), "AnnouncementManager");

export default function App() {
  if (!isSupabaseConfigured) {
    return <ConfigNeededPage />;
  }

  return (
    <AuthProvider>
      <PWAInstallCard />
      <PWAUpdateToast />
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center p-6">
              <LoadingState label="Loading page…" />
            </div>
          }
        >
          <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<PortalSelectionPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/student/login" element={<PortalLoginPage expectedRole="student" />} />
        <Route path="/teacher/login" element={<PortalLoginPage expectedRole="teacher" />} />
        <Route path="/admin/login" element={<PortalLoginPage expectedRole="super_admin" />} />

        <Route
          path="/student"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/profile"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/subjects/:subjectId"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <SubjectDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/formulas"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <FormulaHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/tests"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <TestsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/tests/:testId"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <TakeTestPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/announcements"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <AnnouncementsFeed />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/timetable"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentTimetablePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/attendance"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentAttendancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/results"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <ResultsHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/ia"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentIaPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/notes"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <NotesPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/planner"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentPlannerPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/analytics"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentAnalyticsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/study"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudyModePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/smart-study"
          element={
            <ProtectedRoute allowedRoles={["student"]}>
              <SmartStudyPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/assignments/:assignmentId"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherSubjectWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/content"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <ContentManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/notes"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <NotesManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/formulas"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <FormulaManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/questions"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <QuestionManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/tests"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TestManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/results"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <ResultsViewer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/students"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <StudentPerformancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/my-students"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <MyStudentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/timetable"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherTimetablePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/attendance"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherAttendancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/ia"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherIaPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/cr"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherCrPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/lab-batches"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherLabBatchesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/announcements"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <AnnouncementManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/profile"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/planner"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherPlannerPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/analytics"
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <TeacherAnalyticsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminAnalyticsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/planner"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminPlannerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/academic-structure"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AcademicStructurePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/academic/:entityKey"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AcademicEntityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/teachers"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <TeachersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/teacher-assignments"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <TeacherAssignmentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/class-teachers"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ClassTeachersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/cr-designations"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <CrDesignationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/lab-batches"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <LabBatchesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/timetable"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminTimetablePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/attendance"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminAttendancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/ia"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminIaPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/user-management"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <UserManagementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/students"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <StudentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/student-assignments"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <StudentAssignmentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/content"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ContentManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/notes"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <NotesManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/formulas"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <FormulaManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/questions"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <QuestionManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tests"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <TestManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/results"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AdminResultsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/announcements"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <AnnouncementManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/profile"
          element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  );
}
