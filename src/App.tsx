import { Navigate, Route, Routes } from "react-router-dom";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ConfigNeededPage } from "./pages/ConfigNeededPage";
import { PortalSelectionPage } from "./pages/PortalSelectionPage";
import { PortalLoginPage } from "./pages/PortalLoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { StudentDashboard } from "./pages/student/StudentDashboard";
import { StudentTimetablePage } from "./pages/student/StudentTimetablePage";
import { StudentAttendancePage } from "./pages/student/StudentAttendancePage";
import { StudentIaPage } from "./pages/student/StudentIaPage";
import { TeacherDashboard } from "./pages/teacher/TeacherDashboard";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AcademicStructurePage } from "./pages/admin/AcademicStructurePage";
import { AcademicEntityPage } from "./pages/admin/academic/AcademicEntityPage";
import { TeachersPage } from "./pages/admin/TeachersPage";
import { TeacherAssignmentsPage } from "./pages/admin/TeacherAssignmentsPage";
import { ClassTeachersPage } from "./pages/admin/ClassTeachersPage";
import { CrDesignationsPage } from "./pages/admin/CrDesignationsPage";
import { LabBatchesPage } from "./pages/admin/LabBatchesPage";
import { AdminTimetablePage } from "./pages/admin/AdminTimetablePage";
import { AdminAttendancePage } from "./pages/admin/AdminAttendancePage";
import { AdminIaPage } from "./pages/admin/AdminIaPage";
import { AdminResultsPage } from "./pages/admin/AdminResultsPage";
import { StudentsPage } from "./pages/admin/StudentsPage";
import { StudentAssignmentsPage } from "./pages/admin/StudentAssignmentsPage";
import { UserManagementPage } from "./pages/admin/UserManagementPage";
import { ContentManager } from "./components/content/ContentManager";
import { FormulaManager } from "./components/content/FormulaManager";
import { QuestionManager } from "./components/content/QuestionManager";
import { TestManager } from "./components/content/TestManager";
import { ResultsViewer } from "./components/content/ResultsViewer";
import { FormulaHubPage } from "./pages/student/FormulaHubPage";
import { SubjectDetailPage } from "./pages/student/SubjectDetailPage";
import { TestsListPage } from "./pages/student/TestsListPage";
import { TakeTestPage } from "./pages/student/TakeTestPage";
import { AnnouncementManager } from "./components/content/AnnouncementManager";
import { AnnouncementsFeed } from "./pages/student/AnnouncementsFeed";
import { ResultsHistoryPage } from "./pages/student/ResultsHistoryPage";
import { StudentPerformancePage } from "./pages/teacher/StudentPerformancePage";
import { MyStudentsPage } from "./pages/teacher/MyStudentsPage";
import { TeacherTimetablePage } from "./pages/teacher/TeacherTimetablePage";
import { TeacherAttendancePage } from "./pages/teacher/TeacherAttendancePage";
import { TeacherIaPage } from "./pages/teacher/TeacherIaPage";
import { TeacherCrPage } from "./pages/teacher/TeacherCrPage";
import { TeacherLabBatchesPage } from "./pages/teacher/TeacherLabBatchesPage";
import { TeacherSubjectWorkspacePage } from "./pages/teacher/TeacherSubjectWorkspacePage";
import { NotesManager } from "./components/content/NotesManager";
import { NotesPage } from "./pages/student/NotesPage";
import { StudentPlannerPage } from "./pages/student/StudentPlannerPage";
import { StudentAnalyticsPage } from "./pages/student/StudentAnalyticsPage";
import { StudyModePage } from "./pages/student/StudyModePage";
import { SmartStudyPage } from "./pages/student/SmartStudyPage";
import { TeacherAnalyticsPage } from "./pages/teacher/TeacherAnalyticsPage";
import { AdminAnalyticsPage } from "./pages/admin/AdminAnalyticsPage";
import { TeacherPlannerPage } from "./pages/teacher/TeacherPlannerPage";
import { AdminPlannerPage } from "./pages/admin/AdminPlannerPage";
import { PWAInstallCard } from "./components/pwa/PWAInstallCard";
import { PWAUpdateToast } from "./components/pwa/PWAUpdateToast";

export default function App() {
  if (!isSupabaseConfigured) {
    return <ConfigNeededPage />;
  }

  return (
    <AuthProvider>
      <PWAInstallCard />
      <PWAUpdateToast />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<PortalSelectionPage />} />
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
    </AuthProvider>
  );
}
