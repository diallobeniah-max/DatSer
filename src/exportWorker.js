/*
 * exportWorker.js
 * Web Worker used by ExportCenterPage to generate large CSV / attendance exports
 * without blocking the UI thread. It receives a message with the required data
 * and posts back the generated Blob URL (or raw string) once finished.
 */

// Helper to escape CSV cells
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

// Build CSV string for full export
function buildFullExport({ rows, columns, selectedMonths, selectedSundays, attendanceData, reportHeaderLines, summary, exportMode }) {
  const attendanceHeaders = selectedSundays.map(s => `${s.table.replace('_', ' ')} ${s.label}`);
  const header = [...columns, 'Month', ...attendanceHeaders];
  const monthsList = selectedMonths.map(t => t.replace('_', ' ')).join(', ');

  // prepend meta lines (same logic as component)
  const metaLines = [];
  metaLines.push(`EXPORT: ${monthsList}`);
  metaLines.push('');
  metaLines.push([
    csvCell(`Members: ${rows.length}`),
    csvCell(`Marked members: ${summary.markedMembers}`),
    csvCell(`Attendance marks: ${summary.markedAttendance}`),
    csvCell(`Sundays: ${summary.sundayCount}`),
    csvCell(`Generated: ${new Date().toLocaleDateString()}`)
  ].join(','));
  metaLines.push('');
  metaLines.push(reportHeaderLines.map(csvCell).join(','));
  metaLines.push('');

  const lines = [];
  lines.push(header.map(csvCell).join(','));
  rows.forEach(row => {
    const memberCells = columns.map(col => {
      const value = row[col] ?? '';
      // Normalization mirrors component's normalizeExportCell (simplified)
      if (col === 'Gender') {
        const v = String(value).trim().toLowerCase();
        if (v === 'm' || v === 'male') return csvCell('Male');
        if (v === 'f' || v === 'female') return csvCell('Female');
        return csvCell(value);
      }
      if (col === 'Current Level') {
        return csvCell(String(value).trim().toUpperCase());
      }
      if (col === 'Phone Number' || col === 'Parent Phone Number') {
        const digits = String(value).replace(/\D/g, '');
        let phone = '';
        if (digits.startsWith('233') && digits.length >= 12) phone = `0${digits.slice(3)}`;
        else if (digits.startsWith('0')) phone = digits;
        else if (digits) phone = `0${digits}`;
        return csvCell(phone);
      }
      return csvCell(value);
    });
    const monthCell = csvCell(row._month.replace('_', ' '));
    const attendanceCells = selectedSundays.map(sunday => {
      const colKey = sunday.columnKey;
      const legacyKey = sunday.legacyColumnKey;
      const val = row[colKey] ?? row[legacyKey] ?? '';
      const norm = (val === true || val === 'true' || String(val).toLowerCase() === 'present' || String(val).toLowerCase() === 'p')
        ? 'P'
        : (val === false || val === 'false' || String(val).toLowerCase() === 'absent' || String(val).toLowerCase() === 'a')
          ? 'A' : '-';
      return csvCell(norm);
    });
    lines.push([...memberCells, monthCell, ...attendanceCells].join(','));
  });

  return metaLines.concat(lines).join('\n');
}

// Build CSV for attendance‑only export
function buildAttendanceOnly({ rows, selectedSundays, attendanceData, reportHeaderLines, selectedMonths }) {
  const attendanceRecords = [];
  rows.forEach(row => {
    const name = row['Full Name'] ?? 'Unknown';
    selectedSundays.forEach(sunday => {
      const value = row[sunday.columnKey] ?? row[sunday.legacyColumnKey] ?? row[sunday.dateKey];
      const norm = (value === true || value === 'true' || String(value).toLowerCase() === 'present' || String(value).toLowerCase() === 'p')
        ? 'Present'
        : (value === false || value === 'false' || String(value).toLowerCase() === 'absent' || String(value).toLowerCase() === 'a')
          ? 'Absent' : null;
      if (norm) {
        attendanceRecords.push({
          name,
          month: row._month.replace('_', ' '),
          date: sunday.dateKey,
          status: norm
        });
      }
    });
  });

  attendanceRecords.sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.name.localeCompare(b.name));
  const monthsList = selectedMonths.map(m => m.replace('_', ' ')).join(', ');
  const lines = [];
  lines.push([`ATTENDANCE EXPORT: ${monthsList}`, '', '', `Generated: ${new Date().toLocaleDateString()}`].join(','));
  lines.push([`Total Records`, attendanceRecords.length].join(','));
  lines.push(reportHeaderLines.map(csvCell).join(','));
  lines.push('');
  lines.push(['Member Name', 'Month', 'Date', 'Status'].map(csvCell).join(','));
  attendanceRecords.forEach(rec => {
    lines.push([rec.name, rec.month, rec.date, rec.status].map(csvCell).join(','));
  });
  return lines.join('\n');
}

self.addEventListener('message', (e) => {
  const { type, payload } = e.data;
  try {
    let csv = '';
    if (type === 'fullExport') {
      csv = buildFullExport(payload);
    } else if (type === 'attendanceOnly') {
      csv = buildAttendanceOnly(payload);
    } else {
      throw new Error('Unsupported export type');
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    self.postMessage({ success: true, url, filename: payload.filename });
  } catch (err) {
    self.postMessage({ success: false, error: err.message });
  }
});
