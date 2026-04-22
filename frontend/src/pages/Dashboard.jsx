import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AOS from "aos";
import "aos/dist/aos.css";
import {
  listAvailableExams,
  listMyExams,
  listAttemptsForExam,
  listFaculty,
} from "../utils/api";

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const token = useMemo(() => localStorage.getItem("token"), []);
  const userRef = useRef(null);

  // Role-specific data
  const [studentStats, setStudentStats] = useState({
    available: 0,
    inProgress: 0,
    submitted: 0,
    nextWindow: null,
  });
  const [studentActive, setStudentActive] = useState([]);
  const [studentUpcoming, setStudentUpcoming] = useState([]);
  const [facultyStats, setFacultyStats] = useState({
    exams: 0,
    inProgress: 0,
  });
  const [currentExam, setCurrentExam] = useState(null);
  const [currentAttempts, setCurrentAttempts] = useState([]);
  const [adminStats, setAdminStats] = useState({
    facultyCount: 0,
    latest: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    AOS.init({ duration: 1000, once: false, mirror: true });

    const storedUser = localStorage.getItem("user");
    if (!storedUser) {
      navigate("/login");
      return;
    }
    const u = JSON.parse(storedUser);
    
    if (u.role === "tenantAdmin") {
      navigate("/admin/dashboard");
      return;
    }
    setUser(u);
    userRef.current = u;
    fetchRoleData(u).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // ticking clock for countdowns
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchRoleData = async (u) => {
    try {
      setError("");
      if (u.role === "student") {
        const { data } = await listAvailableExams();
        const available = data.length;
        const inProgress = data.filter(
          (e) => e.status === "in-progress"
        ).length;
        const submitted = data.filter((e) => e.status === "submitted").length;
        const nextWindow =
          data
            .map((e) => e.window?.start)
            .filter(Boolean)
            .map((d) => new Date(d))
            .sort((a, b) => a - b)[0] || null;
        setStudentStats({ available, inProgress, submitted, nextWindow });
        // Show only currently running exams in the "Current exam" section
        const now = new Date();
        const running = (data || [])
          .filter((e) => {
            const s = e?.window?.start ? new Date(e.window.start) : null;
            const ed = e?.window?.end ? new Date(e.window.end) : null;
            return s && ed && s <= now && now <= ed;
          })
          .sort((a, b) => new Date(a.window.end) - new Date(b.window.end));
        setStudentActive(running);
        // Upcoming (scheduled) exams
        const upcoming = (data || [])
          .filter((e) => {
            const s = e?.window?.start ? new Date(e.window.start) : null;
            return s && now < s;
          })
          .sort(
            (a, b) =>
              new Date(a.window.start).getTime() -
              new Date(b.window.start).getTime()
          );
        setStudentUpcoming(upcoming);
      } else if (u.role === "faculty") {
        const { data: exams } = await listMyExams();
        const examsCount = exams.length;
        // determine current running exam(s)
        const now = new Date();
        const running = (exams || []).filter((e) => {
          const s = e?.window?.start ? new Date(e.window.start) : null;
          const ed = e?.window?.end ? new Date(e.window.end) : null;
          return s && ed && s <= now && now <= ed;
        });
        running.sort((a, b) => new Date(a.window.end) - new Date(b.window.end));
        const curr = running[0] || null;
        setCurrentExam(curr);
        let inProgress = 0;
        if (curr) {
          const { data: atts } = await listAttemptsForExam(curr._id);
          setCurrentAttempts(atts);
          inProgress = atts.filter((a) => a.status === "in-progress").length;
        } else {
          setCurrentAttempts([]);
        }
        setFacultyStats({ exams: examsCount, inProgress });
      } else if (u.role === "admin") {
        // read latest token from storage to avoid stale memo when switching users
        const latestToken = localStorage.getItem("token") || token || "";
        const { data } = await listFaculty(latestToken);
        setAdminStats({ facultyCount: data.length, latest: data.slice(0, 5) });
      }
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Failed to load dashboard data"
      );
    }
  };

  // Refetch when window regains focus or tab becomes visible
  useEffect(() => {
    const refetch = () => {
      const u = userRef.current;
      if (u) fetchRoleData(u);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // fetchRoleData is stable across renders; listeners only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light polling to keep counts fresh while user is on dashboard
  useEffect(() => {
    if (!user) return;
    userRef.current = user;
    const intervalMs = 15000; // 15s gentle polling
    const id = setInterval(() => {
      const u = userRef.current;
      if (u) fetchRoleData(u);
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <div className="bg-slate-50 font-sans min-h-[70vh] py-10">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-6" data-aos="fade-up">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-3xl sm:text-4xl font-bold text-emerald-700">
              Welcome, {user ? user.name : "Guest"}
            </h2>
            {user?.role && (
              <span
                aria-label={`Role: ${user.role}`}
                className="px-3 py-1 rounded-full bg-emerald-600/15 text-emerald-700 border border-emerald-600/30 text-sm font-semibold"
              >
                {user.role.slice(0, 1).toUpperCase() + user.role.slice(1)}
              </span>
            )}
          </div>
          <p className="text-slate-600 mt-1">
            {user?.role === "student" && "Your exam overview and next steps."}
            {user?.role === "faculty" && "Your exams and recent activity."}
            {user?.role === "admin" && "Faculty overview and management."}
          </p>
        </div>

        {error && (
          <div
            className="bg-red-100 text-red-700 px-4 py-2 rounded mb-4"
            data-aos="fade-up"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div
            className="bg-white p-6 rounded-xl shadow border border-slate-200"
            data-aos="fade-up"
          >
            Loading dashboard...
          </div>
        ) : (
          <>
            {user?.role === "student" && (
              <div
                className="grid grid-cols-1 md:grid-cols-3 gap-4"
                data-aos="fade-up"
              >
                <StatCard
                  label="Available exams"
                  value={studentStats.available}
                />
                <StatCard label="In-progress" value={studentStats.inProgress} />
                <StatCard label="Submitted" value={studentStats.submitted} />
              </div>
            )}

            {user?.role === "student" && (
              <div className="mt-6" data-aos="fade-up">
                <div className="bg-white p-6 rounded-xl shadow border border-slate-200">
                  <h3 className="text-xl font-semibold text-slate-800">
                    Current exam
                  </h3>
                  {studentActive.length === 0 ? (
                    <p className="text-slate-600 mt-1">
                      No exam is currently active.
                    </p>
                  ) : (
                    <StudentCurrentExam exam={studentActive[0]} />
                  )}
                </div>
              </div>
            )}

            {user?.role === "student" && (
              <div className="mt-6" data-aos="fade-up">
                <div className="bg-white p-6 rounded-xl shadow border border-slate-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold text-slate-800">
                      Upcoming exams
                    </h3>
                  </div>
                  {studentUpcoming.length === 0 ? (
                    <p className="text-slate-600 mt-1">No upcoming exams.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                      {studentUpcoming.map((ex) => (
                        <UpcomingExamCard
                          key={ex._id}
                          exam={ex}
                          nowTs={nowTs}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {user?.role === "faculty" && (
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
                data-aos="fade-up"
              >
                <StatCard label="My exams" value={facultyStats.exams} />
                <StatCard
                  label="In-progress (current)"
                  value={facultyStats.inProgress}
                />
              </div>
            )}

            {user?.role === "faculty" && (
              <div className="mt-6" data-aos="fade-up">
                <div className="bg-white p-6 rounded-xl shadow border border-slate-200">
                  <h3 className="text-xl font-semibold text-slate-800">
                    Current running exam
                  </h3>
                  {!currentExam ? (
                    <p className="text-slate-600 mt-1">
                      No exam is currently running.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <p className="text-lg font-semibold text-emerald-700">
                            {currentExam.title}
                          </p>
                          <p className="text-slate-600 text-sm">
                            Window:{" "}
                            {new Date(
                              currentExam.window.start
                            ).toLocaleString()}
                            &rarr;{" "}
                            {new Date(currentExam.window.end).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-3">
                          <span className="text-sm px-2 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            Submissions:{" "}
                            {
                              currentAttempts.filter(
                                (a) => a.status === "submitted"
                              ).length
                            }
                          </span>
                          <span className="text-sm px-2 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            In-progress:{" "}
                            {
                              currentAttempts.filter(
                                (a) => a.status === "in-progress"
                              ).length
                            }
                          </span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <h4 className="font-semibold text-slate-800">
                          Recent submissions
                        </h4>
                        {currentAttempts.filter((a) => a.status === "submitted")
                          .length === 0 ? (
                          <p className="text-slate-600 text-sm mt-1">
                            No submissions yet.
                          </p>
                        ) : (
                          <ul className="mt-2 divide-y divide-slate-200">
                            {currentAttempts
                              .filter((a) => a.status === "submitted")
                              .sort(
                                (a, b) =>
                                  new Date(b.submittedAt) -
                                  new Date(a.submittedAt)
                              )
                              .slice(0, 5)
                              .map((a) => {
                                const studentLabel =
                                  a.student?.name ||
                                  a.student?.email ||
                                  a.studentId;
                                const studentSub = a.student?.rollNo
                                  ? ` • ${a.student.rollNo}`
                                  : "";
                                return (
                                  <li
                                    key={a._id}
                                    className="py-2 flex items-center justify-between"
                                  >
                                    <span className="text-sm text-slate-700">
                                      {studentLabel}
                                      {studentSub}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                      {new Date(a.submittedAt).toLocaleString()}
                                    </span>
                                  </li>
                                );
                              })}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {user?.role === "admin" && (
              <div
                className="grid grid-cols-1 md:grid-cols-3 gap-4"
                data-aos="fade-up"
              >
                <StatCard
                  label="Total faculty"
                  value={adminStats.facultyCount}
                />
                <div className="md:col-span-2 bg-white p-6 rounded-xl shadow border border-slate-200">
                  <h3 className="text-xl font-semibold text-slate-800">
                    Newest faculty
                  </h3>
                  {adminStats.latest.length === 0 ? (
                    <p className="text-slate-600 mt-2">No faculty yet.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-200">
                      {adminStats.latest.map((f) => (
                        <li
                          key={f._id || f.id}
                          className="py-2 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-medium text-slate-800">
                              {f.name}
                            </p>
                            <p className="text-sm text-slate-600">{f.email}</p>
                          </div>
                          <span className="text-sm text-slate-500">
                            {f.createdAt
                              ? new Date(f.createdAt).toLocaleDateString()
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;

import PropTypes from "prop-types";

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-xl shadow border border-slate-200 p-6 text-center">
      <div className="text-3xl font-extrabold text-emerald-700">{value}</div>
      <div className="text-slate-600 mt-1">{label}</div>
    </div>
  );
}

StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};

function StudentCurrentExam({ exam }) {
  const navigate = useNavigate();
  const [opensIn, setOpensIn] = useState("");
  const s = exam?.window?.start ? new Date(exam.window.start) : null;
  const ed = exam?.window?.end ? new Date(exam.window.end) : null;
  const now = new Date();
  const beforeStart = s && now < s;
  const afterEnd = ed && now > ed;
  // const withinWindow = s && ed && now >= s && now <= ed; // not currently used

  useEffect(() => {
    if (!beforeStart || !s) {
      setOpensIn("");
      return;
    }
    const fmt = (ms) => {
      if (ms <= 0) return "starting…";
      const totalSec = Math.floor(ms / 1000);
      const hh = Math.floor(totalSec / 3600)
        .toString()
        .padStart(2, "0");
      const mm = Math.floor((totalSec % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const ss = Math.floor(totalSec % 60)
        .toString()
        .padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    };
    const tick = () => setOpensIn(fmt(s - new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [beforeStart, s]);

  const btn = () => {
    if (exam.status === "submitted") return "Submitted";
    if (beforeStart) return "Scheduled";
    if (afterEnd) return "Closed";
    if (exam.status === "in-progress") return "Resume";
    return "Start";
  };
  const disabled = exam.status === "submitted" || beforeStart || afterEnd;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
      <div>
        <p className="text-lg font-semibold text-emerald-700">{exam.title}</p>
        <p className="text-slate-600 text-sm">
          Window: {new Date(exam.window.start).toLocaleString()} &rarr;{" "}
          {new Date(exam.window.end).toLocaleString()}
        </p>
        <p className="text-slate-600 text-sm">
          Duration: {exam.durationMins} mins
        </p>
        {beforeStart && (
          <p className="text-slate-600 text-sm">Opens in {opensIn}</p>
        )}
      </div>
      <button
        className={`px-3 py-2 rounded font-semibold transition-colors ${
          disabled
            ? "bg-slate-200 text-slate-500 cursor-not-allowed"
            : "bg-emerald-600 text-slate-900 hover:bg-emerald-500"
        }`}
        onClick={() => {
          if (!disabled) navigate(`/attempt/${exam._id}`);
        }}
        disabled={disabled}
        title={disabled ? "Already submitted" : "Open exam"}
      >
        {btn()}
      </button>
    </div>
  );
}

StudentCurrentExam.propTypes = {
  exam: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    durationMins: PropTypes.number.isRequired,
    status: PropTypes.string.isRequired,
    window: PropTypes.shape({
      start: PropTypes.string.isRequired,
      end: PropTypes.string.isRequired,
    }).isRequired,
  }).isRequired,
};

function UpcomingExamCard({ exam, nowTs }) {
  const navigate = useNavigate();
  const start = exam?.window?.start ? new Date(exam.window.start) : null;
  const startsInMs = start ? start.getTime() - nowTs : null;

  const formatDuration = (ms) => {
    if (ms == null) return "";
    if (ms <= 0) return "0s";
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h || d) parts.push(`${h}h`);
    if (m || h || d) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  };

  return (
    <div className="bg-white rounded-xl shadow border border-slate-200 p-4 space-y-2">
      <div className="flex items-start justify-between">
        <h4 className="text-lg font-semibold text-slate-800">{exam.title}</h4>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
            Upcoming
          </span>
          {typeof startsInMs === "number" && (
            <span className="text-[11px] text-blue-700">
              Starts in {formatDuration(startsInMs)}
            </span>
          )}
        </div>
      </div>
      {exam.description && (
        <p className="text-sm text-slate-600">{exam.description}</p>
      )}
      <div className="text-sm text-slate-700">
        <div>Duration: {exam.durationMins} mins</div>
        <div>
          Window:{" "}
          {exam.window?.start
            ? new Date(exam.window.start).toLocaleString()
            : "-"}
          &rarr;{" "}
          {exam.window?.end ? new Date(exam.window.end).toLocaleString() : "-"}
        </div>
      </div>
      <div className="pt-1">
        <button
          className="bg-emerald-600 text-slate-900 font-semibold px-3 py-1 rounded hover:bg-emerald-500 transition-colors disabled:bg-gray-200 disabled:text-gray-500"
          onClick={() => navigate(`/attempt/${exam._id}`)}
          disabled
          title="Exam hasn't started yet"
        >
          Starts soon
        </button>
      </div>
    </div>
  );
}

UpcomingExamCard.propTypes = {
  exam: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    durationMins: PropTypes.number.isRequired,
    status: PropTypes.string,
    description: PropTypes.string,
    window: PropTypes.shape({
      start: PropTypes.string,
      end: PropTypes.string,
    }).isRequired,
  }).isRequired,
  nowTs: PropTypes.number.isRequired,
};
