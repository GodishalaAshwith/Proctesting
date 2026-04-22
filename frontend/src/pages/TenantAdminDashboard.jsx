/**
 * TenantAdminDashboard.jsx
 * Dashboard for tenantAdmin role — manages their org's faculty,
 * students, exams, audit logs and stats.
 * Route: /admin/dashboard (added to App.jsx)
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAdminStats,
  listFaculty,
  createFaculty,
  listStudents,
  getAdminAuditLogs,
} from "../utils/api";

export default function TenantAdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [faculty, setFaculty] = useState([]);
  const [students, setStudents] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [newFaculty, setNewFaculty] = useState({ name: "", email: "", password: "" });
  const [facultyLoading, setFacultyLoading] = useState(false);
  const [facultyError, setFacultyError] = useState("");

  const token = localStorage.getItem("token");

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (!stored) { navigate("/login"); return; }
    const u = JSON.parse(stored);
    if (u.role !== "tenantAdmin" && u.role !== "admin") {
      navigate("/dashboard");
      return;
    }
    setUser(u);
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [statsRes, facultyRes, studentsRes, logsRes] = await Promise.all([
        getAdminStats(),
        listFaculty(token),
        listStudents({}, token),
        getAdminAuditLogs({ limit: 20 }),
      ]);
      setStats(statsRes.data);
      setFaculty(facultyRes.data || []);
      setStudents(studentsRes.data?.items || studentsRes.data || []);
      setAuditLogs(logsRes.data?.logs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFaculty = async (e) => {
    e.preventDefault();
    setFacultyError("");
    setFacultyLoading(true);
    try {
      await createFaculty(newFaculty, token);
      setMsg("Faculty account created.");
      setNewFaculty({ name: "", email: "", password: "" });
      const res = await listFaculty(token);
      setFaculty(res.data || []);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      setFacultyError(err?.response?.data?.message || "Failed to create faculty.");
    } finally {
      setFacultyLoading(false);
    }
  };

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "faculty", label: "Faculty" },
    { id: "students", label: "Students" },
    { id: "audit", label: "Audit Logs" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Admin Panel</h1>
            <p className="text-sm text-slate-500">
              {user?.name} — {user?.email}
            </p>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm text-emerald-600 hover:underline"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {msg && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-2 rounded-lg text-sm">
            {msg}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white border border-slate-200 rounded-xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* OVERVIEW */}
            {tab === "overview" && stats && (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                  {[
                    { label: "Students", value: stats.students, color: "border-blue-400" },
                    { label: "Faculty", value: stats.faculty, color: "border-purple-400" },
                    { label: "Exams", value: stats.exams, color: "border-emerald-400" },
                    { label: "Submissions", value: stats.attempts?.submitted, color: "border-amber-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`bg-white rounded-xl border-l-4 p-5 shadow-sm ${color}`}>
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className="text-3xl font-bold text-slate-800 mt-1">{value ?? 0}</p>
                    </div>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-semibold text-slate-700 mb-3">Quick Actions</h3>
                    <div className="space-y-2">
                      {[
                        { label: "Upload Students", path: "/admin/students/upload" },
                        { label: "Manage Faculty", action: () => setTab("faculty") },
                        { label: "View All Users", path: "/admin/users" },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={item.path ? () => navigate(item.path) : item.action}
                          className="w-full text-left text-sm text-emerald-700 hover:text-emerald-600 py-1.5 px-3 rounded-lg hover:bg-emerald-50 transition-colors"
                        >
                          → {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-semibold text-slate-700 mb-3">Recent Activity</h3>
                    {auditLogs.slice(0, 5).map((log) => (
                      <div key={log._id} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
                        <span className="text-xs font-mono text-emerald-600 mt-0.5">{log.action}</span>
                        <span className="text-xs text-slate-500 ml-auto whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                    {auditLogs.length === 0 && <p className="text-sm text-slate-400">No activity yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {/* FACULTY */}
            {tab === "faculty" && (
              <div className="grid sm:grid-cols-5 gap-6">
                {/* Create form */}
                <div className="sm:col-span-2">
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="font-semibold text-slate-700 mb-4">Add Faculty</h3>
                    {facultyError && (
                      <p className="text-sm text-red-600 mb-3">{facultyError}</p>
                    )}
                    <form onSubmit={handleCreateFaculty} className="space-y-3">
                      {["name", "email", "password"].map((field) => (
                        <input
                          key={field}
                          type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                          placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                          value={newFaculty[field]}
                          onChange={(e) => setNewFaculty((f) => ({ ...f, [field]: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                      ))}
                      <button
                        type="submit"
                        disabled={facultyLoading}
                        className={`w-full bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium transition-colors ${facultyLoading ? "opacity-60 cursor-not-allowed" : "hover:bg-emerald-500"}`}
                      >
                        {facultyLoading ? "Creating..." : "Create Account"}
                      </button>
                    </form>
                  </div>
                </div>
                {/* Faculty list */}
                <div className="sm:col-span-3">
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 font-medium text-sm text-slate-600">
                      Faculty ({faculty.length})
                    </div>
                    <div className="divide-y divide-slate-50">
                      {faculty.map((f) => (
                        <div key={f._id} className="flex items-center justify-between px-5 py-3">
                          <div>
                            <p className="text-sm font-medium text-slate-700">{f.name}</p>
                            <p className="text-xs text-slate-400">{f.email}</p>
                          </div>
                          <span className="text-xs text-slate-400">
                            {new Date(f.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                      {faculty.length === 0 && (
                        <p className="px-5 py-6 text-sm text-slate-400">No faculty yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STUDENTS */}
            {tab === "students" && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="font-medium text-sm text-slate-600">Students ({students.length})</span>
                  <button
                    onClick={() => navigate("/admin/students/upload")}
                    className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-500"
                  >
                    + Upload CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                      <tr>
                        {["Roll No", "Name", "Dept", "Year", "Sec", "Semester"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {students.slice(0, 100).map((s) => (
                        <tr key={s._id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.rollno}</td>
                          <td className="px-4 py-3 text-slate-800">{s.name}</td>
                          <td className="px-4 py-3 text-slate-500">{s.department || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{s.year || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{s.section || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{s.semester || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {students.length === 0 && (
                    <p className="px-5 py-8 text-sm text-slate-400 text-center">
                      No students uploaded yet. Use the CSV upload button.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* AUDIT LOGS */}
            {tab === "audit" && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 font-medium text-sm text-slate-600">
                  Audit Trail
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                      <tr>
                        {["Action", "Actor", "Role", "Resource", "Date"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {auditLogs.map((log) => (
                        <tr key={log._id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-xs text-emerald-700">{log.action}</td>
                          <td className="px-4 py-3 text-slate-700">{log.actorName || "—"}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              {log.actorRole}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{log.resource || "—"}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {auditLogs.length === 0 && (
                    <p className="px-5 py-8 text-sm text-slate-400 text-center">No audit logs yet.</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}