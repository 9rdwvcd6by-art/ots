import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { STATUS_LABELS } from "./statusLabels";

const COLORS = {
  teal: [160, 82, 45],
  darkTeal: [122, 58, 30],
  orange: [200, 162, 74],
  amber: [217, 155, 61],
  dark: [43, 29, 20],
  muted: [139, 115, 85],
  border: [232, 217, 196],
  light: [248, 239, 225],
  paleTeal: [244, 228, 212],
  white: [255, 252, 246],
  red: [184, 68, 46],
  gold: [200, 162, 74],
  green: [47, 107, 63],
};

const PAGE_MARGIN = 14;

function timeToMinutes(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export function shiftHours(s, e) {
  const a = timeToMinutes(s), b = timeToMinutes(e);
  if (a === null || b === null || a === b) return 0;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return d / 60;
}

export function fmtHours(h) {
  if (!Number.isFinite(h) || h <= 0) return "0h";
  const t = Math.round(h * 60);
  const wh = Math.floor(t / 60), m = t % 60;
  if (m === 0) return `${wh}h`;
  if (wh === 0) return `${m}m`;
  return `${wh}h ${m}m`;
}

function decimal(h) { return (Number.isFinite(h) ? h : 0).toFixed(2); }
function isOvernight(s, e) {
  const a = timeToMinutes(s), b = timeToMinutes(e);
  return a !== null && b !== null && b < a;
}
function safe(v, fb = "—") {
  if (v === null || v === undefined) return fb;
  const t = String(v).trim();
  return t || fb;
}
function dispName(src, fb = "—") {
  if (src === null || src === undefined) return fb;
  if (typeof src === "object") {
    const n = safe(src.name, "") || safe(src.displayName, "") || safe(src.email, "");
    return n || fb;
  }
  return safe(src, "") || fb;
}
function compact(n) {
  const t = safe(n, "—");
  if (t === "—") return t;
  const p = t.split(/\s+/).filter(Boolean);
  return p.length <= 3 ? t : `${p[0]} ${p[p.length - 1]}`;
}
function projectLabel(r) {
  const c = safe(r?.projectCode, ""), n = safe(r?.projectName, "");
  if (c && n) return `[${c}] ${n}`;
  if (c) return `[${c}]`;
  if (n) return n;
  return "Unassigned Project";
}
function projectTableLabel(r) {
  const c = safe(r?.projectCode, ""), n = safe(r?.projectName, "");
  if (c && n) return `${c}\n${n}`;
  return c || n || "Unassigned Project";
}
function statusLabel(request) {
  const raw = safe(request?.status || request?.approvalStatus, "");
  if (!raw) return "Not specified";
  return STATUS_LABELS[raw] || raw;
}
function isRejected(s) { return typeof s === "string" && s.startsWith("rejected"); }
function normalizeAction(a) { return ["pending", "approved", "review"].includes(a) ? a : "review"; }
function sanitizeFilename(v) {
  return (String(v || "overtime_report").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "overtime_report");
}
function generatedDate() {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function drawCard(doc, x, y, w, h, label, value, color, sublabel = "") {
  doc.setFillColor(...COLORS.light); doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setFillColor(...color); doc.roundedRect(x, y, 3, h, 1, 1, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...COLORS.muted);
  doc.text(String(label).toUpperCase(), x + 6, y + 6);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...COLORS.dark);
  doc.text(String(value), x + 6, y + 14);
  if (sublabel) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...COLORS.muted);
    doc.text(sublabel, x + 6, y + 17.5);
  }
}

function drawHeader(doc, title, orgName = "") {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...COLORS.teal); doc.rect(0, 0, w, 22, "F");
  doc.setFillColor(...COLORS.darkTeal); doc.rect(0, 22, w, 1.5, "F");
  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  const org = safe(orgName, "Overtime System");
  doc.text(org.length > 44 ? `${org.slice(0, 42)}…` : org, PAGE_MARGIN, 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text("Overtime System · Request & Approval Portal", PAGE_MARGIN, 16);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  const lines = doc.splitTextToSize(safe(title, "Overtime Report"), 88);
  doc.text(lines.slice(0, 2), w - PAGE_MARGIN, 10, { align: "right" });
}

function drawFooter(doc, orgName = "") {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const total = doc.internal.getNumberOfPages();
  const org = safe(orgName, "Overtime System");
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...COLORS.border); doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, h - 13, w - PAGE_MARGIN, h - 13);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...COLORS.muted);
    doc.text(`${org} | Generated report`, PAGE_MARGIN, h - 7);
    doc.text(`Page ${p} of ${total}`, w - PAGE_MARGIN, h - 7, { align: "right" });
  }
}

function drawInfoGrid(doc, x, y, width, entries) {
  const gap = 6, colW = (width - gap) / 2, lineH = 5;
  let rowY = y, col = 0;
  entries.forEach((e) => {
    if (!e || e.value === undefined || e.value === null) return;
    const cx = x + col * (colW + gap);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...COLORS.muted);
    doc.text(String(e.label).toUpperCase(), cx, rowY);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...COLORS.dark);
    doc.text(safe(e.value, "—"), cx, rowY + 4.5);
    if (col === 1) { rowY += lineH + 4; col = 0; } else col = 1;
  });
  if (col === 1) rowY += lineH + 4;
  return rowY;
}

function prepareRequests(requests, users) {
  return requests
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const start = safe(r.startTime, ""), end = safe(r.endTime, "");
      const verifierSrc  = users[r.verifierId]  ?? r.verifierEmail  ?? null;
      const confirmerSrc = users[r.confirmerId] ?? r.confirmerEmail ?? null;
      const initialSrc   = users[r.initialApproverId] ?? r.initialApproverEmail ?? null;
      const requestorSrc = r.requestorName ?? r.requestorEmail ?? r.requestorId ?? null;
      return {
        ...r,
        date: safe(r.date, "—"),
        startTime: start,
        endTime: end,
        duration: shiftHours(start, end),
        overnight: isOvernight(start, end),
        projectLabel: projectLabel(r),
        projectTableLabel: projectTableLabel(r),
        requestorLabel: compact(dispName(requestorSrc)),
        verifierLabel:  compact(dispName(verifierSrc)),
        confirmerLabel: compact(dispName(confirmerSrc)),
        initialApproverLabel: compact(dispName(initialSrc)),
        statusLabel: statusLabel(r),
        isInternal: !!r.isInternal,
        isRejected: isRejected(r.status),
        typeLabel: r.isInternal ? "Internal" : "Requestor",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

function calcSummary(reqs) {
  const totalHours = reqs.reduce((s, r) => s + r.duration, 0);
  const overnight = reqs.filter((r) => r.overnight).length;
  const internalCount = reqs.filter((r) => r.isInternal).length;
  const internalHours = reqs.filter((r) => r.isInternal).reduce((s, r) => s + r.duration, 0);
  const requestorCount = reqs.filter((r) => !r.isInternal).length;
  const requestorHours = reqs.filter((r) => !r.isInternal).reduce((s, r) => s + r.duration, 0);
  const projects = new Set(reqs.map((r) => r.projectLabel));
  const statuses = {};
  reqs.forEach((r) => { statuses[r.statusLabel] = (statuses[r.statusLabel] || 0) + 1; });
  return { totalRequests: reqs.length, totalHours, overnightCount: overnight, projectCount: projects.size,
    internalCount, internalHours, requestorCount, requestorHours, statuses };
}

function calcProjectTotals(reqs) {
  const m = new Map();
  reqs.forEach((r) => {
    const k = r.projectLabel;
    if (!m.has(k)) m.set(k, { project: k, requests: 0, hours: 0, overnight: 0, internal: 0, internalHours: 0 });
    const t = m.get(k);
    t.requests += 1; t.hours += r.duration;
    if (r.overnight) t.overnight += 1;
    if (r.isInternal) { t.internal += 1; t.internalHours += r.duration; }
  });
  return [...m.values()].sort((a, b) => b.hours - a.hours);
}

function getTableStyles() {
  return {
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2, textColor: COLORS.dark,
      lineColor: COLORS.border, lineWidth: 0.2, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: COLORS.teal, textColor: COLORS.white, fontStyle: "bold", fontSize: 7.5, valign: "middle" },
    alternateRowStyles: { fillColor: COLORS.light },
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 18 },
  };
}

export function buildOvertimeReportPDF({
  requests = [],
  inspectors = {},
  title = "Overtime Report",
  dateRange = "",
  supervisorName = "",
  organizationName = "",
  action = "review",
  meta = {},
  download = true,
} = {}) {
  if (!Array.isArray(requests)) throw new TypeError("requests must be an array.");
  const normalizedAction = normalizeAction(action);
  const records = prepareRequests(requests, inspectors);
  const summary = calcSummary(records);
  const projectTotals = calcProjectTotals(records);
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  drawHeader(doc, title, organizationName);
  let y = 30;
  const infoEntries = [
    { label: "Organization", value: organizationName },
    { label: "Generated", value: generatedDate() },
    { label: "Date range", value: dateRange },
    { label: "Prepared by", value: supervisorName },
    { label: "Prepared for", value: meta.preparedFor },
    { label: "Total records", value: String(summary.totalRequests) },
  ].filter((e) => e.value);
  y = drawInfoGrid(doc, PAGE_MARGIN, y, pageWidth - PAGE_MARGIN * 2, infoEntries);

  if (summary.internalCount > 0) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...COLORS.gold);
    doc.text(`Includes ${summary.internalCount} internal shift${summary.internalCount === 1 ? "" : "s"} (${decimal(summary.internalHours)} h)`, PAGE_MARGIN, y);
    doc.setTextColor(...COLORS.dark); doc.setFont("helvetica", "normal");
    y += 5;
  }
  if (meta.notes) {
    doc.setFontSize(7.5); doc.setTextColor(...COLORS.muted);
    const noteLines = doc.splitTextToSize(String(meta.notes), pageWidth - PAGE_MARGIN * 2);
    doc.text(noteLines, PAGE_MARGIN, y); y += noteLines.length * 4;
    doc.setTextColor(...COLORS.dark); doc.setFontSize(8.5);
  }
  y += 4;

  const cardGap = 3.5;
  const cardWidth = (pageWidth - PAGE_MARGIN * 2 - cardGap * 3) / 4;
  const cardHeight = 20;
  drawCard(doc, PAGE_MARGIN, y, cardWidth, cardHeight, "Total Hours", fmtHours(summary.totalHours), COLORS.teal, `${summary.totalRequests} request${summary.totalRequests === 1 ? "" : "s"}`);
  drawCard(doc, PAGE_MARGIN + cardWidth + cardGap, y, cardWidth, cardHeight, "Projects", String(summary.projectCount), COLORS.orange, summary.overnightCount > 0 ? `${summary.overnightCount} overnight` : "");
  drawCard(doc, PAGE_MARGIN + (cardWidth + cardGap) * 2, y, cardWidth, cardHeight, "Requestor", fmtHours(summary.requestorHours), COLORS.darkTeal, `${summary.requestorCount} request${summary.requestorCount === 1 ? "" : "s"}`);
  drawCard(doc, PAGE_MARGIN + (cardWidth + cardGap) * 3, y, cardWidth, cardHeight, "Internal", fmtHours(summary.internalHours), COLORS.gold, `${summary.internalCount} request${summary.internalCount === 1 ? "" : "s"}`);
  y += cardHeight + 8;

  const body = records.map((r, i) => {
    const timeLabel = `${r.startTime || "—"}–${r.endTime || "—"}${r.overnight ? " (+1d)" : ""}`;
    const who = r.isInternal ? r.requestorLabel : r.requestorLabel;
    const project = r.isInternal ? `${r.projectTableLabel}\n(int)` : r.projectTableLabel;
    return [i + 1, r.date, timeLabel, decimal(r.duration), project, r.typeLabel, who, r.confirmerLabel, r.statusLabel];
  });
  if (records.length === 0) body.push(["—", "—", "—", "0.00", "No overtime requests found", "—", "—", "—", "—"]);

  autoTable(doc, {
    ...getTableStyles(), startY: y,
    head: [["#", "Date", "Time", "Hours", "Project", "Type", "Requestor", "Confirmer", "Status"]],
    body,
    columnStyles: {
      0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 19 }, 2: { cellWidth: 23 },
      3: { cellWidth: 12, halign: "right" }, 4: { cellWidth: "auto" },
      5: { cellWidth: 17, halign: "center" }, 6: { cellWidth: 24 },
      7: { cellWidth: 24 }, 8: { cellWidth: 25 },
    },
    didParseCell(data) {
      if (records.length === 0 && data.section === "body") {
        data.cell.styles.textColor = COLORS.muted; data.cell.styles.fontStyle = "italic"; return;
      }
      if (data.section !== "body") return;
      const row = records[data.row.index];
      if (!row) return;
      if (row.isRejected) data.cell.styles.fillColor = [250, 235, 232];
      if (data.column.index === 5 && row.isInternal) {
        data.cell.styles.textColor = COLORS.gold; data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 8) {
        if (row.isRejected) data.cell.styles.textColor = COLORS.red;
        else if (typeof row.status === "string" && (row.status === "approved" || row.status.startsWith("approved"))) {
          data.cell.styles.textColor = COLORS.green; data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  let sectionY = (doc.lastAutoTable?.finalY ?? y) + 8;
  if (sectionY > pageHeight - 60) { doc.addPage(); sectionY = 24; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...COLORS.dark);
  doc.text("Hours by Project", PAGE_MARGIN, sectionY); sectionY += 3;

  const projectBody = projectTotals.map((p) => [
    p.project, String(p.requests), decimal(p.hours), String(p.overnight),
    p.internal > 0 ? `${p.internal} (${decimal(p.internalHours)} h)` : "—",
  ]);
  projectBody.push(["GRAND TOTAL", String(summary.totalRequests), decimal(summary.totalHours),
    String(summary.overnightCount), `${summary.internalCount} (${decimal(summary.internalHours)} h)`]);

  autoTable(doc, {
    ...getTableStyles(), startY: sectionY,
    head: [["Project", "Requests", "Total Hours", "Overnight", "Internal"]],
    body: projectBody,
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 22, halign: "center" }, 2: { cellWidth: 25, halign: "right" }, 3: { cellWidth: 20, halign: "center" }, 4: { cellWidth: 32, halign: "center" } },
    didParseCell(data) {
      const isTotal = data.section === "body" && data.row.index === projectBody.length - 1;
      if (isTotal) {
        data.cell.styles.fillColor = COLORS.paleTeal;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = COLORS.darkTeal;
      }
    },
  });

  const statusEntries = Object.entries(summary.statuses).sort((a, b) => b[1] - a[1]);
  if (statusEntries.length > 0) {
    let sy = (doc.lastAutoTable?.finalY ?? sectionY) + 8;
    if (sy > pageHeight - 55) { doc.addPage(); sy = 24; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...COLORS.dark);
    doc.text("Status Breakdown", PAGE_MARGIN, sy); sy += 3;
    const statusBody = statusEntries.map(([label, count]) => [
      label, String(count),
      summary.totalRequests ? `${((count / summary.totalRequests) * 100).toFixed(1)}%` : "0.0%",
    ]);
    autoTable(doc, {
      ...getTableStyles(), startY: sy,
      head: [["Status", "Requests", "Share"]],
      body: statusBody,
      columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 25, halign: "center" }, 2: { cellWidth: 25, halign: "right" } },
    });
  }

  if (normalizedAction === "pending" || normalizedAction === "approved") {
    let sigY = (doc.lastAutoTable?.finalY ?? sectionY) + 12;
    if (sigY > pageHeight - 60) { doc.addPage(); sigY = 24; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...COLORS.dark);
    doc.text(normalizedAction === "pending" ? "Final Approval Section" : "Approval Confirmation", PAGE_MARGIN, sigY);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const stmt = normalizedAction === "pending"
      ? "By signing below, the initial approver and final approver confirm that the overtime hours listed in this report have been reviewed and approved."
      : "This report represents overtime records marked as approved in the Overtime System.";
    const lines = doc.splitTextToSize(stmt, pageWidth - PAGE_MARGIN * 2);
    doc.text(lines, PAGE_MARGIN, sigY + 5);
    const boxY = sigY + 13 + (lines.length - 1) * 4;
    const left = PAGE_MARGIN, right = pageWidth - PAGE_MARGIN;
    const gap = 6, fieldWidth = (right - left - gap * 3) / 4;
    const fields = [
      { label: "Initial Approver Name", x: left },
      { label: "Final Approver Name", x: left + (fieldWidth + gap) },
      { label: "Date", x: left + (fieldWidth + gap) * 2 },
      { label: "Signature", x: left + (fieldWidth + gap) * 3 },
    ];
    fields.forEach((f) => {
      doc.setDrawColor(...COLORS.muted); doc.setLineWidth(0.25);
      doc.line(f.x, boxY + 14, f.x + fieldWidth, boxY + 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...COLORS.dark);
      doc.text(f.label, f.x, boxY + 19);
    });
    if (normalizedAction === "approved") {
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(...COLORS.darkTeal);
      doc.text("Records marked approved in the Overtime System. Verify the electronic approval audit trail separately.", PAGE_MARGIN, boxY + 28);
    }
  }

  drawFooter(doc, organizationName);

  const safeTitle = sanitizeFilename(title);
  const stamp = new Date().toISOString().slice(0, 10);
  if (download) doc.save(`overtime_${safeTitle}_${stamp}.pdf`);
  return { doc, summary, projectTotals, recordCount: records.length };
}