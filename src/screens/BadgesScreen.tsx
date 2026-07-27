import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { Attendee, ImportBatch } from '@/lib/supabase';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';
import { type BadgeLayout, loadBadgeLayout, DEFAULT_BADGE_LAYOUT } from '@/lib/badgeLayout';
import {
  BadgeCheck,
  Search,
  Loader2,
  Printer,
  AlertCircle,
  CheckCircle2,
  Eye,
  RefreshCw,
  FileStack,
  Lock,
  X,
} from 'lucide-react';

type PrintType = 'single' | 'reprint' | 'batch';

const BATCH_SIZES = [25, 50] as const;

export default function BadgesScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [previewAttendee, setPreviewAttendee] = useState<Attendee | null>(null);
  const [reprintAttendee, setReprintAttendee] = useState<Attendee | null>(null);
  const [reprintReason, setReprintReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [printing, setPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState('');
  const [bulkModal, setBulkModal] = useState<null | {
    attendees: Attendee[];
    type: PrintType;
    label: string;
  }>(null);
  // Holds the attendees currently being printed (off-screen container)
  const [printQueue, setPrintQueue] = useState<null | {
    attendees: Attendee[];
    type: PrintType;
    reason?: string;
    label: string;
  }>(null);

  // Shown only after afterprint fires
  const [confirmModal, setConfirmModal] = useState<null | {
    attendees: Attendee[];
    type: PrintType;
    reason?: string;
    label: string;
  }>(null);

  // Import batches for bulk print
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [badgeLayout, setBadgeLayout] = useState<BadgeLayout>(DEFAULT_BADGE_LAYOUT);

  // Selected attendees for "Print Selected"
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Print container ref (off-screen)
  const printRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchAttendees = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('attendees')
      .select('*')
      .order('registration_number')
      .limit(200);
    if (debouncedSearch) {
      q = q.or(
        `name.ilike.%${debouncedSearch}%,registration_number.ilike.%${debouncedSearch}%`,
      );
    }
    const { data, error: e } = await q;
    if (e) setError('Unable to load attendees.');
    else setAttendees((data ?? []) as Attendee[]);
    setLoading(false);
  }, [debouncedSearch]);

  useEffect(() => {
    fetchAttendees();
  }, [fetchAttendees]);

  useEffect(() => {
    loadBadgeLayout().then(setBadgeLayout);
  }, []);

  const recordPrintEvents = async (
    attendeeIds: string[],
    type: PrintType,
    reason?: string,
  ) => {
    const rows = attendeeIds.map((id) => ({
      attendee_id: id,
      print_type: type,
      reason: reason ?? null,
      device_info: navigator.userAgent.slice(0, 200),
    }));
    const { error: e } = await supabase.from('badge_print_events').insert(rows);
    if (e) {
      setError('Badges printed, but the print log could not be recorded.');
    } else {
      setSuccess(
        `Printed ${attendeeIds.length} badge${attendeeIds.length === 1 ? '' : 's'}. Print event${attendeeIds.length === 1 ? '' : 's'} recorded.`,
      );
      setTimeout(() => setSuccess(''), 4000);
      // Audit: log badge print/reprint confirmation
      await supabase.rpc('log_audit', {
        p_action: type === 'reprint' ? 'badge_reprint' : 'badge_print',
        p_target_type: 'badge',
        p_details: { print_type: type, count: attendeeIds.length, reason: reason ?? null },
      });
    }
  };

  /**
   * Print flow:
   * 1. Put the selected attendees into print state.
   * 2. Render #badge-print-root via portal.
   * 3. Wait for /Empty_Sample.png to load.
   * 4. Wait for QR canvases and document.fonts.ready.
   * 5. Wait for two requestAnimationFrame cycles.
   * 6. Verify #badge-print-root contains a .badge-page and a background img.
   * 7. Call window.print().
   * 8. Keep the print DOM mounted until afterprint fires.
   * 9. Show confirmation only from afterprint.
   * 10. Clear print state only after confirmation completes.
   */
  const doPrint = async (
    printAttendees: Attendee[],
    type: PrintType,
    label: string,
    reason?: string,
  ) => {
    setPrinting(true);
    setError('');
    setPrintProgress('Preparing badges…');
    setConfirmModal(null);

    // 1. Put attendees into print state
    setPrintQueue({ attendees: printAttendees, type, reason, label });

    // 2. Wait for the portal to render into document.body
    await new Promise((r) => setTimeout(r, 200));

    // 3. Wait for the background image to load
    setPrintProgress('Loading badge artwork…');
    const artworkLoaded = await preloadArtwork();
    if (!artworkLoaded) {
      setError('Badge artwork failed to load');
      setPrintQueue(null);
      setPrinting(false);
      setPrintProgress('');
      return;
    }

    // 4. Wait for fonts and every QR canvas
    setPrintProgress('Generating QR codes…');
    await document.fonts.ready;
    await waitForQrCodes(printRootRef.current);

    // 5. Wait for two requestAnimationFrame cycles
    setPrintProgress(`Preparing badge 1 of ${printAttendees.length}`);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    // 6. Verify the print root contains the badge and background
    const root = printRootRef.current;
    const badgePages = root?.querySelectorAll('.badge-page') ?? [];
    const bgImgs = root?.querySelectorAll('.badge-background') ?? [];
    if (badgePages.length === 0 || bgImgs.length === 0) {
      setError('Badge print content was not prepared.');
      setPrintQueue(null);
      setPrinting(false);
      setPrintProgress('');
      return;
    }

    // 7. Set up afterprint listener BEFORE calling print
    const afterPrintPromise = new Promise<void>((resolve) => {
      const handler = () => {
        window.removeEventListener('afterprint', handler);
        resolve();
      };
      window.addEventListener('afterprint', handler);
    });

    // 8. Call window.print()
    window.print();

    // 9. Wait for afterprint before showing confirmation
    await afterPrintPromise;
    setPrintProgress('');
    setConfirmModal({ attendees: printAttendees, type, reason, label });
  };

  const handlePrintConfirmed = async (succeeded: boolean) => {
    const cm = confirmModal;
    if (!cm) return;
    setConfirmModal(null);
    setPrintQueue(null);
    setPrinting(false);

    if (succeeded) {
      await recordPrintEvents(
        cm.attendees.map((a) => a.id),
        cm.type,
        cm.reason,
      );
    } else {
      setError('Printing was not confirmed. No print events were recorded.');
    }
  };

  const handleSinglePrint = (a: Attendee) => {
    doPrint([a], 'single', '1 badge');
  };

  const handleReprintConfirm = () => {
    if (!reprintAttendee) return;
    const reason = reprintReason.trim();
    if (!reason) {
      setError('Please provide a reprint reason.');
      return;
    }
    setReprintAttendee(null);
    doPrint([reprintAttendee], 'reprint', '1 reprint', reason);
    setReprintReason('');
  };

  const handlePrintSelected = () => {
    const selected = attendees.filter((a) => selectedIds.has(a.id));
    if (selected.length === 0) {
      setError('Select at least one attendee to print.');
      return;
    }
    doPrint(selected, 'batch', `${selected.length} badges`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchBatches = async () => {
    setBatchLoading(true);
    const { data } = await supabase
      .from('import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    setBatches((data ?? []) as ImportBatch[]);
    setBatchLoading(false);
  };

  const handleBatchPrint = async (batch: ImportBatch) => {
    setBatchModalOpen(false);
    const { data } = await supabase
      .from('attendees')
      .select('*')
      .eq('import_batch_id', batch.id)
      .order('registration_number');
    const batchAttendees = (data ?? []) as Attendee[];
    if (batchAttendees.length === 0) {
      setError('No attendees found in that import batch.');
      return;
    }
    doPrint(
      batchAttendees,
      'batch',
      `${batchAttendees.length} badges from ${batch.file_name}`,
    );
  };

  const handleBulkSize = (size: number) => {
    const subset = attendees.slice(0, size);
    setBulkModal(null);
    doPrint(subset, 'batch', `${subset.length} badges`);
  };

  // Scanner role guard
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
          Scanner accounts cannot access badge printing. This is enforced by
          database security policies.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
          <button onClick={() => setError('')} className="ml-auto">
            <X className="w-4 h-4 text-red-400" />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800">{success}</p>
        </div>
      )}
      {printing && printProgress && (
        <div className="flex items-center gap-2.5 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <p className="text-sm text-blue-800">{printProgress}</p>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Badge Printing
        </h2>
        <p className="text-sm text-slate-500">
          Preview and print 4×6 inch badges with QR codes. Each badge prints on
          its own page.
        </p>
      </div>

      {/* Search + bulk actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or registration number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          onClick={handlePrintSelected}
          disabled={selectedIds.size === 0 || printing}
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
        >
          <Printer className="w-4 h-4" />
          Print Selected ({selectedIds.size})
        </button>
        <button
          onClick={() => {
            fetchBatches();
            setBatchModalOpen(true);
          }}
          disabled={printing}
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <FileStack className="w-4 h-4" />
          Print Import Batch
        </button>
        <div className="flex gap-2">
          {BATCH_SIZES.map((size) => (
            <button
              key={size}
              onClick={() =>
                setBulkModal({
                  attendees: attendees.slice(0, size),
                  type: 'batch',
                  label: `${Math.min(size, attendees.length)} badges`,
                })
              }
              disabled={attendees.length === 0 || printing}
              className="flex items-center justify-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
            >
              Print {size}
            </button>
          ))}
        </div>
      </div>

      {/* Attendee grid with checkboxes */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm p-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading attendees…
          </div>
        ) : attendees.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            No attendees found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === attendees.length && attendees.length > 0}
                      onChange={(e) => {
                        if (e.target.checked)
                          setSelectedIds(new Set(attendees.map((a) => a.id)));
                        else setSelectedIds(new Set());
                      }}
                      className="rounded border-slate-300"
                    />
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
                  <th className="px-3 py-2.5 font-semibold text-slate-700 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attendees.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700">
                      {a.registration_number}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {a.name}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{a.category}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setPreviewAttendee(a)}
                          title="Preview"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-teal-700 hover:bg-teal-50 transition"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleSinglePrint(a)}
                          title="Print"
                          disabled={printing}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition disabled:opacity-50"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setReprintAttendee(a)}
                          title="Reprint"
                          disabled={printing}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition disabled:opacity-50"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Badge preview modal */}
      <Modal
        open={!!previewAttendee}
        onClose={() => setPreviewAttendee(null)}
        title="Badge Preview"
        maxWidth="max-w-sm"
      >
        {previewAttendee && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <Badge attendee={previewAttendee} layout={badgeLayout} preview />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPreviewAttendee(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const a = previewAttendee;
                  setPreviewAttendee(null);
                  handleSinglePrint(a);
                }}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 text-white text-sm font-semibold px-4 py-2"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reprint reason modal */}
      <Modal
        open={!!reprintAttendee}
        onClose={() => setReprintAttendee(null)}
        title="Reprint Badge"
        maxWidth="max-w-md"
      >
        {reprintAttendee && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <p className="font-mono text-xs text-slate-500 mb-1">
                {reprintAttendee.registration_number}
              </p>
              <p className="font-semibold text-slate-900">
                {reprintAttendee.name}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Reprint Reason *
              </label>
              <textarea
                value={reprintReason}
                onChange={(e) => setReprintReason(e.target.value)}
                rows={3}
                placeholder="e.g. Badge was damaged, QR not scanning, lost badge…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setReprintAttendee(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReprintConfirm}
                className="flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-4 py-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reprint
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk size warning modal */}
      <Modal
        open={!!bulkModal}
        onClose={() => setBulkModal(null)}
        title="Confirm Bulk Print"
        maxWidth="max-w-md"
      >
        {bulkModal && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              You are about to print{' '}
              <span className="font-semibold">{bulkModal.attendees.length}</span>{' '}
              badges. Each badge will print on a separate page.
            </p>
            {bulkModal.attendees.length > 50 && (
              <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Warning: Printing more than 50 badges at once may take a long
                  time and use significant paper.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setBulkModal(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleBulkSize(bulkModal.attendees.length)}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-600 to-blue-600 text-white text-sm font-semibold px-4 py-2"
              >
                <Printer className="w-4 h-4" />
                Print {bulkModal.attendees.length} Badges
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import batch selection modal */}
      <Modal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        title="Print Import Batch Badges"
        maxWidth="max-w-lg"
      >
        <div className="space-y-3">
          {batchLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading batches…
            </div>
          ) : batches.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No import batches found.
            </p>
          ) : (
            batches.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {b.file_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {b.imported_count} imported ·{' '}
                    {new Date(b.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleBatchPrint(b)}
                  className="flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-3 py-2"
                >
                  <Printer className="w-4 h-4" />
                  Print All
                </button>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Print confirmation modal (after window.print() closes) */}
      <Modal
        open={!!confirmModal}
        onClose={() => handlePrintConfirmed(false)}
        title="Print Confirmation"
        maxWidth="max-w-md"
      >
        {confirmModal && (
          <div className="space-y-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mx-auto">
              <BadgeCheck className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-sm text-slate-600 text-center">
              Did the printing succeed? Print events will only be recorded if
              you confirm.
            </p>
            <p className="text-xs text-slate-400 text-center">
              {confirmModal.label}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => handlePrintConfirmed(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                No, Don't Record
              </button>
              <button
                onClick={() => handlePrintConfirmed(true)}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Yes, Printing Succeeded
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Off-screen print root — a direct child of document.body via portal.
          Always mounted; positioned off-screen via CSS so QR canvases render. */}
      {createPortal(
        <div ref={printRootRef} id="badge-print-root">
          {printQueue?.attendees.map((a) => (
            <Badge key={a.id} attendee={a} layout={badgeLayout} />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Print helpers ──

function preloadArtwork(): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.complete && img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = '/Empty_Sample.png';
  });
}

function waitForQrCodes(container: HTMLElement | null): Promise<void> {
  if (!container) return Promise.resolve();
  const canvases = container.querySelectorAll('canvas');
  return Promise.all(
    Array.from(canvases).map(
      (c) =>
        new Promise<void>((resolve) => {
          const check = () => {
            if ((c as HTMLCanvasElement).width > 0) resolve();
            else setTimeout(check, 50);
          };
          check();
        }),
    ),
  ).then(() => undefined);
}
