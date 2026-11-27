'use client';

/**
 * Employees from Excel: download a template (with drop-down lists of your departments, positions and areas),
 * fill it in, upload it, check the preview, import. Each row goes through the normal employee API, so the same
 * checks, device sync and audit log apply as when adding someone by hand. Existing codes are updated.
 */
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Alert, Modal, Spinner, useToast } from './ui';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { api, ApiError } from '@/lib/api';
import { buildTemplate, COLUMNS, loadExcel, parseWorkbook, saveBlob, type ParsedRow, type RowStatus } from '@/lib/employee-excel';
import type { OrgUnit } from '@/lib/types';

// ---------------------------------------------------------------- the window

type Step = 'start' | 'preview' | 'importing' | 'done';

export function EmployeeImportModal({ open, onClose, onImported, departmentRequired }: { open: boolean; onClose: () => void; onImported: () => void; departmentRequired: boolean }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('start');
  const [busy, setBusy] = useState<'template' | 'reading' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<'all' | RowStatus>('all');

  function reset() {
    setStep('start');
    setError(null);
    setFileName('');
    setRows([]);
    setProgress(0);
    setFilter('all');
    if (fileInput.current) fileInput.current.value = '';
  }
  function close() {
    if (step === 'importing') return;
    reset();
    onClose();
  }

  const loadLists = async () => {
    const [d, p, a] = await Promise.all([
      api<{ data: OrgUnit[] }>('/departments/all'),
      api<{ data: OrgUnit[] }>('/positions/all'),
      api<{ data: OrgUnit[] }>('/areas/all'),
    ]);
    return { departments: d.data, positions: p.data, areas: a.data };
  };

  async function downloadTemplate() {
    setBusy('template');
    setError(null);
    try {
      saveBlob(await buildTemplate(await loadLists()), 'employees-import-template.xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the template');
    } finally {
      setBusy(null);
    }
  }

  async function readFile(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Please choose an Excel file (.xlsx). In Excel: File > Save As > Excel Workbook.');
      return;
    }
    setBusy('reading');
    setError(null);
    setFileName(file.name);
    try {
      const [lists, all] = await Promise.all([loadLists(), api<{ data: { id: number; emp_code: string }[] }>('/employees/all')]);
      const existing = new Map(all.data.map((e) => [String(e.emp_code).toLowerCase(), e.id]));
      const parsed = await parseWorkbook(await file.arrayBuffer(), { ...lists, existing, departmentRequired });
      if (!parsed.length) throw new Error('No employees found in the file. Fill in rows under the header on the "Employees" sheet.');
      setRows(parsed);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file');
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    const todo = rows.filter((r) => r.status === 'new' || (r.status === 'update' && updateExisting));
    setStep('importing');
    setProgress(0);
    let done = 0;
    const results = new Map<number, ParsedRow['result']>();
    // A few at a time: fast, without flooding the server or BioTime
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, todo.length) }, async () => {
        while (next < todo.length) {
          const r = todo[next++]!;
          try {
            if (r.status === 'update' && r.existingId) {
              const { emp_code: _code, ...patch } = r.body;
              await api(`/employees/${r.existingId}`, { method: 'PATCH', body: patch });
            } else {
              await api('/employees', { method: 'POST', body: r.body });
            }
            results.set(r.line, { ok: true });
          } catch (err) {
            const fields = err instanceof ApiError && err.fields ? ` (${Object.entries(err.fields).map(([k, v]) => `${k}: ${v}`).join('; ')})` : '';
            results.set(r.line, { ok: false, message: `${err instanceof Error ? err.message : 'Failed'}${fields}` });
          }
          done++;
          setProgress(Math.round((done / todo.length) * 100));
        }
      }),
    );
    setRows((list) => list.map((r) => (results.has(r.line) ? { ...r, result: results.get(r.line) } : r.status === 'update' && !updateExisting ? { ...r, status: 'skip' } : r)));
    const ok = [...results.values()].filter((x) => x?.ok).length;
    const failed = results.size - ok;
    setStep('done');
    onImported();
    toast(failed ? `${ok} imported, ${failed} failed` : `${ok} employee${ok === 1 ? '' : 's'} imported`, failed ? 'error' : 'success');
  }

  async function downloadErrors() {
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employees');
    ws.columns = [...COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width })), { header: 'Problem', key: '_problem', width: 60 }];
    ws.getRow(1).font = { bold: true };
    for (const r of rows.filter((x) => x.status === 'error' || x.result?.ok === false)) {
      ws.addRow({ ...r.values, _problem: r.errors.length ? r.errors.join('; ') : r.result?.message });
    }
    saveBlob(await wb.xlsx.writeBuffer(), 'employees-import-problems.xlsx');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void readFile(f);
  }

  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const toImport = count('new') + (updateExisting ? count('update') : 0);
  const imported = rows.filter((r) => r.result?.ok).length;
  const failed = rows.filter((r) => r.result?.ok === false).length;
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <Modal
      open={open}
      wide
      title="Import employees from Excel"
      onClose={close}
      footer={
        step === 'preview' ? (
          <>
            <button className="btn-secondary" onClick={reset}>
              <RefreshCw className="size-4" />
              Choose another file
            </button>
            <button className="btn-primary" onClick={runImport} disabled={toImport === 0}>
              <Upload className="size-4" />
              Import {toImport} employee{toImport === 1 ? '' : 's'}
            </button>
          </>
        ) : step === 'done' ? (
          <>
            {(failed > 0 || count('error') > 0) && (
              <button className="btn-secondary" onClick={downloadErrors}>
                <Download className="size-4" />
                Download problem rows
              </button>
            )}
            <button className="btn-primary" onClick={close}>
              Done
            </button>
          </>
        ) : step === 'start' ? (
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
        ) : null
      }
    >
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {step === 'start' && (
        <div className="space-y-4">
          <div className="flex items-start gap-4 rounded-xl border border-slate-200 p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">1</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900">Download the template</div>
              <p className="mt-0.5 text-sm text-slate-500">
                An Excel file with the right columns, drop-down lists of your departments, positions and areas, and instructions.
              </p>
              <button className="btn-secondary mt-3" onClick={downloadTemplate} disabled={busy !== null}>
                {busy === 'template' ? <Spinner className="h-4 w-4" /> : <FileSpreadsheet className="size-4 text-green-700" />}
                Download template (.xlsx)
              </button>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-xl border border-slate-200 p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">2</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900">Fill it in and upload it</div>
              <p className="mt-0.5 text-sm text-slate-500">One employee per row. You’ll see a preview with any problems before anything is saved.</p>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInput.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
                className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
                  dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                {busy === 'reading' ? (
                  <>
                    <Spinner className="h-6 w-6 text-brand-600" />
                    <p className="mt-2 text-sm text-slate-600">Reading {fileName}…</p>
                  </>
                ) : (
                  <>
                    <Upload className="size-6 text-slate-400" />
                    <p className="mt-2 text-sm font-medium text-slate-700">Drop the filled-in file here, or click to choose</p>
                    <p className="text-xs text-slate-500">Excel workbook (.xlsx)</p>
                  </>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {(step === 'preview' || step === 'importing' || step === 'done') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileSpreadsheet className="size-4 text-green-700" />
            <span className="font-medium text-slate-800">{fileName}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">{rows.length} rows</span>
          </div>

          {step === 'importing' && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-brand-900">
                <Spinner className="h-4 w-4 text-brand-600" />
                Importing… {progress}%
              </div>
              <Progress value={progress} className="h-2" />
              <p className="mt-2 text-xs text-brand-800">Keep this window open until it finishes.</p>
            </div>
          )}

          {step === 'done' && (
            <div className={`flex items-start gap-3 rounded-lg border p-4 ${failed ? 'border-amber-200 bg-amber-50' : 'border-brand-200 bg-brand-50'}`}>
              {failed ? <AlertCircle className="mt-0.5 size-5 text-amber-700" /> : <CheckCircle2 className="mt-0.5 size-5 text-brand-700" />}
              <div className="text-sm">
                <div className="font-semibold text-slate-900">
                  {imported} imported{failed ? `, ${failed} failed` : ''}
                  {count('error') ? `, ${count('error')} skipped (problems in the file)` : ''}
                </div>
                <div className="text-slate-600">New employees are being sent to your devices. Download the problem rows to fix and import them again.</div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryTile label="New employees" value={count('new')} tone="good" active={filter === 'new'} onClick={() => setFilter(filter === 'new' ? 'all' : 'new')} />
              <SummaryTile label="Already exist (update)" value={count('update')} tone="info" active={filter === 'update'} onClick={() => setFilter(filter === 'update' ? 'all' : 'update')} />
              <SummaryTile label="Have problems (skipped)" value={count('error')} tone="bad" active={filter === 'error'} onClick={() => setFilter(filter === 'error' ? 'all' : 'error')} />
            </div>
          )}

          {step === 'preview' && count('update') > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              Update the {count('update')} employee{count('update') === 1 ? '' : 's'} that already exist with the values in the file
            </label>
          )}

          <div className="max-h-[22rem] overflow-auto rounded-lg border border-slate-200">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-14">Row</th>
                  <th>Status</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Problem / result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular-nums text-slate-500">{r.line}</td>
                    <td>
                      <RowBadge r={r} />
                    </td>
                    <td className="font-mono text-xs">{r.values.emp_code || '—'}</td>
                    <td>{[r.values.first_name, r.values.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td className="text-slate-600">{r.values.department || '—'}</td>
                    <td className="max-w-[22rem] whitespace-normal text-xs">
                      {r.errors.length ? (
                        <span className="text-red-600">{r.errors.join(' · ')}</span>
                      ) : r.result ? (
                        r.result.ok ? (
                          <span className="text-green-700">Saved</span>
                        ) : (
                          <span className="text-red-600">{r.result.message}</span>
                        )
                      ) : (
                        <span className="text-slate-400">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SummaryTile({ label, value, tone, active, onClick }: { label: string; value: number; tone: 'good' | 'info' | 'bad'; active: boolean; onClick: () => void }) {
  const color = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-sky-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition ${active ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'}`}
      title="Show only these rows"
    >
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </button>
  );
}

function RowBadge({ r }: { r: ParsedRow }) {
  if (r.result) return r.result.ok ? <Badge className="bg-green-50 text-green-700">Saved</Badge> : <Badge className="bg-red-50 text-red-700">Failed</Badge>;
  if (r.status === 'new') return <Badge className="bg-green-50 text-green-700">New</Badge>;
  if (r.status === 'update') return <Badge className="bg-sky-50 text-sky-700">Update</Badge>;
  if (r.status === 'skip') return <Badge className="bg-slate-100 text-slate-500">Skipped</Badge>;
  return <Badge className="bg-red-50 text-red-700">Problem</Badge>;
}
