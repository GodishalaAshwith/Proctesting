/**
 * UPDATED App.jsx — Multi-Tenant Version
 *
 * Changes:
 *  - Wrapped in TenantProvider
 *  - Added SuperAdmin route (/superadmin) with sa_token guard
 *  - Added TenantAdmin dashboard route (/admin/dashboard)
 *  - Added /change-password route
 *  - RoleRoute updated to accept "tenantAdmin"
 *  - Admin routes accept both "admin" and "tenantAdmin"
 */
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { TenantProvider } from "./context/TenantContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import ContactUs from "./pages/ContactUs";
import AdminFaculty from "./pages/AdminFaculty";
import AdminStudentsUpload from "./pages/AdminStudentsUpload";
import AdminUsers from "./pages/AdminUsers";
import FacultyExams from "./pages/FacultyExams";
import ExamEditor from "./pages/ExamEditor";
import FacultySubmissions from "./pages/FacultySubmissions";
import FacultyLiveView from "./pages/FacultyLiveView";
import StudentExams from "./pages/StudentExams";
import ExamRunner from "./pages/ExamRunner";
import StudentProfile from "./pages/StudentProfile";
import FacultyProfile from "./pages/FacultyProfile";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import FacultyLiveAlerts from "./components/FacultyLiveAlerts";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import TenantAdminDashboard from "./pages/TenantAdminDashboard";
import ForceChangePassword from "./pages/ForceChangePassword";
import PropTypes from "prop-types";

// ─── Auth Guards ──────────────────────────────────────────────────────────────

const PrivateRoute = ({ children }) =>
  localStorage.getItem("token") ? children : <Navigate to="/login" />;

const RoleRoute = ({ allow, children }) => {
  const stored = localStorage.getItem("user");
  if (!stored) return <Navigate to="/login" />;
  const user = JSON.parse(stored);
  return allow.includes(user.role) ? children : <Navigate to="/" />;
};

// SuperAdmin: uses sa_token, not token
const SuperAdminRoute = ({ children }) =>
  localStorage.getItem("sa_token") ? children : <Navigate to="/login" />;

PrivateRoute.propTypes = { children: PropTypes.node.isRequired };
RoleRoute.propTypes = {
  allow: PropTypes.arrayOf(PropTypes.string).isRequired,
  children: PropTypes.node.isRequired,
};
SuperAdminRoute.propTypes = { children: PropTypes.node.isRequired };

// ─── App Shell ────────────────────────────────────────────────────────────────

function AppShell() {
  const location = useLocation();
  const hideChrome =
    location.pathname.startsWith("/attempt/") ||
    location.pathname.startsWith("/superadmin");

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {!hideChrome && <Navbar />}
      {!hideChrome && <FacultyLiveAlerts />}
      <main className="flex-1">
        <Routes>
          {/* ── Public ── */}
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/contactus" element={<ContactUs />} />

          {/* ── SuperAdmin ── */}
          <Route
            path="/superadmin"
            element={
              <SuperAdminRoute>
                <SuperAdminDashboard />
              </SuperAdminRoute>
            }
          />

          {/* ── Force Password Change ── */}
          <Route
            path="/change-password"
            element={
              <PrivateRoute>
                <ForceChangePassword />
              </PrivateRoute>
            }
          />

          {/* ── General Dashboard (role-aware) ── */}
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />

          {/* ── TenantAdmin Panel ── */}
          <Route
            path="/admin/dashboard"
            element={
              <PrivateRoute>
                <RoleRoute allow={["tenantAdmin", "admin"]}>
                  <TenantAdminDashboard />
                </RoleRoute>
              </PrivateRoute>
            }
          />

          {/* ── Admin (TenantAdmin) Routes ── */}
          <Route
            path="/admin/faculty"
            element={
              <PrivateRoute>
                <RoleRoute allow={["tenantAdmin", "admin"]}>
                  <AdminFaculty />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <PrivateRoute>
                <RoleRoute allow={["tenantAdmin", "admin"]}>
                  <AdminUsers />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/admin/students/upload"
            element={
              <PrivateRoute>
                <RoleRoute allow={["tenantAdmin", "admin"]}>
                  <AdminStudentsUpload />
                </RoleRoute>
              </PrivateRoute>
            }
          />

          {/* ── Faculty Routes ── */}
          <Route
            path="/faculty/exams"
            element={
              <PrivateRoute>
                <RoleRoute allow={["faculty"]}>
                  <FacultyExams />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/faculty/profile"
            element={
              <PrivateRoute>
                <RoleRoute allow={["faculty"]}>
                  <FacultyProfile />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/faculty/exams/new"
            element={
              <PrivateRoute>
                <RoleRoute allow={["faculty"]}>
                  <ExamEditor />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/faculty/exams/:id"
            element={
              <PrivateRoute>
                <RoleRoute allow={["faculty"]}>
                  <ExamEditor />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/faculty/exams/:examId/attempts"
            element={
              <PrivateRoute>
                <RoleRoute allow={["faculty"]}>
                  <FacultySubmissions />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/faculty/exams/:examId/live"
            element={
              <PrivateRoute>
                <RoleRoute allow={["faculty"]}>
                  <FacultyLiveView />
                </RoleRoute>
              </PrivateRoute>
            }
          />

          {/* ── Student Routes ── */}
          <Route
            path="/exams"
            element={
              <PrivateRoute>
                <RoleRoute allow={["student"]}>
                  <StudentExams />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/student/profile"
            element={
              <PrivateRoute>
                <RoleRoute allow={["student"]}>
                  <StudentProfile />
                </RoleRoute>
              </PrivateRoute>
            }
          />
          <Route
            path="/attempt/:examId"
            element={
              <PrivateRoute>
                <RoleRoute allow={["student"]}>
                  <ExamRunner />
                </RoleRoute>
              </PrivateRoute>
            }
          />

          {/* ── Catch-all ── */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      {!hideChrome && <Footer />}
    </div>
  );
}

function App() {
  return (
    <TenantProvider>
      <Router>
        <AppShell />
      </Router>
    </TenantProvider>
  );
}

export default App;