/**
 * SuperAdminDashboard.jsx
 * Platform owner dashboard: manage tenants, view platform stats.
 * Route: /superadmin
 * Auth: uses sa_token from localStorage
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getPlatformStats,
  listTenants,
  createTenant,
  updateTenant,
} from "../utils/api";

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [saUser, setSaUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview"); // "overview" | "tenants" | "create"
  const [search, setSearch] = useState("");
  const [createForm, setCreateForm] = useState({
    name: "", contactEmail: "", subdomain: "", plan: "free",
    maxStudents: 500, maxFaculty: 20, maxExams: 50,
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createResult, setCreateResult] = useState(null);
  const [createError, setCreateError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("sa_token");
    const user = localStorage.getItem("sa_user");
    if (!token) { navigate("/login"); return; }
    setSaUser(user ? JSON.parse(user) : {});
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [statsRes, tenantsRes] = await Promise.all([
        getPlatformStats(),
        listTenants(),
      ]);
      setStats(statsRes.data);
      setTenants(tenantsRes.data || []);
    } catch {
      // token may be expired
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("sa_token");
    localStorage.removeItem("sa_user");
    navigate("/login");
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError("");
    setCreateResult(null);
    setCreateLoading(true);
    try {
      const res = await createTenant(createForm);
      setCreateResult(res.data);
      setCreateForm({ name: "", contactEmail: "", subdomain: "", plan: "free", maxStudents: 500, maxFaculty: 20, maxExams: 50 });
      loadAll();
    } catch (err) {
      setCreateError(err?.response?.data?.msg || "Failed to create tenant.");
    } finally {
      setCreateLoading(false);
    }
  };

  const toggleStatus = useCallback(async (tenant) => {
    const newStatus = tenant.status === "active" ? "disabled" : "active";
    try {
      await updateTenant(tenant._id, { status: newStatus });
      setActionMsg(`${tenant.name} ${newStatus === "active" ? "enabled" : "disabled"}.`);
      loadAll();
      setTimeout(() => setActionMsg(""), 3000);
    } catch {
      setActionMsg("Failed to update tenant.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = tenants.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subdomain.toLowerCase().includes(search.toLowerCase())
  );

  const StatCard = ({ label, value, color }) => (
    <div className={`bg-white rounded-xl border-l-4 p-5 shadow-sm ${color}`}>
      <p className="text-sm text-slate-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-slate-800">{value ?? "—"}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-emerald-400">ProctAI</span>
          <span className="text-slate-400 text-sm hidden sm:block">Super Admin Panel</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-300 hidden sm:block">{saUser?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Action Feedback */}
        {actionMsg && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-2 rounded-lg text-sm">
            {actionMsg}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-200 pb-0">
          {["overview", "tenants", "create"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg capitalize transition-colors ${
                tab === t
                  ? "bg-white border border-b-white border-slate-200 text-emerald-600 -mb-px"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "create" ? "+ New Tenant" : t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* ── OVERVIEW ── */}
            {tab === "overview" && stats && (
              <div>
                <h2 className="text-xl font-bold text-slate-800 mb-5">Platform Overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
                  <StatCard label="Total Tenants" value={stats.tenants?.total} color="border-emerald-500" />
                  <StatCard label="Active" value={stats.tenants?.active} color="border-green-400" />
                  <StatCard label="Disabled" value={stats.tenants?.disabled} color="border-red-400" />
                  <StatCard label="Total Students" value={stats.users?.students} color="border-blue-400" />
                  <StatCard label="Total Faculty" value={stats.users?.faculty} color="border-purple-400" />
                  <StatCard label="Total Exams" value={stats.activity?.exams} color="border-yellow-400" />
                  <StatCard label="Total Attempts" value={stats.activity?.attempts} color="border-indigo-400" />
                </div>

                {/* Recent tenants */}
                <h3 className="text-lg font-semibold text-slate-700 mb-3">All Organizations</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {tenants.slice(0, 6).map((t) => (
                    <TenantCard key={t._id} tenant={t} onToggle={toggleStatus} />
                  ))}
                </div>
              </div>
            )}

            {/* ── TENANTS LIST ── */}
            {tab === "tenants" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-slate-800">All Tenants ({tenants.length})</h2>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or subdomain..."
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((t) => (
                    <TenantCard key={t._id} tenant={t} onToggle={toggleStatus} />
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-slate-400 col-span-3 text-center py-10">No tenants found.</p>
                  )}
                </div>
              </div>
            )}

            {/* ── CREATE TENANT ── */}
            {tab === "create" && (
              <div className="max-w-xl">
                <h2 className="text-xl font-bold text-slate-800 mb-5">Create New Organization</h2>

                {createResult && (
                  <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-5">
                    <p className="font-semibold text-emerald-700 mb-3">Tenant Created Successfully!</p>
                    <div className="space-y-1 text-sm text-slate-700">
                      <p><span className="font-medium">Tenant Code:</span> {createResult.tenant?.tenantCode}</p>
                      <p><span className="font-medium">Subdomain:</span> {createResult.tenant?.subdomain}</p>
                      <p><span className="font-medium">Plan:</span> {createResult.tenant?.plan}</p>
                    </div>
                    <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-yellow-800 font-semibold text-sm mb-2">Admin Credentials (save now — shown once)</p>
                      <p className="text-sm font-mono text-slate-800">Email: {createResult.tenantAdminCredentials?.email}</p>
                      <p className="text-sm font-mono text-slate-800">Password: {createResult.tenantAdminCredentials?.password}</p>
                    </div>
                  </div>
                )}

                {createError && (
                  <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                    {createError}
                  </div>
                )}

                <form onSubmit={handleCreate} className="space-y-4 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Organization Name *</label>
                    <input
                      value={createForm.name}
                      onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="e.g. CBIT Hyderabad"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Contact Email *</label>
                    <input
                      type="email"
                      value={createForm.contactEmail}
                      onChange={(e) => setCreateForm((f) => ({ ...f, contactEmail: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="admin@cbit.ac.in"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Subdomain <span className="text-slate-400 font-normal">(auto-generated if blank)</span>
                    </label>
                    <div className="flex items-center">
                      <input
                        value={createForm.subdomain}
                        onChange={(e) => setCreateForm((f) => ({ ...f, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                        className="w-full border border-slate-200 rounded-l-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        placeholder="cbit"
                      />
                      <span className="bg-slate-100 border border-l-0 border-slate-200 px-3 py-2 rounded-r-lg text-sm text-slate-500 whitespace-nowrap">
                        .yourplatform.com
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Plan</label>
                      <select
                        value={createForm.plan}
                        onChange={(e) => setCreateForm((f) => ({ ...f, plan: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {["free", "starter", "pro", "enterprise"].map((p) => (
                          <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Max Students</label>
                      <input
                        type="number"
                        value={createForm.maxStudents}
                        onChange={(e) => setCreateForm((f) => ({ ...f, maxStudents: Number(e.target.value) }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={createLoading}
                    className={`w-full bg-emerald-600 text-white py-2.5 rounded-lg font-semibold text-sm transition-colors ${createLoading ? "opacity-60 cursor-not-allowed" : "hover:bg-emerald-500"}`}
                  >
                    {createLoading ? "Creating..." : "Create Organization"}
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tenant Card Component ────────────────────────────────────────────────────
function TenantCard({ tenant, onToggle }) {
  const statusColor = {
    active: "bg-green-100 text-green-700",
    disabled: "bg-red-100 text-red-700",
    trial: "bg-yellow-100 text-yellow-700",
  }[tenant.status] || "bg-slate-100 text-slate-600";

  const planColor = {
    free: "bg-slate-100 text-slate-600",
    starter: "bg-blue-100 text-blue-700",
    pro: "bg-purple-100 text-purple-700",
    enterprise: "bg-amber-100 text-amber-700",
  }[tenant.plan] || "bg-slate-100";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">{tenant.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{tenant.subdomain}.platform.com</p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
            {tenant.status}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planColor}`}>
            {tenant.plan}
          </span>
        </div>
      </div>

      {tenant.stats && (
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          {[
            { label: "Students", val: tenant.stats.studentCount },
            { label: "Faculty", val: tenant.stats.facultyCount },
            { label: "Exams", val: tenant.stats.examCount },
          ].map(({ label, val }) => (
            <div key={label} className="bg-slate-50 rounded-lg py-2">
              <p className="text-lg font-bold text-slate-700">{val}</p>
              <p className="text-xs text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onToggle(tenant)}
          className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
            tenant.status === "active"
              ? "bg-red-50 text-red-600 hover:bg-red-100"
              : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
          }`}
        >
          {tenant.status === "active" ? "Disable" : "Enable"}
        </button>
        <span className="text-xs text-slate-400 self-center ml-auto">
          {tenant.tenantCode}
        </span>
      </div>
    </div>
  );
}