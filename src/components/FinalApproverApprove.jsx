import { useEffect, useMemo, useState } from "react";
import {
  collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { useOrg } from "../context/OrgContext";
import { STATUS_LABELS, STATUS_BADGE } from "../utils/statusLabels";

export default function FinalApproverApprove() {
  const { organizationId } = useOrg();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!organizationId) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = query(
      collection(db, "overtime_requests"),
      where("organizationId", "==", organizationId),
      where("finalApproverId", "==", uid)
    );
    return onSnapshot(q, (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [organizationId]);

  const pending = useMemo(
    () => requests.filter((r) =>
      r.status === "pending_final_approver_internal" || r.status === "pending_initial_approver"
    ).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)),
    [requests]
  );
  const history = useMemo(
    () => requests.filter((r) =>
      r.status === "approved_final_approver" ||
      r.status === "rejected_final_approver" ||
      r.status === "withdrawn_internal"
    ).sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`)),
    [requests]
  );

  const approve = async (r) => {
    setBusyId(r.id);
    try {
      await updateDoc(doc(db, "overtime_requests", r.id), {
        status: "approved_final_approver",
        finalApprovedAt: serverTimestamp(),
        finalApprovedBy: auth.currentUser?.uid || null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) { alert("Failed: " + e.message); }
    finally { setBusyId(null); }
  };

  const reject = async () => {
    if (!rejecting || !reason.trim()) return;
    setBusyId(rejecting.id);
    try {
      await updateDoc(doc(db, "overtime_requests", rejecting.id), {
        status: "rejected_final_approver",
        rejectionReason: reason.trim(),
        rejectedBy: auth.currentUser?.uid || null,
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setRejecting(null); setReason("");
    } catch (e) { alert("Failed: " + e.message); }
    finally { setBusyId(null); }
  };

  if (loading) return <div className="empty-state">Loading…</div>;

  return (
    <>
      <div className="card">
        <div className="card-header-row">
          <h3 style={{ margin: 0 }}>Requests for Final Approval</h3>
          <span style={{ fontSize: 13, color: "var(--brand-gray)" }}>{pending.length} pending</span>
        </div>
        {pending.length === 0 && <div className="empty-state">No requests waiting for final approval.</div>}
        {pending.map((r) => (
          <div key={r.id} className="request-item">
            <div className="request-item-row">
              <div className="request-title">
                {r.projectCode ? `[${r.projectCode}] ` : ""}{r.projectName}
              </div>
              <span className={STATUS_BADGE[r.status]}>{STATUS_LABELS[r.status]}</span>
            </div>
            <div className="request-meta">{r.date} · {r.startTime} → {r.endTime}{r.endTime < r.startTime ? " (+1d)" : ""}</div>
            <div className="request-meta">Requestor: {r.requestorName}</div>
            <div className="request-meta"><b>Task:</b> {r.taskDescription}</div>
            <div className="request-actions">
              <button className="btn btn-primary btn-sm" onClick={() => approve(r)} disabled={busyId === r.id}>
                {busyId === r.id ? "Approving…" : "Approve"}
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => setRejecting(r)} disabled={busyId === r.id}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h3>History</h3>
          {history.map((r) => (
            <div key={r.id} className={"request-item" + (r.status.startsWith("rejected") ? " rejected" : "")}>
              <div className="request-item-row">
                <div className="request-title">
                  {r.projectCode ? `[${r.projectCode}] ` : ""}{r.projectName}
                </div>
                <span className={STATUS_BADGE[r.status]}>{STATUS_LABELS[r.status]}</span>
              </div>
              <div className="request-meta">{r.date} · {r.startTime} → {r.endTime}</div>
              {r.rejectionReason && <div className="rejection-note"><b>Reason:</b> {r.rejectionReason}</div>}
            </div>
          ))}
        </div>
      )}

      {rejecting && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reject this request</h3>
            <div className="form-group">
              <label>Rejection reason</label>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={reject} disabled={!reason.trim() || busyId === rejecting.id}>
                {busyId === rejecting.id ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}