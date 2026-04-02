import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getProctorEvents,
  listAttemptsForExam,
  grantRetake,
  getExam,
} from "../utils/api";

const FacultySubmissions = () => {
  const navigate = useNavigate();
  const { examId } = useParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [examTitle, setExamTitle] = useState("");

  // Sanitize exam title to be used safely as a filename (Windows-friendly)
  const sanitizeFileName = (name) => {
    if (!name || typeof name !== "string") return "exam";
    // Replace invalid characters <>:"/\|?* and control chars, trim dots/spaces at end
    const cleaned = name
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[\u0000-\u001F\u007F]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    // Avoid trailing dots/spaces
    return cleaned.replace(/[\.\s]+$/g, "").slice(0, 150) || "exam";
  };

  // For Excel export: only Roll number and Marks
  const toExportRowsXLSX = useCallback(() => {
    return (rows || []).map((a) => ({
      RollNo: a.student?.rollNo || "",
      Marks: typeof a.score === "number" ? a.score : "",
    }));
  }, [rows]);

  // For CSV export: only Roll number and Marks
  const toExportRowsCSV = useCallback(() => {
    return (rows || []).map((a) => ({
      RollNo: a.student?.rollNo || "",
      Marks: typeof a.score === "number" ? a.score : "",
    }));
  }, [rows]);

  // (No timestamp needed in filenames per requirement)

  const exportXLSX = () => {
    if (!rows?.length) return;
    const data = toExportRowsXLSX();
    const ws = XLSX.utils.json_to_sheet(data);
    // Set autofilter over the entire table
    if (ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      ws["!autofilter"] = { ref: XLSX.utils.encode_range(range) };
      // Compute column widths (wch) based on content (simple heuristic)
      const headers = Object.keys(data[0] || {});
      const cols = headers.map((h) => ({
        wch: Math.min(String(h).length + 6, 40),
      }));
      ws["!cols"] = cols;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Submissions");
    const fname = `${sanitizeFileName(examTitle || "exam")}.xlsx`;
    XLSX.writeFile(wb, fname, {
      bookType: "xlsx",
      compression: true,
    });
  };

  const exportCSV = () => {
    if (!rows?.length) return;
    const data = toExportRowsCSV();
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Submissions");
    const fname = `${sanitizeFileName(examTitle || "exam")}.csv`;
    XLSX.writeFile(wb, fname, {
      bookType: "csv",
      FS: ",",
    });
  };

  const fetchAttempts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await listAttemptsForExam(examId);
      setRows(data || []);
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Failed to load attempts"
      );
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (!stored) {
      navigate("/login");
      return;
    }
    const u = JSON.parse(stored);
    if (u.role !== "faculty") {
      navigate("/");
      return;
    }
    // Fetch attempts and exam title in parallel
    fetchAttempts();
    (async () => {
      try {
        const { data } = await getExam(examId);
        setExamTitle(data?.title || "");
      } catch {
        setExamTitle("");
      }
    })();
  }, [navigate, fetchAttempts]);

  const viewEvents = async (attemptId) => {
    setSelected(attemptId);
    setEvents([]);
    try {
      const { data } = await getProctorEvents(attemptId);
      setEvents(data || []);
    } catch {
      setEvents([]);
    }
  };

  const onGrantRetake = async (studentId) => {
    const input = window.prompt("How many retakes to grant?", "1");
    if (input == null) return; // cancelled
    const count = Math.max(1, Number(input) || 1);
    try {
      const { data } = await grantRetake(examId, studentId, count);
      alert(
        `Retake granted. Remaining for student: ${data?.remaining ?? count}`
      );
      // No need to refetch attempts immediately; optional refresh
      // await fetchAttempts();
    } catch (e) {
      alert(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Failed to grant retake"
      );
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-start sm:items-center justify-between gap-2 sm:gap-4 flex-col sm:flex-row">
        <h1 className="text-3xl font-bold">Submissions</h1>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={exportCSV}
            disabled={!rows.length}
            className="px-3 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Download submissions as CSV"
          >
            Export CSV
          </button>
          <button
            onClick={exportXLSX}
            disabled={!rows.length}
            className="px-3 py-2 rounded-md bg-emerald-600 text-slate-900 font-semibold hover:bg-emerald-500 disabled:opacity-50"
            title="Download submissions as Excel (.xlsx)"
          >
            Export Excel
          </button>
          <Link
            to={`/faculty/exams/`}
            className="text-emerald-700 hover:underline ml-2"
          >
            Back to exam
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 text-red-700 px-4 py-2 rounded">{error}</div>
      )}

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full table-auto min-w-max">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Attempt</th>
              <th className="text-left p-3">Student</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Score</th>
              <th className="text-left p-3">Violations</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">
                  No attempts yet.
                </td>
              </tr>
            ) : (
              rows.map((a) => {
                const studentName =
                  a.student?.name || a.student?.email || a.studentId;
                const studentMeta = a.student?.rollNo
                  ? ` (${a.student.rollNo})`
                  : "";
                return (
                  <tr key={a._id} className="border-t">
                    <td className="p-3 text-sm">{a._id}</td>
                    <td className="p-3 text-sm">
                      {studentName}
                      {studentMeta}
                    </td>
                    <td className="p-3">{a.status}</td>
                    <td className="p-3">{a.score}</td>
                    <td className="p-3">{a.violationsCount}</td>
                    <td className="p-3">
                      <button
                        className="text-emerald-700 hover:underline"
                        onClick={() => viewEvents(a._id)}
                      >
                        View events
                      </button>
                      {a.student?._id && (
                        <button
                          className="ml-3 text-emerald-700 hover:underline"
                          onClick={() => onGrantRetake(a.student._id)}
                          title="Allow this student to retake the test"
                        >
                          Grant retake
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="bg-white rounded shadow p-4">
          <div className="flex items-start sm:items-center justify-between mb-2 gap-2 flex-col sm:flex-row">
            <h2 className="text-xl font-semibold">
              Proctoring events for {selected}
            </h2>
            <button
              className="text-sm text-gray-600"
              onClick={() => {
                setSelected(null);
                setEvents([]);
              }}
            >
              Close
            </button>
          </div>
          {events.length === 0 ? (
            <div className="text-gray-500">No events.</div>
          ) : (
            <ul className="list-disc pl-5 space-y-1">
              {events.map((e) => {
                const friendly = {
                  "visibility-hidden": {
                    label: "Switched away from the test",
                    help: "Tab or app not visible",
                  },
                  "tab-blur": {
                    label: "Left the test window",
                    help: "Window lost focus or alt-tab",
                  },
                  "fullscreen-exit": {
                    label: "Exited fullscreen",
                    help: "Fullscreen turned off",
                  },
                  "return-timeout": {
                    label: "Return timeout",
                    help: "Took too long to come back",
                  },
                  "face-absent": {
                    label: "No face detected",
                    help: "Student not visible to webcam",
                  },
                  "face-mismatch": {
                    label: "Identity mismatch",
                    help: "Different person detected",
                  },
                  "face-multiple": {
                    label: "Multiple faces",
                    help: "More than one person detected in frame",
                  },
                  "gaze-away": {
                    label: "Looking away",
                    help: "Sustained focus off-screen",
                  },
                  "gaze-no-face": {
                    label: "Gaze face not visible",
                    help: "Face missing during gaze check",
                  },
                }[e.type] || { label: e.type, help: "" };
                return (
                  <li key={e._id} className="text-sm">
                    <span className="font-medium">{friendly.label}</span>
                    {friendly.help ? ` – ${friendly.help}` : ""}
                    {e.meta?.penalty_score ? ` (Penalty Score: ${e.meta.penalty_score.toFixed(2)})` : ""}
                    {e.meta?.confidence ? ` (Confidence: ${(e.meta.confidence*100).toFixed(0)}%)` : ""} @{" "}
                    {new Date(e.createdAt).toLocaleString()}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default FacultySubmissions;
