import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
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
  FileText,
  Sparkles,
} from 'lucide-react';

const FOOD_OPTIONS = ['Vegetarian', 'Non-Vegetarian', 'Not Specified'] as const;

type ParsedRow = {
  rowNumber: number;
  registration_number: string;
  is_auto_reg: boolean;
  name: string;
  category: string;
  food_preference: string;
  payment_status: string;
  phone_number: string;
  email: string;
  gender: string;
  medical_council_number: string;
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
  const [selectedBatchAttendees, setSelectedBatchAttendees] = useState<Attendee[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importIdRef = useRef<string | null>(null);

  const parseFile = useCallback(async (file: File) => {
    setParsing(true);
    setError('');
    setRows([]);
    setFileName(file.name);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      let rawRecords: Record<string, unknown>[] = [];

      if (ext === 'docx') {
        rawRecords = await parseDocx(file);
      } else if (ext === 'doc') {
        rawRecords = await parseDoc(file);
      } else if (ext === 'txt') {
        const text = await file.text();
        rawRecords = parseTextLines(text);
      } else {
        // .xlsx, .xls, .csv and others
        rawRecords = await parseExcelOrCsv(file);
      }

      if (rawRecords.length === 0) {
        setError('No readable attendee rows found in the uploaded file.');
        setParsing(false);
        return;
      }

      // Fetch existing registration numbers from DB
      const { data: existing } = await supabase
        .from('attendees')
        .select('registration_number');
      
      const existingRegNos = new Set<string>();
      let maxRegNum = 2000;
      
      (existing ?? []).forEach((a: { registration_number?: string }) => {
        const numStr = (a.registration_number || '').trim().toUpperCase();
        if (numStr) existingRegNos.add(numStr);
        const match = numStr.match(/(\d+)/g);
        if (match) {
          for (const m of match) {
            const n = parseInt(m, 10);
            if (n >= 1000 && n < 99999 && n > maxRegNum) {
              maxRegNum = n;
            }
          }
        }
      });

      const colMap = buildColumnMap(rawRecords[0]);
      const seenInFile = new Set<string>();

      const parsed: ParsedRow[] = rawRecords.map((raw, idx) => {
        const rowNumber = idx + 1;
        let name = colMap['Name'] ? String(raw[colMap['Name']] ?? '').trim() : '';

        // If name column wasn't matched, try first available non-empty text value in row
        if (!name) {
          for (const val of Object.values(raw)) {
            const s = String(val ?? '').trim();
            if (/[a-zA-Z]{2,}/.test(s) && !s.includes('@') && !/^\d+$/.test(s)) {
              name = s;
              break;
            }
          }
        }

        // Phone Number
        let phone = colMap['Phone Number'] ? String(raw[colMap['Phone Number']] ?? '').trim() : '';
        if (!phone) {
          for (const val of Object.values(raw)) {
            const s = String(val ?? '').trim();
            if (/(?:\+?91[\s-]?)?[6789]\d{9}/.test(s)) {
              phone = s;
              break;
            }
          }
        }

        // Registration Number
        let regNo = colMap['Registration Number'] ? String(raw[colMap['Registration Number']] ?? '').trim() : '';
        let isAutoReg = false;

        // Auto-generate registration number if missing or empty
        if (!regNo) {
          maxRegNum++;
          regNo = `PMCON-${maxRegNum}`;
          isAutoReg = true;
        } else {
          // If duplicate within file or exists in DB, safely allocate a unique one
          const upperReg = regNo.toUpperCase();
          if (seenInFile.has(upperReg) || existingRegNos.has(upperReg)) {
            maxRegNum++;
            regNo = `PMCON-${maxRegNum}`;
            isAutoReg = true;
          }
        }
        seenInFile.add(regNo.toUpperCase());

        // Category (Defaults to 'Delegates')
        const rawCat = colMap['Category'] ? String(raw[colMap['Category']] ?? '').trim() : '';
        const category = normalizeCategory(rawCat);

        // Food Preference (Defaults to 'Not Specified')
        const rawFood = colMap['Food Preference'] ? String(raw[colMap['Food Preference']] ?? '').trim() : '';
        const food = normalizeFood(rawFood);

        // Payment Status (Defaults to 'Paid')
        const rawPayment = colMap['Payment Status'] ? String(raw[colMap['Payment Status']] ?? '').trim() : '';
        const payment = normalizePayment(rawPayment);

        // Email (Optional)
        let email = colMap['Email'] ? String(raw[colMap['Email']] ?? '').trim() : '';
        if (email && !email.includes('@')) {
          email = '';
        } else if (email) {
          email = email.toLowerCase();
        }

        // Gender (Optional)
        const rawGender = colMap['Gender'] ? String(raw[colMap['Gender']] ?? '').trim() : '';
        const gender = normalizeGender(rawGender);

        // Medical Council Number (Optional)
        const councilNo = colMap['Medical Council Number']
          ? String(raw[colMap['Medical Council Number']] ?? '').trim()
          : '';

        // Validation rule: As requested by user, only attendee Name is required!
        // Missing fields (Category, Food, Payment, Reg No, Phone, etc.) are 100% accepted and auto-completed.
        let valid = true;
        let reason = '';

        if (!name) {
          valid = false;
          reason = 'Attendee name is missing in row';
        }

        return {
          rowNumber,
          registration_number: regNo,
          is_auto_reg: isAutoReg,
          name,
          category,
          food_preference: food,
          payment_status: payment,
          phone_number: phone,
          email,
          gender,
          medical_council_number: councilNo,
          valid,
          reason,
        };
      });

      // Filter out completely blank lines
      const nonBlank = parsed.filter((r) => r.name || r.phone_number || !r.is_auto_reg);
      if (nonBlank.length === 0) {
        setError('No valid attendee records could be extracted from this file.');
        setParsing(false);
        return;
      }

      setRows(nonBlank);
      setView('preview');
    } catch (err: any) {
      console.error('File parsing error:', err);
      setError(`Unable to parse the file: ${err?.message || 'Unsupported format'}. Please try another file.`);
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
      'Medical Council No': r.medical_council_number,
      'Rejection Reason': r.reason,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rejected Rows');
    XLSX.writeFile(wb, `rejected_${fileName.replace(/\.[^.]+$/, '')}.xlsx`);
  };

  const handleImport = async () => {
    if (importing || validRows.length === 0) return;

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
        medical_council_number: r.medical_council_number || null,
      }));

      const { data, error: rpcError } = await supabase.rpc(
        'import_attendees_batch',
        { p_file_name: fileName, p_rows: rowsJson },
      );

      if (rpcError) {
        const msg = rpcError.message || '';
        if (msg.includes('Permission denied')) {
          setError('You do not have permission to import attendees.');
        } else if (msg.includes('duplicate key')) {
          setError(
            'One or more registration numbers already exist in the database. Please check and try again.',
          );
        } else {
          setError(
            msg
              ? `Import failed: ${msg}`
              : 'Import failed. Please verify your file data and try again.',
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
        importedCount: res?.imported_count ?? validRows.length,
        rejectedCount: rejectedRows.length,
        duplicateCount,
      });
      setView('result');

      // Audit log
      await supabase.rpc('log_audit', {
        p_action: 'excel_import',
        p_target_type: 'import_batch',
        p_target_id: res?.batch_id ?? null,
        p_details: {
          file_name: fileName,
          total_rows: rows.length,
          imported: res?.imported_count ?? validRows.length,
          rejected: rejectedRows.length,
        },
      });
    } catch (err: any) {
      console.error('Import failed:', err);
      setError('An unexpected error occurred during import. Please try again.');
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
      .eq('import_batch_id', result.batchId);
    setImportedAttendees(data ?? []);
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('import_batches')
        .select('*')
        .order('created_at', { ascending: false });
      setBatches(data ?? []);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  };

  const viewBatchAttendees = async (batch: ImportBatch) => {
    setSelectedBatch(batch);
    const { data } = await supabase
      .from('attendees')
      .select('*')
      .eq('import_batch_id', batch.id);
    setSelectedBatchAttendees(data ?? []);
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
          Scanner accounts cannot access bulk import. This restriction is
          enforced by both the interface and security policies.
        </p>
      </div>
    );
  }

  const validRows = rows.filter((r) => r.valid);
  const rejectedRows = rows.filter((r) => !r.valid);
  const duplicateCount = rows.filter(
    (r) => !r.valid && r.reason.toLowerCase().includes('duplicate'),
  ).length;

  // ── Upload view ──
  if (view === 'upload') {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              Bulk Attendee Import
            </h2>
            <p className="text-sm text-slate-500">
              Upload attendee files in Excel, Word (.docx/.doc), CSV, or Text format. Missing fields are automatically completed.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <a
              href="/mock_attendees_50.xlsx"
              download="mock_attendees_50.xlsx"
              className="flex items-center gap-2 rounded-lg bg-teal-50 border border-teal-200 px-3.5 py-2 text-sm font-medium text-teal-800 hover:bg-teal-100 transition shadow-xs"
            >
              <Download className="w-4 h-4 text-teal-600" />
              Download 50 Test Attendees (.xlsx)
            </a>
            <button
              onClick={() => setView('history')}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <History className="w-4 h-4" />
              Import History
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-teal-300 bg-gradient-to-b from-teal-50/20 to-slate-50 rounded-2xl p-10 text-center hover:border-teal-500 hover:bg-teal-50/40 transition cursor-pointer group"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.docx,.doc,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-100 group-hover:bg-teal-200 text-teal-700 mb-4 transition">
            {parsing ? (
              <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            ) : (
              <FileUp className="w-8 h-8" />
            )}
          </div>
          <p className="text-base font-semibold text-slate-800 mb-1">
            {parsing ? 'Reading and extracting attendee data…' : 'Drop attendee file here or click to browse'}
          </p>
          <p className="text-xs text-slate-500 mb-3">
            Supports <span className="font-semibold text-teal-700">Excel (.xlsx, .xls)</span>, <span className="font-semibold text-blue-700">Word (.docx, .doc)</span>, <span className="font-semibold text-slate-700">CSV (.csv)</span>, and <span className="font-semibold text-slate-700">Text (.txt)</span>
          </p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Forgiving Parser: Even if 1, 2, or 3 fields are missing, details will be auto-completed!
          </div>
        </div>

        {/* Guidelines Box */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-600" />
            Smart Auto-Fill & Tolerant Column Rules
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-3">
              <p className="font-semibold text-emerald-900 mb-1.5">
                Required Field
              </p>
              <ul className="space-y-1 text-emerald-800">
                <li className="flex items-center gap-1.5 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                  Name / Attendee Name (essential to identify attendee)
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="font-semibold text-slate-800 mb-1.5">
                Optional & Auto-Defaulted Fields
              </p>
              <ul className="space-y-1 text-slate-600">
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  Registration No: <span className="text-slate-500">Auto-generated (PMCON-xxxx) if missing</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  Category: <span className="text-slate-500">Defaults to Delegates</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  Food Preference: <span className="text-slate-500">Defaults to Not Specified</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  Payment Status: <span className="text-slate-500">Defaults to Paid</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  Phone, Email, Gender, Medical Council No: <span className="text-slate-500">Captured if present</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap gap-2">
            <span>Recognized Categories: <strong className="text-slate-700">{CATEGORIES.join(', ')}</strong></span>
            <span>· Food: <strong className="text-slate-700">Vegetarian, Non-Vegetarian, Not Specified</strong></span>
          </div>
        </div>
      </div>
    );
  }

  // ── Preview view ──
  if (view === 'preview') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <button
            onClick={resetAll}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Upload Another File
          </button>
          <span className="text-xs text-slate-400 font-mono">{fileName}</span>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-0.5">
            File Preview & Data Extraction
          </h2>
          <p className="text-sm text-slate-500">
            Review the extracted attendee details. All valid rows will be saved to your attendee database.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Total Extracted"
            value={rows.length}
            icon={FileSpreadsheet}
            color="text-slate-700"
            bg="bg-slate-100"
          />
          <SummaryCard
            label="Ready to Import"
            value={validRows.length}
            icon={CheckCircle2}
            color="text-emerald-700"
            bg="bg-emerald-100"
          />
          <SummaryCard
            label="Auto-Generated Reg Nos"
            value={rows.filter((r) => r.is_auto_reg).length}
            icon={Sparkles}
            color="text-teal-700"
            bg="bg-teal-100"
          />
          <SummaryCard
            label="Rejected Rows"
            value={rejectedRows.length}
            icon={XCircle}
            color="text-red-700"
            bg="bg-red-100"
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
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase font-semibold text-slate-600">
                  <th className="px-3 py-2.5">Row</th>
                  <th className="px-3 py-2.5">Reg. No.</th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Phone</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Food</th>
                  <th className="px-3 py-2.5">Payment</th>
                  <th className="px-3 py-2.5">Council No</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {rows.map((r) => (
                  <tr
                    key={r.rowNumber}
                    className={r.valid ? 'hover:bg-slate-50/60' : 'bg-red-50/40'}
                  >
                    <td className="px-3 py-2 text-slate-500 tabular-nums">
                      {r.rowNumber}
                    </td>
                    <td className="px-3 py-2 font-mono font-medium text-slate-800">
                      <div className="flex items-center gap-1">
                        <span>{r.registration_number}</span>
                        {r.is_auto_reg && (
                          <span className="text-[10px] bg-teal-100 text-teal-800 px-1 py-0.2 rounded font-sans font-semibold">
                            Auto
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {r.name || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">
                      {r.phone_number || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.category || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.food_preference || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700">
                        {r.payment_status || 'Paid'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.medical_council_number || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.valid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 font-medium" title={r.reason}>
                          <XCircle className="w-3.5 h-3.5" />
                          {r.reason}
                        </span>
                      )}
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
                Importing {validRows.length} Attendees…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Confirm & Import {validRows.length} Attendee{validRows.length === 1 ? '' : 's'}
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
          <h2 className="text-xl font-bold text-slate-900 mb-1">
            Import Completed Successfully!
          </h2>
          <p className="text-sm text-slate-500 mb-6">{result.fileName}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <ResultStat label="Total Processed" value={result.totalRows} />
            <ResultStat
              label="Successfully Added"
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
              View Added Attendees
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
              Finish & Import More
            </button>
          </div>
        </div>

        {viewingImported && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Imported Attendees ({importedAttendees.length})
              </h3>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs font-semibold text-slate-600 uppercase">
                  <tr className="text-left border-b border-slate-200">
                    <th className="px-4 py-2.5">Reg. No.</th>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Category</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {importedAttendees.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2 font-mono font-medium text-slate-800">
                        {a.registration_number}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{a.name}</td>
                      <td className="px-4 py-2 text-slate-600">{a.phone_number || '—'}</td>
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
          <div className="text-center py-12 text-slate-500 text-sm bg-white rounded-xl border border-slate-200">
            No bulk imports recorded yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600 uppercase">
                      <th className="px-4 py-3">File Name</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Rows</th>
                      <th className="px-4 py-3">Imported</th>
                      <th className="px-4 py-3">Rejected</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {batches.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {b.file_name}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date(b.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums">
                          {b.row_count}
                        </td>
                        <td className="px-4 py-3 text-emerald-700 font-semibold tabular-nums">
                          {b.imported_count}
                        </td>
                        <td className="px-4 py-3 text-red-700 tabular-nums">
                          {b.rejected_count}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => viewBatchAttendees(b)}
                            className="inline-flex items-center gap-1.5 text-xs text-teal-700 hover:text-teal-900 font-medium"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View Attendees
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedBatch && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Attendees in Batch: {selectedBatch.file_name} (
                    {selectedBatchAttendees.length})
                  </h3>
                  <button
                    onClick={() => setSelectedBatch(null)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Close
                  </button>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase font-semibold text-slate-600">
                      <tr className="text-left border-b border-slate-200">
                        <th className="px-4 py-2">Reg. No.</th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Category</th>
                        <th className="px-4 py-2">Food</th>
                        <th className="px-4 py-2">Payment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {selectedBatchAttendees.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-2 font-mono text-slate-800">
                            {a.registration_number}
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-900">{a.name}</td>
                          <td className="px-4 py-2 text-slate-600">{a.category}</td>
                          <td className="px-4 py-2 text-slate-600">{a.food_preference}</td>
                          <td className="px-4 py-2 text-slate-600">{a.payment_status}</td>
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

// ── Multi-Format Parsers ──

async function parseDocx(file: File): Promise<Record<string, unknown>[]> {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
    if (html && html.includes('<table')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const tables = doc.querySelectorAll('table');
      const records: Record<string, unknown>[] = [];

      tables.forEach((table) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length === 0) return;

        const firstRowCells = Array.from(rows[0].querySelectorAll('th, td')).map((c) =>
          (c.textContent || '').trim(),
        );

        const hasNamedHeaders = firstRowCells.some((h) =>
          /name|reg|phone|mobile|category|food|email|status|doctor|student|participant/i.test(h),
        );

        const startIndex = hasNamedHeaders ? 1 : 0;
        const headers = hasNamedHeaders
          ? firstRowCells
          : firstRowCells.map((_, i) => `Column_${i + 1}`);

        for (let i = startIndex; i < rows.length; i++) {
          const cells = Array.from(rows[i].querySelectorAll('td, th')).map((c) =>
            (c.textContent || '').trim(),
          );
          if (cells.every((c) => !c)) continue;

          const record: Record<string, unknown> = {};
          cells.forEach((val, colIdx) => {
            const h = headers[colIdx] || `Column_${colIdx + 1}`;
            record[h] = val;
          });
          records.push(record);
        }
      });

      if (records.length > 0) return records;
    }
  } catch (e) {
    console.warn('Docx HTML parse failed, falling back to raw text', e);
  }

  const { value: rawText } = await mammoth.extractRawText({ arrayBuffer });
  return parseTextLines(rawText);
}

async function parseDoc(file: File): Promise<Record<string, unknown>[]> {
  try {
    const text = await file.text();
    if (text && !text.includes('\x00\x00\x00')) {
      return parseTextLines(text);
    }
  } catch {}

  // Binary doc: scan for printable strings
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let asciiStr = '';
  let inWord = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) {
      inWord += String.fromCharCode(b);
    } else if (b === 10 || b === 13) {
      if (inWord.length >= 3) {
        asciiStr += inWord + '\n';
      }
      inWord = '';
    } else {
      if (inWord.length >= 3) {
        asciiStr += inWord + '\n';
      }
      inWord = '';
    }
  }
  return parseTextLines(asciiStr);
}

async function parseExcelOrCsv(file: File): Promise<Record<string, unknown>[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
}

function parseTextLines(text: string): Record<string, unknown>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes('|')) delimiter = '|';
  else if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';

  const firstParts = firstLine.split(delimiter).map((p) => p.trim());
  const isHeader = firstParts.some((h) =>
    /name|reg|phone|mobile|category|food|email|status|doctor|student|participant/i.test(h),
  );

  const startIndex = isHeader ? 1 : 0;
  const headers = isHeader
    ? firstParts
    : firstParts.map((_, i) => `Column_${i + 1}`);

  const records: Record<string, unknown>[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.includes(delimiter)) {
      const parts = line.split(delimiter).map((p) => p.trim());
      const rec: Record<string, unknown> = {};
      parts.forEach((val, colIdx) => {
        const h = headers[colIdx] || `Column_${colIdx + 1}`;
        rec[h] = val;
      });
      records.push(rec);
    } else {
      // Freeform single line: look for phone number and name
      const phoneMatch = line.match(/(?:\+?91[\s-]?)?[6789]\d{9}/);
      let name = line;
      let phone = '';
      if (phoneMatch) {
        phone = phoneMatch[0];
        name = line.replace(phone, '').replace(/^[\s\-_:,.]+|[\s\-_:,.]+$/g, '').trim();
      }
      records.push({
        Name: name,
        'Phone Number': phone,
      });
    }
  }

  return records;
}

// ── Helpers ──

function buildColumnMap(
  row: Record<string, unknown>,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!row) return map;
  const keys = Object.keys(row);

  for (const key of keys) {
    const norm = key.trim().toLowerCase().replace(/[_\s]+/g, ' ');

    if (
      /^(name|full name|attendee name|participant name|participant|doctor name|dr name|delegate name|student name|candidate name|delegate|doctor)$/i.test(
        norm,
      )
    ) {
      map['Name'] = key;
    } else if (
      /name/i.test(norm) &&
      !/council|college|hospital|institute|file|state/i.test(norm) &&
      !map['Name']
    ) {
      map['Name'] = key;
    } else if (
      /^(phone|phone no|phone number|mobile|mobile no|mobile number|contact|contact no|contact number|cell|whatsapp|tel|number)$/i.test(
        norm,
      )
    ) {
      map['Phone Number'] = key;
    } else if (/mobile|phone|contact/i.test(norm) && !map['Phone Number']) {
      map['Phone Number'] = key;
    } else if (
      /^(reg|reg no|reg number|registration|registration no|registration number|regid|attendee id|badge no|id|s no|sl no|serial no)$/i.test(
        norm,
      )
    ) {
      map['Registration Number'] = key;
    } else if (/^(category|cat|designation|attendee type|role|type)$/i.test(norm)) {
      map['Category'] = key;
    } else if (/^(food|food pref|food preference|diet|meal|lunch|veg)$/i.test(norm)) {
      map['Food Preference'] = key;
    } else if (/^(payment|payment status|paid|fee|fees|status)$/i.test(norm)) {
      map['Payment Status'] = key;
    } else if (/^(email|e-mail|mail|email id|email address)$/i.test(norm)) {
      map['Email'] = key;
    } else if (/^(gender|sex)$/i.test(norm)) {
      map['Gender'] = key;
    } else if (/council|kmc|tnmcn|mci|medical council/i.test(norm)) {
      map['Medical Council Number'] = key;
    }
  }

  // Fallback: If no column named 'Name' matched, check which column has personal names
  if (!map['Name']) {
    for (const key of keys) {
      const val = String(row[key] ?? '').trim();
      if (/[a-zA-Z]{2,}/.test(val) && !val.includes('@') && !/^\d+$/.test(val)) {
        map['Name'] = key;
        break;
      }
    }
  }

  return map;
}

function normalizeCategory(rawCat: string): string {
  if (!rawCat) return 'Delegates';
  const c = rawCat.toLowerCase().trim();
  if (c.includes('faculty')) return 'Faculty';
  if (c.includes('post') || c.includes('pg')) return 'Post Graduates';
  if (c.includes('under') || c.includes('ug') || c.includes('student')) return 'Under Graduates';
  if (c.includes('exhibit') || c.includes('trade') || c.includes('sponsor')) return 'Exhibitors';
  if (VALID_CATEGORIES.has(rawCat)) return rawCat;
  return 'Delegates';
}

function normalizeFood(rawFood: string): string {
  if (!rawFood) return 'Not Specified';
  const f = rawFood.toLowerCase().trim();
  if (f.includes('non')) return 'Non-Vegetarian';
  if (f.includes('veg')) return 'Vegetarian';
  if (VALID_FOOD.has(rawFood)) return rawFood;
  return 'Not Specified';
}

function normalizePayment(rawPay: string): string {
  if (!rawPay) return 'Paid';
  const p = rawPay.toLowerCase().trim();
  if (
    p.includes('pending') ||
    p.includes('unpaid') ||
    p.includes('not paid') ||
    p.includes('due')
  ) {
    return 'Pending';
  }
  if (
    p.includes('complimentary') ||
    p.includes('free') ||
    p.includes('comp')
  ) {
    return 'Complimentary';
  }
  if (VALID_PAYMENT.has(rawPay)) return rawPay;
  return 'Paid';
}

function normalizeGender(rawGender: string): string {
  if (!rawGender) return '';
  const g = rawGender.toLowerCase().trim();
  if (g === 'm' || g === 'male') return 'Male';
  if (g === 'f' || g === 'female') return 'Female';
  if (g === 'other' || g === 'o') return 'Other';
  return VALID_GENDER.has(rawGender) ? rawGender : '';
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
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
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
