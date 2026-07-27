import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  CATEGORIES,
  GENDER_OPTIONS,
  PAYMENT_STATUSES,
  type Attendee,
  type ImportBatch,
} from '@/lib/supabase';
import {
  FileSpreadsheet,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Download,
  Eye,
  ArrowLeft,
  Lock,
  History,
  FileUp,
} from 'lucide-react';

const FOOD_OPTIONS = ['Vegetarian', 'Non-Vegetarian', 'Not Specified'] as const;

const REQUIRED_COLS = [
  'Name',
  'Category',
  'Registration Number',
  'Food Preference',
  'Payment Status',
];
const OPTIONAL_COLS = ['Phone Number', 'Email', 'Gender'];

type ParsedRow = {
  rowNumber: number;
  registration_number: string;
  name: string;
  category: string;
  food_preference: string;
  payment_status: string;
  phone_number: string;
  email: string;
  gender: string;
  valid: boolean;
  reason: string;
};

type ImportResult = {
  batchId: string;
  fileName: string;
  totalRows: number;
  importedCount: number;
  rejectedCount: number;
  duplicateCount: number;
};

type ViewState = 'upload' | 'preview' | 'result' | 'history';

const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_FOOD = new Set<string>(FOOD_OPTIONS);
const VALID_PAYMENT = new Set<string>(PAYMENT_STATUSES);
const VALID_GENDER = new Set<string>(GENDER_OPTIONS);

export default function ExcelImportScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';

  const [view, setView] = useState<ViewState>('upload');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importedAttendees, setImportedAttendees] = useState<Attendee[]>([]);
  const [viewingImported, setViewingImported] = useState(false);

  // History state
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedBatchAttendees, setSelectedBatchAttendees] = useState<
    Attendee[]
  >([]);
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importIdRef = useRef<string | null>(null);

  const parseFile = useCallback(async (file: File) => {
    setParsing(true);
    setError('');
    setRows([]);
    setFileName(file.name);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        setError('The file does not contain any sheets.');
        setParsing(false);
        return;
      }
      const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
      });

      if (json.length === 0) {
        setError('The file contains no data rows.');
        setParsing(false);
        return;
      }

      // Normalise column names (trim, case-insensitive match)
      const colMap = buildColumnMap(json[0]);
      for (const req of REQUIRED_COLS) {
        if (!colMap[req]) {
          setError(
            `Missing required column: "${req}". Found columns: ${Object.keys(json[0]).join(', ')}`,
          );
          setParsing(false);
          return;
        }
      }

      // Fetch existing registration numbers from DB for duplicate check
      const { data: existing } = await supabase
        .from('attendees')
        .select('registration_number');
      const existingRegNos = new Set(
        (existing ?? []).map((a) => a.registration_number),
      );

      const seenInFile = new Set<string>();
      const parsed: ParsedRow[] = json.map((raw, idx) => {
        const rowNumber = idx + 2; // +1 for header, +1 for 1-indexing
        const regNo = String(raw[colMap['Registration Number']!] ?? '').trim();
        const name = String(raw[colMap['Name']!] ?? '').trim();
        const category = String(raw[colMap['Category']!] ?? '').trim();
        const food = String(raw[colMap['Food Preference']!] ?? '').trim();
        const payment = String(raw[colMap['Payment Status']!] ?? '').trim();
        const phone = String(raw[colMap['Phone Number']] ?? '').trim();
        let email = String(raw[colMap['Email']] ?? '').trim();
        const gender = String(raw[colMap['Gender']] ?? '').trim();

        // Validate
        let reason = '';
        if (!regNo) reason = 'Registration number is required';
        else if (!name) reason = 'Name is required';
        else if (!category) reason = 'Category is required';
        else if (!VALID_CATEGORIES.has(category))
          reason = `Invalid category: "${category}"`;
        else if (!food) reason = 'Food preference is required';
        else if (!VALID_FOOD.has(food))
          reason = `Invalid food preference: "${food}"`;
        else if (!payment) reason = 'Payment status is required';
        else if (!VALID_PAYMENT.has(payment))
          reason = `Invalid payment status: "${payment}"`;
        else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.toLowerCase()))
          reason = `Invalid email: "${email}"`;
        else if (gender && !VALID_GENDER.has(gender))
          reason = `Invalid gender: "${gender}"`;
        else if (seenInFile.has(regNo.toLowerCase()))
          reason = `Duplicate registration number within file: ${regNo}`;
        else if (existingRegNos.has(regNo))
          reason = `Registration number already in database: ${regNo}`;

        if (!reason) seenInFile.add(regNo.toLowerCase());
        if (email) email = email.toLowerCase();

        return {
          rowNumber,
          registration_number: regNo,
          name,
          category,
          food_preference: food,
          payment_status: payment,
          phone_number: phone,
          email,
          gender,
          valid: !reason,
          reason,
        };
      });

      setRows(parsed);
      setView('preview');
    } catch {
      setError('Unable to read the file. Please ensure it is a valid Excel or CSV file.');
    } finally {
      setParsing(false);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const downloadRejected = () => {
    if (rejectedRows.length === 0) return;
    const exportRows = rejectedRows.map((r) => ({
      'Row Number': r.rowNumber,
      'Registration Number': r.registration_number,
      Name: r.name,
      Category: r.category,
      'Food Preference': r.food_preference,
      'Payment Status': r.payment_status,
      'Phone Number': r.phone_number,
      Email: r.email,
      Gender: r.gender,
      'Rejection Reason': r.reason,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws['!cols'] = [
      { wch: 10 },
      { wch: 22 },
      { wch: 28 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
      { wch: 18 },
      { wch: 50 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rejected Rows');
    XLSX.writeFile(wb, `rejected_${fileName.replace(/\.[^.]+$/, '')}.xlsx`);
  };

  const handleImport = async () => {
    if (importing || validRows.length === 0) return;

    // Idempotency guard: prevent double import
    const importId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    if (importIdRef.current === importId) return;
    importIdRef.current = importId;

    setImporting(true);
    setError('');
    try {
      const rowsJson = validRows.map((r) => ({
        registration_number: r.registration_number,
        name: r.name,
        category: r.category,
        food_preference: r.food_preference,
        payment_status: r.payment_status,
        phone_number: r.phone_number || null,
        email: r.email || null,
        gender: r.gender || null,
      }));

      const { data, error: rpcError } = await supabase.rpc(
        'import_attendees_batch',
        { p_file_name: fileName, p_rows: rowsJson },
      );

      if (rpcError) {
        const msg = rpcError.message;
        if (msg.includes('Permission denied')) {
          setError('You do not have permission to import attendees.');
        } else if (msg.includes('duplicate key')) {
          setError(
            'One or more registration numbers already exist in the database. Please fix the duplicates and try again.',
          );
        } else {
          setError(
            'Import failed. No attendees were saved. Please check your file and try again.',
          );
        }
        importIdRef.current = null;
        return;
      }

      const res = Array.isArray(data) ? data[0] : data;
      setResult({
        batchId: res?.batch_id,
        fileName,
        totalRows: rows.length,
        importedCount: res?.imported_count ?? 0,
        rejectedCount: rejectedRows.length,
        duplicateCount,
      });
      setView('result');
      // Audit: log Excel import completion
      await supabase.rpc('log_audit', {
        p_action: 'excel_import',
        p_target_type: 'import_batch',
        p_target_id: res?.batch_id ?? null,
        p_details: {
          file_name: fileName,
          imported_count: res?.imported_count ?? 0,
          rejected_count: rejectedRows.length,
        },
      });
    } catch {
      setError('A network error occurred during import. Please try again.');
      importIdRef.current = null;
    } finally {
      setImporting(false);
    }
  };

  const viewImportedAttendees = async () => {
    if (!result?.batchId) return;
    setViewingImported(true);
    const { data } = await supabase
      .from('attendees')
      .select('*')
      .eq('import_batch_id', result.batchId)
      .order('registration_number');
    setImportedAttendees((data ?? []) as Attendee[]);
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    const { data } = await supabase
      .from('import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setBatches((data ?? []) as ImportBatch[]);
    setHistoryLoading(false);
  };

  const viewBatchAttendees = async (batch: ImportBatch) => {
    setSelectedBatch(batch);
    const { data } = await supabase
      .from('attendees')
      .select('*')
      .eq('import_batch_id', batch.id)
      .order('registration_number');
    setSelectedBatchAttendees((data ?? []) as Attendee[]);
  };

  const resetAll = () => {
    setView('upload');
    setRows([]);
    setFileName('');
    setError('');
    setResult(null);
    setImportedAttendees([]);
    setViewingImported(false);
    importIdRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (view === 'history') fetchHistory();
  }, [view]);

  if (role === 'scanner') {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1.5">
          Access Restricted
        </h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Scanner accounts cannot access Excel import. This restriction is
          enforced by both the interface and database security policies.
        </p>
      </div>
    );
  }

  const validRows = rows.filter((r) => r.valid);
  const rejectedRows = rows.filter((r) => !r.valid);
  const duplicateCount = rows.filter(
    (r) => !r.valid && r.reason.includes('Duplicate'),
  ).length;

  // ── Upload view ──
  if (view === 'upload') {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              Excel Import
            </h2>
            <p className="text-sm text-slate-500">
              Upload a spreadsheet of pre-registered attendees. Registration
              numbers are preserved exactly as in the file.
            </p>
          </div>
          <button
            onClick={() => setView('history')}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <History className="w-4 h-4" />
            Import History
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:border-teal-500 hover:bg-teal-50/30 transition cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 mb-4">
            {parsing ? (
              <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            ) : (
              <FileUp className="w-8 h-8 text-slate-400" />
            )}
          </div>
          <p className="text-sm font-medium text-slate-700 mb-1">
            {parsing ? 'Reading file…' : 'Drop a file here or click to browse'}
          </p>
          <p className="text-xs text-slate-400">
            Supports .xlsx, .xls and .csv files
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Required Format
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium text-slate-700 mb-1.5">
                Required columns
              </p>
              <ul className="space-y-1 text-slate-600">
                {REQUIRED_COLS.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-slate-700 mb-1.5">
                Optional columns
              </p>
              <ul className="space-y-1 text-slate-600">
                {OPTIONAL_COLS.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
            Accepted values — Categories: {CATEGORIES.join(', ')} · Food:{' '}
            {FOOD_OPTIONS.join(', ')} · Payment: {PAYMENT_STATUSES.join(', ')} ·
            Gender: {GENDER_OPTIONS.join(', ')}
          </div>
        </div>
      </div>
    );
  }

  // ── Preview view ──
  if (view === 'preview') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={resetAll}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Upload
          </button>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            Preview: {fileName}
          </h2>
          <p className="text-sm text-slate-500">
            Review the validation results below before confirming the import.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Total Rows"
            value={rows.length}
            icon={FileSpreadsheet}
            color="text-slate-700"
            bg="bg-slate-50"
          />
          <SummaryCard
            label="Valid"
            value={validRows.length}
            icon={CheckCircle2}
            color="text-emerald-700"
            bg="bg-emerald-50"
          />
          <SummaryCard
            label="Rejected"
            value={rejectedRows.length}
            icon={XCircle}
            color="text-red-700"
            bg="bg-red-50"
          />
          <SummaryCard
            label="Duplicates"
            value={duplicateCount}
            icon={AlertCircle}
            color="text-amber-700"
            bg="bg-amber-50"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Preview table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Row
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Reg. No.
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Name
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Category
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Food
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Payment
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Status
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.rowNumber}
                    className={r.valid ? '' : 'bg-red-50/40'}
                  >
                    <td className="px-3 py-2 text-slate-500 tabular-nums">
                      {r.rowNumber}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">
                      {r.registration_number || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{r.name || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.category || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.food_preference || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.payment_status || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.valid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium">
                          <XCircle className="w-3.5 h-3.5" />
                          Rejected
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-red-600">
                      {r.reason || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3">
            {rejectedRows.length > 0 && (
              <button
                onClick={downloadRejected}
                className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="w-4 h-4" />
                Download Rejected ({rejectedRows.length})
              </button>
            )}
          </div>
          <button
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-6 py-2.5 transition shadow-lg shadow-teal-600/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import {validRows.length} Valid Row
                {validRows.length === 1 ? '' : 's'}
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Result view ──
  if (view === 'result' && result) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">
            Import Complete
          </h2>
          <p className="text-sm text-slate-500 mb-6">{result.fileName}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <ResultStat label="Total Rows" value={result.totalRows} />
            <ResultStat
              label="Imported"
              value={result.importedCount}
              color="text-emerald-700"
            />
            <ResultStat
              label="Rejected"
              value={result.rejectedCount}
              color="text-red-700"
            />
            <ResultStat
              label="Duplicates"
              value={result.duplicateCount}
              color="text-amber-700"
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={viewImportedAttendees}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <Eye className="w-4 h-4" />
              View Imported Attendees
            </button>
            {rejectedRows.length > 0 && (
              <button
                onClick={downloadRejected}
                className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="w-4 h-4" />
                Download Rejected Rows
              </button>
            )}
            <button
              onClick={resetAll}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 text-white text-sm font-semibold px-6 py-2 transition shadow-sm"
            >
              Finish
            </button>
          </div>
        </div>

        {viewingImported && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Imported Attendees ({importedAttendees.length})
              </h3>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left border-b border-slate-200">
                    <th className="px-4 py-2 font-semibold text-slate-700">
                      Reg. No.
                    </th>
                    <th className="px-4 py-2 font-semibold text-slate-700">
                      Name
                    </th>
                    <th className="px-4 py-2 font-semibold text-slate-700">
                      Category
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {importedAttendees.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {a.registration_number}
                      </td>
                      <td className="px-4 py-2 text-slate-900">{a.name}</td>
                      <td className="px-4 py-2 text-slate-600">{a.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── History view ──
  if (view === 'history') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('upload')}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Import
          </button>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            Import History
          </h2>
          <p className="text-sm text-slate-500">
            Previous import batches and their attendees.
          </p>
        </div>

        {historyLoading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading history…
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            No imports yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700">
                        File Name
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700">
                        Date
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700">
                        Rows
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700">
                        Imported
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700">
                        Rejected
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {b.file_name}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {new Date(b.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums">
                          {b.row_count}
                        </td>
                        <td className="px-4 py-3 text-emerald-700 font-medium tabular-nums">
                          {b.imported_count}
                        </td>
                        <td className="px-4 py-3 text-red-700 tabular-nums">
                          {b.rejected_count}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => viewBatchAttendees(b)}
                            className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900 font-medium"
                          >
                            <Eye className="w-4 h-4" />
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedBatch && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Attendees from "{selectedBatch.file_name}" (
                    {selectedBatchAttendees.length})
                  </h3>
                  <button
                    onClick={() => setSelectedBatch(null)}
                    className="text-sm text-slate-500 hover:text-slate-800"
                  >
                    Close
                  </button>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-left border-b border-slate-200">
                        <th className="px-4 py-2 font-semibold text-slate-700">
                          Reg. No.
                        </th>
                        <th className="px-4 py-2 font-semibold text-slate-700">
                          Name
                        </th>
                        <th className="px-4 py-2 font-semibold text-slate-700">
                          Category
                        </th>
                        <th className="px-4 py-2 font-semibold text-slate-700">
                          Food
                        </th>
                        <th className="px-4 py-2 font-semibold text-slate-700">
                          Payment
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedBatchAttendees.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-2 font-mono text-xs text-slate-700">
                            {a.registration_number}
                          </td>
                          <td className="px-4 py-2 text-slate-900">{a.name}</td>
                          <td className="px-4 py-2 text-slate-600">
                            {a.category}
                          </td>
                          <td className="px-4 py-2 text-slate-600">
                            {a.food_preference}
                          </td>
                          <td className="px-4 py-2 text-slate-600">
                            {a.payment_status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Helpers ──

function buildColumnMap(
  row: Record<string, unknown>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    const normalised = key.trim().toLowerCase();
    if (normalised === 'name') map['Name'] = key;
    else if (normalised === 'category') map['Category'] = key;
    else if (
      normalised === 'registration number' ||
      normalised === 'registration_number' ||
      normalised === 'reg number' ||
      normalised === 'reg no' ||
      normalised === 'registration no'
    )
      map['Registration Number'] = key;
    else if (
      normalised === 'food preference' ||
      normalised === 'food_preference'
    )
      map['Food Preference'] = key;
    else if (
      normalised === 'payment status' ||
      normalised === 'payment_status'
    )
      map['Payment Status'] = key;
    else if (normalised === 'phone number' || normalised === 'phone_number')
      map['Phone Number'] = key;
    else if (normalised === 'email') map['Email'] = key;
    else if (normalised === 'gender') map['Gender'] = key;
  }
  return map;
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  icon: typeof FileSpreadsheet;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div
        className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-2`}
      >
        <Icon className={`w-4.5 h-4.5 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function ResultStat({
  label,
  value,
  color = 'text-slate-900',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
