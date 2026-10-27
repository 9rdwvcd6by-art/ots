import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs, onSnapshot,
  doc, getDoc,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { useOrg } from "../context/OrgContext";
import { STATUS_LABELS, STATUS_BADGE, isInternalStatus } from "../utils/statusLabels";

const SHIFT_START = "16:00";
const DOUBLE_TAP_MS = 320;
const DEFAULT_OPEN_HOUR = 16;

const BLOCKING_STATUSES = [
  "pending_verifier",
  "pending_confirmer",
  "pending_initial_approver",
  "approved",
];

function toEpochMinutes(dateStr, timeStr, nextDayFlag = false) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMinutes(d.getMinutes() + h * 60 + m);
  if (nextDayFlag) d.setDate(d.getDate() + 1);
  return d.getTime() / 60000;
}
function bookingRange(b) {
  return [toEpochMinutes(b.date, b.startTime, false),
          toEpochMinutes(b.date, b.endTime, b.endTime < b.startTime)];
}
function shiftHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let s = sh * 60 + sm, e = eh * 60 + em;
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}
function fmtHours(h) {
  if (!h) return "0h";
  const wh = Math.floor(h), m = Math.round((h - wh) * 60);
  return m === 0 ? `${wh}h` : `${wh}h ${m}m`;
}
function buildCalendarGrid(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startWeekday = first.getDay();
  const daysInMonth = last.getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function monthOptions() {
  const now = new Date(); const opts = [];
  for (let y = now.getFullYear() - 5; y <= now.getFullYear() + 2; y++)
    for (let m = 0; m < 12; m++) opts.push({ year: y, month: m });
  return opts;
}
function nearestFreeSlot(dateStr, durationH, busy) {
  const durationMin = Math.max(30, Math.round(durationH * 60));
  const slots = [];
  for (let mins = DEFAULT_OPEN_HOUR * 60; mins + durationMin <= 24 * 60; mins += 30) {
    const sh = String(Math.floor(mins / 60)).padStart(2, "0");
    const sm = String(mins % 60).padStart(2, "0");
    const eh = String(Math.floor((mins + durationMin) / 60)).padStart(2, "0");
    const em = String((mins + durationMin) % 60).padStart(2, "0");
    const startTime = `${sh}:${sm}`, endTime = `${eh}:${em}`;
    const s = toEpochMinutes(dateStr, startTime);
    const e = toEpochMinutes(dateStr, endTime, endTime < startTime);
    const overlaps = busy.some((b) => {
      const [bs, be] = bookingRange(b);
      return s < be && e > bs;
    });
    if (!overlaps) slots.push({ startTime, endTime });
  }
  return slots.slice(0, 3);
}
function userBelongsToProject(user, project) {
  if (!user || !project) return false;
  const uid = user.uid || user.id;
  if (!uid) return false;
  const ids = Array.isArray(user.projectIds) ? user.projectIds : [];
  if (ids.includes(project.id)) return true;
  if (Array.isArray(project.memberIds) && project.memberIds.includes(uid)) return true;
  if (project.verifierId === uid) return true;
  if (project.confirmerId === uid) return true;
  if (project.initialApproverId === uid) return true;
  if (project.finalApproverId === uid) return true;
  return false;
}

export default function RequestorForm() {
  const { organizationId } = useOrg();
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [modalDate, setModalDate] = useState(null);
  const [filterProject, setFilterProject] = useState("all");
  const [projects, setProjects] = useState([]);
  const [confirmers, setConfirmers] = useState([]);
  const [verifiers, setVerifiers] = useState([]);
  const [initialApprovers, setInitialApprovers] = useState([]);
  const [allRequests, setAllRequests] = useState([]);
  const [assignedProjectIds, setAssignedProjectIds] = useState([]);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [dayDetail, setDayDetail] = useState(null);
  const lastTap = useRef(0);
  const calendarRef = useRef(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        const profilePromise = uid ? getDoc(doc(db, "users", uid)) : Promise.resolve(null);
        const [profileSnap, ps, es, is, ss] = await Promise.all([
          profilePromise,
          getDocs(query(collection(db, "projects"), where("organizationId", "==", organizationId))),
          getDocs(query(collection(db, "users"), where("organizationId", "==", organizationId), where("role", "==", "verifier"))),
          getDocs(query(collection(db, "users"), where("organizationId", "==", organizationId), where("role", "==", "confirmer"))),
          getDocs(query(collection(db, "users"), where("organizationId", "==", organizationId), where("role", "==", "initialApprover"))),
        ]);
        if (cancelled) return;
        const ids = profileSnap?.exists?.() ? profileSnap.data().projectIds || [] : [];
        setAssignedProjectIds(Array.isArray(ids) ? ids : []);
        setProfileLoaded(true);
        setProjects(ps.docs.map((d) => ({ id: d.id, ...d.data() })));
        setVerifiers(es.docs.map((d) => ({ uid: d.id, ...d.data() })));
        setConfirmers(is.docs.map((d) => ({ uid: d.id, ...d.data() })));
        setInitialApprovers(ss.docs.map((d) => ({ uid: d.id, ...d.data() })));
      } catch (err) { console.error("RequestorForm load failed:", err); }
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    const q = query(collection(db, "overtime_requests"), where("organizationId", "==", organizationId));
    return onSnapshot(q, (snap) => {
      setAllRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [organizationId]);

  const visibleProjects = useMemo(() => {
    if (!profileLoaded) return [];
    const allowed = new Set(assignedProjectIds);
    return projects.filter((p) => allowed.has(p.id));
  }, [projects, assignedProjectIds, profileLoaded]);

  const filteredRequests = useMemo(() => {
    const allowed = new Set(assignedProjectIds);
    return allRequests
      .filter((r) => allowed.has(r.projectId || r.projectName))
      .filter((r) => filterProject === "all" ? true : (r.projectId || r.projectName) === filterProject);
  }, [allRequests, filterProject, assignedProjectIds]);

  const requestsByDate = useMemo(() => {
    const map = {};
    filteredRequests.forEach((r) => { if (!map[r.date]) map[r.date] = []; map[r.date].push(r); });
    Object.keys(map).forEach((k) => map[k].sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [filteredRequests]);

  const calendarCells = useMemo(() => buildCalendarGrid(calYear, calMonth), [calYear, calMonth]);
  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayISO = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();

  const goPrevMonth = useCallback(() => {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  }, [calMonth]);
  const goNextMonth = useCallback(() => {
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  }, [calMonth]);
  const goToday = useCallback(() => {
    const t = new Date(); setCalYear(t.getFullYear()); setCalMonth(t.getMonth());
  }, []);

  useEffect(() => {
    const node = calendarRef.current; if (!node) return;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrevMonth(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNextMonth(); }
      else if (e.key.toLowerCase() === "t") { e.preventDefault(); goToday(); }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [goPrevMonth, goNextMonth, goToday]);

  const openDayDetailOrCreate = useCallback((iso) => {
    const requests = requestsByDate[iso] || [];
    if (requests.length > 0) setDayDetail(iso); else setModalDate(iso);
  }, [requestsByDate]);

  const handleCellClick = useCallback((iso) => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0; openDayDetailOrCreate(iso);
    } else lastTap.current = now;
  }, [openDayDetailOrCreate]);

  const monthStats = useMemo(() => {
    const monthPrefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
    const monthRows = filteredRequests.filter((r) => (r.date || "").startsWith(monthPrefix));
    const totalHours = monthRows.reduce((s, r) => s + shiftHours(r.startTime, r.endTime), 0);
    const approved = monthRows.filter((r) => r.status === "approved" || r.status === "approved_final_approver").length;
    const pending = monthRows.filter((r) => r.status?.startsWith("pending")).length;
    const internal = monthRows.filter((r) => r.isInternal).length;
    return { totalHours, count: monthRows.length, approved, pending, internal };
  }, [filteredRequests, calYear, calMonth]);

  const monthPickerValue = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
  const noProjects = profileLoaded && visibleProjects.length === 0;

  return (
    <>
      <div className="card">
        <div className="card-header-row">
          <h3>Overtime Calendar</h3>
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
            style={{ maxWidth: 180, fontSize: 12, padding: "6px 8px" }}
            aria-label="Filter by project" disabled={noProjects}>
            <option value="all">All projects</option>
            {visibleProjects.map((p) => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}
          </select>
        </div>

        {noProjects && (
          <div className="empty-state" style={{ padding: "24px 16px" }}>
            You are not assigned to any project yet.
            <br />
            <span style={{ fontSize: 12, color: "var(--brand-gray)" }}>
              Please contact an administrator to be assigned.
            </span>
          </div>
        )}

        {!noProjects && (
          <>
            <div className="cal-month-stats">
              <div className="cal-month-stat"><b>{monthStats.count}</b><span>requests</span></div>
              <div className="cal-month-stat"><b>{fmtHours(monthStats.totalHours)}</b><span>hours</span></div>
              <div className="cal-month-stat cal-stat-approved"><b>{monthStats.approved}</b><span>approved</span></div>
              <div className="cal-month-stat cal-stat-pending"><b>{monthStats.pending}</b><span>pending</span></div>
            </div>

            <div className="calendar-nav" ref={calendarRef} tabIndex={0}
              aria-label="Calendar navigation — use left/right arrow keys, T for today">
              <button className="cal-nav-btn" onClick={goPrevMonth} aria-label="Previous month">‹</button>
              <div className="cal-nav-title">
                <b>{monthLabel}</b>
                <select className="cal-month-picker" value={monthPickerValue}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setCalYear(y); setCalMonth(m - 1);
                  }} aria-label="Jump to month">
                  {monthOptions().map(({ year, month }) => {
                    const v = `${year}-${String(month + 1).padStart(2, "0")}`;
                    const lbl = new Date(year, month, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
                    return <option key={v} value={v}>{lbl}</option>;
                  })}
                </select>
                <button className="cal-today-btn" onClick={goToday}>Today</button>
              </div>
              <button className="cal-nav-btn" onClick={goNextMonth} aria-label="Next month">›</button>
            </div>

            <div className="calendar-grid calendar-weekdays">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="calendar-weekday">{d}</div>
              ))}
            </div>

            <div className="calendar-grid">
              {calendarCells.map((cell, idx) => {
                if (!cell) return <div key={`blank-${idx}`} className="calendar-cell blank" />;
                const dayRequests = requestsByDate[cell.iso] || [];
                const hasRequests = dayRequests.length > 0;
                const isToday = cell.iso === todayISO;
                const isPast = cell.iso < todayISO;
                const dayHours = dayRequests.reduce((s, r) => s + shiftHours(r.startTime, r.endTime), 0);
                const approvedCount = dayRequests.filter((r) => r.status === "approved" || r.status === "approved_final_approver").length;
                const pendingCount = dayRequests.filter((r) => r.status?.startsWith("pending")).length;
                const rejectedCount = dayRequests.filter((r) => r.status?.startsWith("rejected")).length;
                const internalCount = dayRequests.filter((r) => r.isInternal).length;
                return (
                  <button key={cell.iso}
                    className={"calendar-cell" + (hasRequests ? " has-requests" : "") + (isToday ? " today" : "") + (isPast ? " past" : "")}
                    onClick={() => handleCellClick(cell.iso)}
                    title={hasRequests ? `${dayRequests.length} request(s) — double-tap for details` : "Double-tap to create a new request"}
                    aria-label={`${cell.iso}${hasRequests ? `, ${dayRequests.length} requests` : ", no requests"}`}>
                    <span className="calendar-day-num">{cell.day}</span>
                    {hasRequests && <span className="calendar-count-badge" aria-hidden="true">{dayRequests.length}</span>}
                    {hasRequests ? (
                      <>
                        <span className="calendar-day-hours">{fmtHours(dayHours)}</span>
                        <span className="calendar-dot-row">
                          {approvedCount > 0 && <span className="calendar-dot dot-green" />}
                          {pendingCount > 0 && <span className="calendar-dot dot-amber" />}
                          {rejectedCount > 0 && <span className="calendar-dot dot-red" />}
                          {internalCount > 0 && <span className="calendar-dot dot-internal" />}
                        </span>
                      </>
                    ) : (
                      <span className="calendar-add-hint">+</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="calendar-legend">
              <span><i className="calendar-dot dot-green" /> Approved</span>
              <span><i className="calendar-dot dot-amber" /> Pending</span>
              <span><i className="calendar-dot dot-red" /> Rejected</span>
              <span><i className="calendar-dot dot-internal" /> Internal</span>
              <span style={{ color: "var(--brand-primary)", fontWeight: 600 }}>Double-tap any day</span>
            </div>
          </>
        )}
      </div>

      {modalDate && !noProjects && (
        <RequestModal initialDate={modalDate}
          projects={visibleProjects}
          verifiers={verifiers}
          confirmers={confirmers}
          initialApprovers={initialApprovers}
          allRequests={allRequests}
          organizationId={organizationId}
          onClose={() => setModalDate(null)}
          onSubmitted={() => setModalDate(null)} />
      )}

      {dayDetail && (
        <DayDetailModal date={dayDetail}
          requests={requestsByDate[dayDetail] || []}
          onClose={() => setDayDetail(null)}
          onCreateNew={() => { setDayDetail(null); setModalDate(dayDetail); }} />
      )}
    </>
  );
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function FilterableSelect({ label, value, onChange, options, placeholder, required, id, renderLabel, disabled, hint }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => String(renderLabel(o)).toLowerCase().includes(q));
  }, [options, query, renderLabel]);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  if (options.length < 6) {
    return (
      <div className="form-group">
        {label && <label htmlFor={id}>{label}</label>}
        <select id={id} required={required} value={value}
          onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{renderLabel(o)}</option>)}
        </select>
        {hint && <div style={{ fontSize: 11, color: "var(--brand-gray)", marginTop: 4 }}>{hint}</div>}
      </div>
    );
  }

  return (
    <div className="form-group filterable-select" ref={wrapRef}>
      {label && <label htmlFor={id}>{label}</label>}
      <button id={id} type="button" className="filterable-select-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open} disabled={disabled}>
        {selected ? renderLabel(selected) : placeholder}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="filterable-select-pop" role="listbox">
          <input autoFocus placeholder="Type to search…" value={query}
            onChange={(e) => setQuery(e.target.value)} className="filterable-select-search" />
          <div className="filterable-select-list">
            {filtered.length === 0 && <div className="filterable-select-empty">No matches</div>}
            {filtered.map((o) => (
              <button key={o.value} type="button"
                className={"filterable-select-option" + (o.value === value ? " selected" : "")}
                onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}>
                {renderLabel(o)}
              </button>
            ))}
          </div>
        </div>
      )}
      {hint && <div style={{ fontSize: 11, color: "var(--brand-gray)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function RequestModal({ initialDate, projects, verifiers, confirmers, initialApprovers, allRequests, organizationId, onClose, onSubmitted }) {
  const [form, setForm] = useState({
    projectId: "",
    taskDescription: "",
    date: initialDate,
    startTime: "",
    endTime: "",
    verifierEmail: "",
    confirmerEmail: "",
    initialApproverEmail: "",
  });
  const [timeError, setTimeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [conflictPulse, setConflictPulse] = useState(0);
  const [dirty, setDirty] = useState(false);
  const initialFocusRef = useRef(null);
  useEscape(onClose);
  useEffect(() => { initialFocusRef.current?.focus?.(); }, []);

  const selectedProject = projects.find((p) => p.id === form.projectId);
  const selectedConfirmer = confirmers.find((u) => u.email === form.confirmerEmail);

  const memberVerifiers = useMemo(() => {
    if (!selectedProject) return [];
    return verifiers.filter((u) => userBelongsToProject(u, selectedProject));
  }, [verifiers, selectedProject]);
  const memberConfirmers = useMemo(() => {
    if (!selectedProject) return [];
    return confirmers.filter((u) => userBelongsToProject(u, selectedProject));
  }, [confirmers, selectedProject]);
  const memberInitialApprovers = useMemo(() => {
    if (!selectedProject) return [];
    return initialApprovers.filter((u) => userBelongsToProject(u, selectedProject));
  }, [initialApprovers, selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    if (form.initialApproverEmail) return;
    if (memberInitialApprovers.length !== 1) return;
    setForm((f) => ({ ...f, initialApproverEmail: memberInitialApprovers[0].email }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id, memberInitialApprovers.length]);

  const bookedSlots = useMemo(() => {
    if (!selectedConfirmer) return [];
    const prev = new Date(`${form.date}T00:00:00`); prev.setDate(prev.getDate() - 1);
    const prevStr = prev.toISOString().split("T")[0];
    const next = new Date(`${form.date}T00:00:00`); next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().split("T")[0];
    return allRequests.filter((r) =>
      r.confirmerId === selectedConfirmer.uid &&
      (r.date === form.date || r.date === nextStr || r.date === prevStr) &&
      BLOCKING_STATUSES.includes(r.status)
    );
  }, [allRequests, selectedConfirmer, form.date]);

  useEffect(() => {
    setTimeError("");
    if (!form.startTime || !form.endTime) return;
    if (form.startTime < SHIFT_START) { setTimeError("Start time must be 16:00 or later."); return; }
    if (form.startTime === form.endTime) { setTimeError("Start and end times cannot be the same."); return; }
    if (form.endTime < form.startTime && shiftHours(form.startTime, form.endTime) < 0.5) {
      setTimeError("Overnight shift must be at least 30 minutes.");
    }
  }, [form.startTime, form.endTime]);

  const conflicts = useMemo(() => {
    if (!form.startTime || !form.endTime || !form.date || timeError) return [];
    const overnight = form.endTime < form.startTime;
    const startMin = toEpochMinutes(form.date, form.startTime, false);
    const endMin = toEpochMinutes(form.date, form.endTime, overnight);
    return bookedSlots.filter((b) => {
      const [bStart, bEnd] = bookingRange(b);
      return startMin < bEnd && endMin > bStart;
    });
  }, [form.startTime, form.endTime, form.date, bookedSlots, timeError]);

  const conflict = conflicts.length > 0;
  const hasTimeIssue = !!timeError || conflict;
  useEffect(() => { if (conflict) setConflictPulse((n) => n + 1); }, [conflict, form.startTime, form.endTime]);

  const overnightHint = form.startTime && form.endTime && form.endTime < form.startTime;
  const previewHours = form.startTime && form.endTime && !hasTimeIssue ? shiftHours(form.startTime, form.endTime) : 0;

  const freeSlots = useMemo(() => {
    if (!conflict || !form.startTime || !form.endTime) return [];
    return nearestFreeSlot(form.date, shiftHours(form.startTime, form.endTime), bookedSlots);
  }, [conflict, form.startTime, form.endTime, form.date, bookedSlots]);

  const handleBackdrop = (e) => {
    if (e.target !== e.currentTarget) return;
    if (dirty && !window.confirm("Discard this request?")) return;
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const project = projects.find((p) => p.id === form.projectId);
    const verifier = verifiers.find((u) => u.email === form.verifierEmail);
    const confirmer = confirmers.find((u) => u.email === form.confirmerEmail);
    const initialApprover = initialApprovers.find((u) => u.email === form.initialApproverEmail);
    if (!project || !verifier || !confirmer || !initialApprover) {
      alert("Please select project, verifier, confirmer, and initial approver."); return;
    }
    if (timeError) { alert(timeError); return; }
    if (conflict) { alert("This time overlaps with an existing booking for the selected confirmer. Please pick a different slot."); return; }
    if (!auth.currentUser) { alert("You must be signed in to submit a request."); return; }

    const isOvernight = form.endTime < form.startTime;
    setSubmitting(true);
    try {
      await addDoc(collection(db, "overtime_requests"), {
        organizationId,
        projectId: project.id,
        projectName: project.name,
        projectCode: project.code,
        taskDescription: form.taskDescription,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        isOvernight,
        requestorId: auth.currentUser.uid,
        requestorName: auth.currentUser.email,
        verifierId: verifier.uid,
        verifierEmail: verifier.email,
        confirmerId: confirmer.uid,
        confirmerEmail: confirmer.email,
        initialApproverId: initialApprover.uid,
        initialApproverEmail: initialApprover.email,
        status: "pending_verifier",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDirty(false);
      onSubmitted(form.date);
    } catch (err) { alert("Failed to submit: " + err.message); }
    finally { setSubmitting(false); }
  };

  const projectOptions = projects.map((p) => ({ value: p.id, label: `[${p.code}] ${p.name}` }));
  const verifierOptions = memberVerifiers.map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email }));
  const confirmerOptions = memberConfirmers.map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email }));
  const initialApproverOptions = memberInitialApprovers.map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email }));

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="req-modal-title">
        <h3 id="req-modal-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>New Overtime Request</span>
          <button className="cal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </h3>
        <p className="shift-note" style={{ fontSize: 12, marginBottom: 14 }}>
          Date: <b>{form.date}</b> · Start from <b>16:00</b> · Overnight supported
        </p>

        <form onSubmit={handleSubmit}>
          <FilterableSelect id="project-select" label="Project" placeholder="-- Select Project --" required
            value={form.projectId}
            onChange={(v) => {
              setDirty(true);
              setForm((f) => {
                const proj = projects.find((p) => p.id === v);
                const autoVerifierEmail = proj?.verifierEmail || verifiers.find((e) => e.uid === proj?.verifierId)?.email || "";
                const autoInitialApproverEmail = proj?.initialApproverEmail || initialApprovers.find((s) => s.uid === proj?.initialApproverId)?.email || "";
                return { ...f, projectId: v, verifierEmail: autoVerifierEmail || "", confirmerEmail: "", initialApproverEmail: autoInitialApproverEmail || "" };
              });
            }}
            options={projectOptions} renderLabel={(o) => o.label} />

          {selectedProject && (
            <div style={{ fontSize: 11, color: "var(--brand-gray)", marginBottom: 12, padding: "6px 10px", background: "var(--brand-bg)", borderRadius: 8 }}>
              Team for this project · Verifiers: {memberVerifiers.length} ·
              Confirmers: {memberConfirmers.length} ·
              Initial Approvers: {memberInitialApprovers.length}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="task-desc">Task Description</label>
            <textarea id="task-desc" required value={form.taskDescription}
              onChange={(e) => { setDirty(true); setForm({ ...form, taskDescription: e.target.value }); }}
              ref={initialFocusRef} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="start-time">Start Time</label>
              <input id="start-time" type="time" required value={form.startTime} min={SHIFT_START}
                onChange={(e) => { setDirty(true); setForm({ ...form, startTime: e.target.value }); }}
                className={hasTimeIssue ? "input-error" : ""} aria-invalid={hasTimeIssue}
                aria-describedby={hasTimeIssue ? "time-error" : undefined} />
            </div>
            <div className="form-group">
              <label htmlFor="end-time">End Time</label>
              <input id="end-time" type="time" required value={form.endTime}
                onChange={(e) => { setDirty(true); setForm({ ...form, endTime: e.target.value }); }}
                className={hasTimeIssue ? "input-error" : ""} aria-invalid={hasTimeIssue}
                aria-describedby={hasTimeIssue ? "time-error" : undefined} />
            </div>
          </div>

          <div id="time-error" role="alert" aria-live="polite" className="time-error-region">
            {timeError && <div className="conflict-banner">⚠ {timeError}</div>}
            {!timeError && conflict && (
              <div key={conflictPulse} className="conflict-banner conflict-banner-pulse">
                <div>⚠ Time overlaps with an existing booking for <b>{selectedConfirmer?.name || selectedConfirmer?.email}</b>.</div>
                <ul className="conflict-list">
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      {c.date} · {c.startTime} → {c.endTime}{c.endTime < c.startTime ? " (+1d)" : ""}
                      {c.projectCode ? ` · [${c.projectCode}]` : ""}{c.projectName ? ` ${c.projectName}` : ""}
                    </li>
                  ))}
                </ul>
                <div className="conflict-hint">Pick a different time range or a different confirmer.</div>
                {freeSlots.length > 0 && (
                  <div className="conflict-suggest">
                    <div className="conflict-suggest-title">Try one of these instead:</div>
                    <div className="conflict-suggest-row">
                      {freeSlots.map((s) => (
                        <button key={`${s.startTime}-${s.endTime}`} type="button" className="conflict-suggest-chip"
                          onClick={() => { setForm((f) => ({ ...f, startTime: s.startTime, endTime: s.endTime })); setDirty(true); }}>
                          {s.startTime} → {s.endTime}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {previewHours > 0 && (
            <div className="hours-preview">
              <span className="hours-preview-label">Duration:</span>
              <span className="hours-preview-value">{fmtHours(previewHours)}</span>
              {overnightHint && <span className="overnight-tag"> (+1 day)</span>}
            </div>
          )}
          {overnightHint && <div className="overnight-banner">ⓘ This shift spans into the next day.</div>}

          <FilterableSelect id="confirmer-select" label="Confirmer"
            placeholder={!form.projectId ? "-- Select Project First --" : memberConfirmers.length === 0 ? "-- No confirmers assigned --" : "-- Select Confirmer --"}
            required value={form.confirmerEmail}
            onChange={(v) => { setDirty(true); setForm({ ...form, confirmerEmail: v }); }}
            options={confirmerOptions} renderLabel={(o) => o.label}
            disabled={!form.projectId || memberConfirmers.length === 0} />

          {selectedConfirmer && bookedSlots.length > 0 && (
            <div className="availability-panel" style={{ marginTop: 8 }}>
              <div className="availability-title">Bookings for <b>{selectedConfirmer.name || selectedConfirmer.email}</b>:</div>
              <div className="slot-list">
                {bookedSlots.slice().sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)).map((s) => {
                  const clashes = conflicts.some((c) => c.id === s.id);
                  return (
                    <div key={s.id} className={"slot-busy" + (clashes ? " slot-busy-conflict" : "")}>
                      <b>{s.date} · {s.startTime} → {s.endTime}{s.endTime < s.startTime ? " (+1d)" : ""}</b>
                      <span className="slot-project">{s.projectCode ? `[${s.projectCode}] ` : ""}{s.projectName}</span>
                      {clashes && <span className="slot-conflict-tag">overlaps</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <FilterableSelect id="verifier-select" label="Verifier"
            placeholder={!form.projectId ? "-- Select Project First --" : memberVerifiers.length === 0 ? "-- No verifiers assigned --" : "-- Select Verifier --"}
            required value={form.verifierEmail}
            onChange={(v) => { setDirty(true); setForm({ ...form, verifierEmail: v }); }}
            options={verifierOptions} renderLabel={(o) => o.label}
            disabled={!form.projectId || memberVerifiers.length === 0} />

          <FilterableSelect id="initial-approver-select" label="Initial Approver"
            placeholder={!form.projectId ? "-- Select Project First --" : memberInitialApprovers.length === 0 ? "-- No initial approvers assigned --" : "-- Select Initial Approver --"}
            required value={form.initialApproverEmail}
            onChange={(v) => { setDirty(true); setForm({ ...form, initialApproverEmail: v }); }}
            options={initialApproverOptions} renderLabel={(o) => o.label}
            disabled={!form.projectId || memberInitialApprovers.length === 0} />

          <div className="modal-actions modal-actions-sticky">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary"
              disabled={submitting || conflict || !!timeError || !form.projectId ||
                !form.confirmerEmail || !form.verifierEmail || !form.initialApproverEmail || !form.taskDescription.trim()}
              title={conflict ? "Resolve the time conflict first" : timeError || undefined}>
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DayDetailModal({ date, requests, onClose, onCreateNew }) {
  useEscape(onClose);
  const dayHours = requests.reduce((s, r) => s + shiftHours(r.startTime, r.endTime), 0);
  const weekday = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const requestorCount = requests.filter((r) => !r.isInternal).length;
  const internalCount = requests.filter((r) => r.isInternal).length;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="day-modal-title">
        <h3 id="day-modal-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{date}</span>
          <span style={{ fontSize: 12, color: "var(--brand-gray)", fontWeight: 500 }}>{weekday}</span>
        </h3>

        <div className="day-modal-stats">
          <div className="day-modal-stat"><div className="day-modal-stat-value">{requests.length}</div><div className="day-modal-stat-label">Requests</div></div>
          <div className="day-modal-stat"><div className="day-modal-stat-value">{fmtHours(dayHours)}</div><div className="day-modal-stat-label">Total Hours</div></div>
          <div className="day-modal-stat">
            <div className="day-modal-stat-value">{new Set(requests.map((r) => r.projectId || r.projectName)).size}</div>
            <div className="day-modal-stat-label">Projects</div>
          </div>
        </div>

        {internalCount > 0 && (
          <div style={{ fontSize: 12, color: "var(--brand-gray)", marginBottom: 10, padding: "6px 10px", background: "var(--brand-bg)", borderRadius: 8 }}>
            {requestorCount} requestor shift{requestorCount === 1 ? "" : "s"} ·{" "}
            <span style={{ color: "var(--brand-gold)", fontWeight: 600 }}>
              {internalCount} internal shift{internalCount === 1 ? "" : "s"}
            </span>
          </div>
        )}

        <div className="day-modal-list">
          {requests.map((r) => {
            const hrs = shiftHours(r.startTime, r.endTime);
            const overnight = r.endTime < r.startTime;
            const badgeClass = STATUS_BADGE[r.status] || "badge badge-pending";
            const label = STATUS_LABELS[r.status] || r.status;
            const isInternal = r.isInternal;
            return (
              <div key={r.id} className="day-modal-item"
                style={{ borderLeftColor: isInternal ? "var(--brand-gold)" : "var(--brand-primary)" }}>
                <div className="day-modal-item-head">
                  <span className="schedule-time">{r.startTime} → {r.endTime}{overnight && " (+1d)"}</span>
                  <span className={badgeClass}>{label}</span>
                </div>
                <div className="day-modal-item-title">
                  {r.projectCode ? `[${r.projectCode}] ` : ""}{r.projectName}
                  {isInternal && (
                    <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", borderRadius: 4,
                      background: "var(--brand-gold)", color: "#fff", fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.4px" }}>
                      Internal
                    </span>
                  )}
                </div>
                <div className="day-modal-item-meta"><b>{fmtHours(hrs)}</b> · {r.taskDescription}</div>
                {isInternal ? (
                  <div className="day-modal-item-meta">Requested by: {r.confirmerEmail || "Confirmer"}</div>
                ) : (
                  <div className="day-modal-item-meta">Requestor: {r.requestorName}</div>
                )}
                {r.initialApproverEmail && !isInternal && (
                  <div className="day-modal-item-meta">Initial Approver: {r.initialApproverEmail}</div>
                )}
                {r.rejectionReason && (
                  <div className="rejection-note" style={{ marginTop: 6 }}>
                    <b>Rejected:</b> {r.rejectionReason}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={onCreateNew}>+ Add Request on This Day</button>
        </div>
      </div>
    </div>
  );
}