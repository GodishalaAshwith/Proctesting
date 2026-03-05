import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  logProctorEvent,
  saveAttempt,
  startAttempt,
  submitAttempt,
} from "../utils/api";
import MarkdownRenderer from "../components/MarkdownRenderer";

const RETURN_TIMEOUT_SECONDS = 10;
const AUTOSAVE_MS = 3000;
// If a student leaves fullscreen/tab twice, we'll auto-submit
const SERIOUS_VIOLATION_TYPES = new Set([
  "fullscreen-exit",
  "visibility-hidden",
  "tab-blur",
  "window-resize",
]);
const AUTO_SUBMIT_AFTER_SERIOUS_COUNT = 2;

const ExamRunner = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState({
    loading: false,
    error: "",
    attemptId: null,
    exam: null,
    endAt: null,
    answers: {},
    remaining: 0,
    violations: 0,
    overlay: null,
    started: false,
    submitted: false,
    result: null,
    showSubmitConfirm: false,
  });

  const intervalRef = useRef(null);
  const saveTimerRef = useRef(null);
  const answersRef = useRef({});
  const ignoreFsChangeRef = useRef(false);
  const proctorListenersAttached = useRef(false);
  const isSubmittingRef = useRef(false);
  const seriousViolationCountRef = useRef(0);

  const requestFullscreen = async () => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      try {
        ignoreFsChangeRef.current = true;
        await el.requestFullscreen();
        // Give browser time to process fullscreen
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (e) {
        console.error("Fullscreen request failed:", e);
        ignoreFsChangeRef.current = false;
      }
    }
  };

  const exitFullscreen = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (e) {
        console.error("Exit fullscreen failed:", e);
      }
    }
  };

  const syncCountdown = (endISO) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const end = new Date(endISO).getTime();
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((end - now) / 1000));
      setState((s) => ({ ...s, remaining: diff }));
    }, 500);
  };

  // Use useCallback to stabilize handleSubmit reference
  const handleSubmit = useCallback(
    async (auto = false) => {
      if (isSubmittingRef.current) return;
      if (!state.attemptId || state.submitted) return;

      // If manual submit, show confirmation first
      if (!auto) {
        setState((s) => ({ ...s, showSubmitConfirm: true }));
        return;
      }

      // Auto-submit (time expired or violations)
      isSubmittingRef.current = true;

      try {
        // Flush any pending autosave so latest answers are persisted before submit
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const payload = Object.entries(answersRef.current).map(([k, v]) => ({
          questionIndex: Number(k),
          value: v,
        }));
        if (payload.length > 0) {
          try {
            await saveAttempt(state.attemptId, payload);
          } catch {}
        }
        const { data } = await submitAttempt(state.attemptId, payload);
        setState((s) => ({
          ...s,
          submitted: true,
          result: data,
          showSubmitConfirm: false,
        }));
      } catch (e) {
        const res = e?.response?.data;
        if (res && res.score !== undefined) {
          setState((s) => ({
            ...s,
            submitted: true,
            result: res,
            showSubmitConfirm: false,
          }));
        } else {
          setState((s) => ({
            ...s,
            error:
              e?.response?.data?.message ||
              e?.response?.data?.error ||
              "Failed to submit",
            showSubmitConfirm: false,
          }));
        }
      } finally {
        isSubmittingRef.current = false;
        await exitFullscreen();
      }
    },
    [state.attemptId, state.submitted]
  );

  const confirmSubmit = async () => {
    if (isSubmittingRef.current) return;
    if (!state.attemptId || state.submitted) return;

    isSubmittingRef.current = true;

    try {
      // Flush any pending autosave so latest answers are persisted before submit
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const payload = Object.entries(answersRef.current).map(([k, v]) => ({
        questionIndex: Number(k),
        value: v,
      }));
      if (payload.length > 0) {
        try {
          await saveAttempt(state.attemptId, payload);
        } catch {}
      }
      const { data } = await submitAttempt(state.attemptId, payload);
      setState((s) => ({
        ...s,
        submitted: true,
        result: data,
        showSubmitConfirm: false,
      }));
    } catch (e) {
      const res = e?.response?.data;
      if (res && res.score !== undefined) {
        setState((s) => ({
          ...s,
          submitted: true,
          result: res,
          showSubmitConfirm: false,
        }));
      } else {
        setState((s) => ({
          ...s,
          error:
            e?.response?.data?.message ||
            e?.response?.data?.error ||
            "Failed to submit",
          showSubmitConfirm: false,
        }));
      }
    } finally {
      isSubmittingRef.current = false;
      await exitFullscreen();
    }
  };

  const cancelSubmit = () => {
    setState((s) => ({ ...s, showSubmitConfirm: false }));
  };

  const registerViolation = useCallback(
    async (type, meta) => {
      if (!state.attemptId || state.submitted) return;

      try {
        await logProctorEvent(state.attemptId, type, meta);
      } catch {
        // ignore logging failure
      }

      // Track serious violations and auto-submit after threshold
      if (SERIOUS_VIOLATION_TYPES.has(type)) {
        seriousViolationCountRef.current += 1;
        if (
          seriousViolationCountRef.current >= AUTO_SUBMIT_AFTER_SERIOUS_COUNT
        ) {
          // Immediate auto-submit on repeated serious violation
          await handleSubmit(true);
          return;
        }
      }

      const until = Date.now() + RETURN_TIMEOUT_SECONDS * 1000;
      setState((s) => ({
        ...s,
        violations: s.violations + 1,
        overlay: { reason: type, until },
      }));

      const check = setInterval(() => {
        const returned =
          document.fullscreenElement && document.visibilityState === "visible";
        const now = Date.now();
        if (returned) {
          clearInterval(check);
          setTimeout(() => {
            setState((s2) => ({ ...s2, overlay: null }));
          }, 1000);
          return;
        }
        if (now >= until) {
          clearInterval(check);
          setState((s2) => ({ ...s2, overlay: null }));
          handleSubmit(true);
        }
      }, 250);
    },
    [state.attemptId, state.submitted, handleSubmit]
  );

  const performStart = async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const { data } = await startAttempt(examId);
      const { attemptId, exam, serverEndTime } = data;

      // Request fullscreen FIRST
      await requestFullscreen();

      // Wait longer for fullscreen to stabilize
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Now set started to true - this will trigger proctoring listeners
      setState((s) => ({
        ...s,
        loading: false,
        attemptId,
        exam,
        endAt: serverEndTime,
        started: true,
      }));

      syncCountdown(serverEndTime);

      // Reset the ignore flag after everything is set up
      setTimeout(() => {
        ignoreFsChangeRef.current = false;
      }, 1000);
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error:
          e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Failed to start attempt",
      }));
      await exitFullscreen();
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (!stored) {
      navigate("/login");
      return;
    }
    const u = JSON.parse(stored);
    if (u.role !== "student") {
      navigate("/");
      return;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [examId, navigate]);

  // Auto-submit when time runs out - DISABLED
  // useEffect(() => {
  //   if (
  //     state.remaining === 0 &&
  //     state.attemptId &&
  //     !state.submitted &&
  //     !isSubmittingRef.current
  //   ) {
  //     handleSubmit(true);
  //   }
  // }, [state.remaining, state.attemptId, state.submitted, handleSubmit]);

  // Proctoring handlers - attach only once
  useEffect(() => {
    if (
      !state.started ||
      !state.attemptId ||
      state.submitted ||
      proctorListenersAttached.current
    ) {
      return;
    }

    proctorListenersAttached.current = true;

    const onVisibility = async () => {
      if (document.visibilityState === "hidden" && !state.submitted) {
        await registerViolation("visibility-hidden", { reason: "tab hidden" });
      }
    };

    const onBlur = async () => {
      if (!state.submitted) {
        await registerViolation("tab-blur");
      }
    };

    const onFsChange = async () => {
      // Always check the ignore flag first
      if (ignoreFsChangeRef.current) {
        return; // Don't reset the flag here
      }

      if (!document.fullscreenElement && !state.submitted) {
        // Try to immediately restore fullscreen once to reduce false positives
        try {
          await requestFullscreen();
        } catch {}
        setTimeout(async () => {
          if (!document.fullscreenElement && !state.submitted) {
            await registerViolation("fullscreen-exit");
          }
        }, 200);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFsChange);

    // Detect suspicious window resizing (e.g., minimize or unmaximize while exam active)
    const onResize = async () => {
      if (state.submitted) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Heuristic: if window height is very small or significantly smaller than screen,
      // we consider it a violation even if fullscreen flag didn't fire
      const shrunkTooMuch =
        h < screen.availHeight * 0.6 || w < screen.availWidth * 0.6;
      if (shrunkTooMuch) {
        await registerViolation("window-resize", {
          w,
          h,
          sw: screen.availWidth,
          sh: screen.availHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("resize", onResize);
      proctorListenersAttached.current = false;
    };
  }, [state.started, state.attemptId, state.submitted, registerViolation]);

  // Anti-cheat: block copy/cut and common shortcuts; best-effort attempt to block Alt+Tab
  useEffect(() => {
    if (!state.started || state.submitted) return;

    const preventKeys = (e) => {
      const key = (e.key || "").toLowerCase();
      // Block common clipboard/print/save/select-all shortcuts
      if ((e.ctrlKey || e.metaKey) && ["c", "x", "p", "s", "a"].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      // Best-effort: try to prevent Alt+Tab (OS-level; may not be capturable)
      if (e.altKey && key === "tab") {
        e.preventDefault();
        e.stopPropagation();
      }
      // Attempt to block F11 (browser fullscreen toggle) and Escape (exit fullscreen)
      if (key === "f11" || key === "escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener("keydown", preventKeys, true);
    document.addEventListener("copy", prevent, true);
    document.addEventListener("cut", prevent, true);
    document.addEventListener("contextmenu", prevent, true);
    const beforeUnload = (e) => {
      // Warn before leaving or reloading during exam
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      document.removeEventListener("keydown", preventKeys, true);
      document.removeEventListener("copy", prevent, true);
      document.removeEventListener("cut", prevent, true);
      document.removeEventListener("contextmenu", prevent, true);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [state.started, state.submitted]);

  // Disable text selection and drag while exam is active
  useEffect(() => {
    if (!state.started || state.submitted) return undefined;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onSelectStart = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDragStart = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("selectstart", onSelectStart, true);
    document.addEventListener("dragstart", onDragStart, true);
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.removeEventListener("selectstart", onSelectStart, true);
      document.removeEventListener("dragstart", onDragStart, true);
    };
  }, [state.started, state.submitted]);

  const scheduleSave = (answersPatch) => {
    setState((s) => {
      const next = { ...s.answers, ...answersPatch };
      answersRef.current = next;
      return { ...s, answers: next };
    });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const payload = Object.entries(answersRef.current).map(([k, v]) => ({
        questionIndex: Number(k),
        value: v,
      }));
      try {
        await saveAttempt(state.attemptId, payload);
      } catch {
        // ignore autosave failure
      }
    }, AUTOSAVE_MS);
  };

  const handleChange = (qIdx, value) => {
    scheduleSave({ [qIdx]: value });
  };

  const exitAfterSubmit = () => {
    navigate("/exams");
  };

  if (state.loading) return <div className="p-6">Loading...</div>;
  if (state.error) return <div className="p-6 text-red-600">{state.error}</div>;

  if (!state.started) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Ready to start your test?</h1>
        <p className="text-gray-700 mb-4">
          When you start, the exam will enter fullscreen and proctoring will
          begin. Please avoid switching tabs or exiting fullscreen. Your time
          will start immediately.
        </p>
        <div className="flex gap-3">
          <button
            className="bg-indigo-600 text-white px-4 py-2 rounded"
            onClick={performStart}
          >
            Start Test
          </button>
          <button className="text-gray-700" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const exam = state.exam;
  const secs = state.remaining;
  const mm = Math.floor(secs / 60);
  const ss = (secs % 60).toString().padStart(2, "0");

  return (
    <div className="max-w-5xl mx-auto p-4">
      {state.overlay && !state.submitted && (
        <div className="fixed inset-0 bg-black/70 text-white flex flex-col items-center justify-center z-50">
          <h2 className="text-2xl font-bold mb-2">Stay on the exam</h2>
          {(() => {
            const map = {
              "visibility-hidden": {
                title: "You switched away from the test",
                detail:
                  "Please keep this tab visible. Switching to other apps or tabs isn't allowed during the exam.",
              },
              "tab-blur": {
                title: "You left the test window",
                detail:
                  "Please keep the exam window active. Clicking outside or alt-tabbing counts as a violation.",
              },
              "fullscreen-exit": {
                title: "You exited fullscreen",
                detail:
                  "The exam must remain in fullscreen. Please return to fullscreen to continue.",
              },
              "return-timeout": {
                title: "You took too long to return",
                detail:
                  "Please stay within the exam window and avoid leaving for extended periods.",
              },
            };
            const v = map[state.overlay.reason] || {
              title: "Activity outside the exam detected",
              detail:
                "Please keep the exam window focused and in fullscreen for the duration of the test.",
            };
            return (
              <>
                <div className="text-lg font-semibold mb-1">{v.title}</div>
                <p className="mb-4 text-sm text-gray-200">{v.detail}</p>
              </>
            );
          })()}
          {typeof state.overlay.until === "number" && (
            <div className="mb-4 text-sm text-gray-200">
              Warning will clear in{" "}
              {Math.max(
                0,
                Math.ceil((state.overlay.until - Date.now()) / 1000)
              )}
              s
            </div>
          )}
          <button
            className="bg-white text-black px-4 py-2 rounded"
            onClick={requestFullscreen}
          >
            Return now
          </button>
        </div>
      )}

      {state.showSubmitConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">Submit Exam</h2>
            <p className="text-gray-700 mb-6">
              Are you sure you want to submit your exam? This action cannot be
              undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                onClick={cancelSubmit}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                onClick={confirmSubmit}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start sm:items-center justify-between gap-2 sm:gap-4 flex-col sm:flex-row mb-4">
        <h1 className="text-2xl font-bold">{exam.title}</h1>
        <div
          className={`text-lg font-semibold ${
            state.remaining === 0 ? "text-red-600" : ""
          }`}
        >
          {`Time left: ${mm}:${ss}`}
        </div>
      </div>

      {/* Removed the time-expired paragraph that briefly showed at start */}

      <p className="text-gray-700 mb-4">{exam.description}</p>

      {state.submitted && (
        <div className="bg-white rounded shadow p-6 my-4">
          <h2 className="text-xl font-semibold mb-2">Test submitted</h2>
          {state.result && (
            <div className="text-gray-800">
              <div>
                Score:{" "}
                <span className="font-semibold">{state.result.score}</span>
              </div>
              {state.result.manualNeeded && (
                <div className="text-sm text-gray-600">
                  Some answers require manual grading. Final score may change.
                </div>
              )}
              <div className="text-sm text-gray-600">
                Submitted at:{" "}
                {state.result.submittedAt
                  ? new Date(state.result.submittedAt).toLocaleString()
                  : "-"}
              </div>
            </div>
          )}
          <div className="pt-3">
            <button
              className="bg-indigo-600 text-white px-4 py-2 rounded"
              onClick={exitAfterSubmit}
            >
              Exit test
            </button>
          </div>
        </div>
      )}

      {!state.submitted && (
        <div className="space-y-4">
          {exam.questions.map((q, idx) => (
            <div key={idx} className="bg-white rounded shadow p-4">
              <div className="font-medium mb-2 flex items-start gap-2">
                <span className="mt-0.5">Q{idx + 1}.</span>
                <div className="flex-1 overflow-x-auto"><MarkdownRenderer content={q.text} /></div>
                <span className="text-sm text-gray-500 shrink-0 mt-0.5">({q.points} pts)</span>
              </div>
              {q.type === "text" && (
                <textarea
                  className="border rounded w-full px-3 py-2"
                  rows={3}
                  value={state.answers[idx] || ""}
                  onChange={(e) => handleChange(idx, e.target.value)}
                  disabled={state.submitted}
                />
              )}
              {q.type === "single" && (
                <div className="space-y-1">
                  {(q.options || []).map((opt, oi) => (
                    <label key={oi} className="block">
                      <input
                        type="radio"
                        name={`q-${idx}`}
                        checked={state.answers[idx] === oi}
                        onChange={() => handleChange(idx, oi)}
                        disabled={state.submitted}
                      />{" "}
                      <div className="ml-2 flex-1 overflow-x-auto inline-block align-top"><MarkdownRenderer content={opt} /></div>
                    </label>
                  ))}
                </div>
              )}
              {q.type === "mcq" && (
                <div className="space-y-1">
                  {(q.options || []).map((opt, oi) => (
                    <label key={oi} className="block">
                      <input
                        type="checkbox"
                        checked={
                          Array.isArray(state.answers[idx]) &&
                          state.answers[idx].includes(oi)
                        }
                        disabled={state.submitted}
                        onChange={(e) => {
                          const prev = new Set(
                            Array.isArray(state.answers[idx])
                              ? state.answers[idx]
                              : []
                          );
                          e.target.checked ? prev.add(oi) : prev.delete(oi);
                          handleChange(
                            idx,
                            Array.from(prev).sort((a, b) => a - b)
                          );
                        }}
                      />{" "}
                      <div className="ml-2 flex-1 overflow-x-auto inline-block align-top"><MarkdownRenderer content={opt} /></div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="py-4">
        {!state.submitted ? (
          <button
            className="bg-green-600 text-white px-4 py-2 rounded"
            onClick={() => handleSubmit(false)}
          >
            Submit test
          </button>
        ) : (
          <button
            className="bg-indigo-600 text-white px-4 py-2 rounded"
            onClick={exitAfterSubmit}
          >
            Exit test
          </button>
        )}
      </div>
    </div>
  );
};

export default ExamRunner;
