import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  QrCode,
  Camera,
  CameraOff,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  LogIn,
  LogOut,
  Keyboard,
  Lock,
} from 'lucide-react';

type ScanMode = 'check_in' | 'check_out';
type ScanResult = {
  type: 'success' | 'already' | 'invalid' | 'error';
  message: string;
  name?: string;
  regNo?: string;
  category?: string;
  status?: string;
};

const COOLDOWN_MS = 3000;

const RESULT_MESSAGES: Record<string, string> = {
  success_check_in: 'Check-in successful',
  already_checked_in: 'Already checked in',
  success_check_out: 'Check-out successful',
  already_checked_out: 'Already checked out',
  not_checked_in: 'Cannot check out — attendee was not checked in',
  invalid_qr: 'Invalid QR code',
};

export default function ScannerScreen() {
  const { authState } = useAuth();
  const role =
    authState.status === 'authenticated' ? authState.profile.role : 'scanner';

  const [mode, setMode] = useState<ScanMode>('check_in');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manualRegNo, setManualRegNo] = useState('');
  const [manualSearching, setManualSearching] = useState(false);

  const html5QrRef = useRef<Html5Qrcode | null>(null);
  const lastScannedToken = useRef<string | null>(null);
  const lastScanTime = useRef<number>(0);
  const containerId = 'qr-scanner-container';

  const processScan = useCallback(
    async (qrToken: string) => {
      if (processing) return;

      // Cooldown: prevent same QR from being processed repeatedly
      const now = Date.now();
      if (
        lastScannedToken.current === qrToken &&
        now - lastScanTime.current < COOLDOWN_MS
      ) {
        return;
      }
      lastScannedToken.current = qrToken;
      lastScanTime.current = now;

      setProcessing(true);
      setResult(null);

      try {
        const { data, error } = await supabase.rpc('process_scan', {
          p_qr_token: qrToken,
          p_action: mode,
          p_device_info: navigator.userAgent.slice(0, 200),
          p_session_id: null,
        });

        if (error) {
          setResult({
            type: 'error',
            message: 'Network error; attendance was not recorded',
          });
          return;
        }

        const r = Array.isArray(data) ? data[0] : data;
        if (!r) {
          setResult({ type: 'invalid', message: 'Invalid QR code' });
          return;
        }

        const resultCode = r.result as string;
        const isSuccess = resultCode.startsWith('success');
        const isAlready = resultCode.startsWith('already');

        setResult({
          type: isSuccess ? 'success' : isAlready ? 'already' : 'invalid',
          message: RESULT_MESSAGES[resultCode] ?? 'Unknown result',
          name: r.name,
          regNo: r.registration_number,
          category: r.category,
          status: r.attendance_status,
        });
      } catch {
        setResult({
          type: 'error',
          message: 'Network error; attendance was not recorded',
        });
      } finally {
        setProcessing(false);
      }
    },
    [mode, processing],
  );

  const startCamera = useCallback(async () => {
    setCameraError('');
    setResult(null);
    setCameraStarting(true);

    if (html5QrRef.current) {
      try {
        if (html5QrRef.current.isScanning) {
          await html5QrRef.current.stop();
        }
        await html5QrRef.current.clear();
      } catch {}
      html5QrRef.current = null;
    }

    try {
      const html5Qr = new Html5Qrcode(containerId);
      html5QrRef.current = html5Qr;

      // Responsive qrbox sizing calculation
      const qrboxCalc = (viewfinderWidth: number, viewfinderHeight: number) => {
        const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75);
        const size = Math.max(edge, 160);
        return { width: size, height: size };
      };

      const qrConfig = {
        fps: 10,
        qrbox: qrboxCalc,
        aspectRatio: 1.333334,
      };

      const onScanSuccess = (decodedText: string) => {
        processScan(decodedText);
      };

      const onScanFailure = () => {
        // Per-frame failure — normal while scanning
      };

      // Try environment (back) camera first; if that fails (e.g. desktop webcam), fallback to user or default camera
      try {
        await html5Qr.start(
          { facingMode: 'environment' },
          qrConfig,
          onScanSuccess,
          onScanFailure,
        );
      } catch {
        // Fallback to front camera or default camera
        await html5Qr.start(
          { facingMode: 'user' },
          qrConfig,
          onScanSuccess,
          onScanFailure,
        );
      }

      // Check and apply video element styles to ensure it fills the container cleanly
      const videoEl = document.querySelector(`#${containerId} video`) as HTMLVideoElement | null;
      if (videoEl) {
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.objectFit = 'cover';
        videoEl.style.borderRadius = '0.75rem';
        if (videoEl.paused) {
          videoEl.play().catch(() => {});
        }
      }

      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission') || msg.includes('denied') || msg.includes('NotAllowed')) {
        setCameraError('Camera permission denied. Please allow camera access or use manual lookup.');
      } else {
        setCameraError('Unable to start camera. You can use manual lookup instead.');
      }
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  }, [processScan]);

  const stopCamera = useCallback(async () => {
    setCameraStarting(false);
    if (html5QrRef.current) {
      try {
        if (html5QrRef.current.isScanning) {
          await html5QrRef.current.stop();
        }
        await html5QrRef.current.clear();
      } catch {
        // ignore
      }
      html5QrRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (html5QrRef.current) {
        try {
          if (html5QrRef.current.isScanning) {
            html5QrRef.current.stop().then(() => html5QrRef.current?.clear()).catch(() => {});
          } else {
            html5QrRef.current.clear().catch(() => {});
          }
        } catch {}
      }
    };
  }, []);

  // Reset cooldown when mode changes
  useEffect(() => {
    lastScannedToken.current = null;
    setResult(null);
  }, [mode]);

  const [searchedAttendee, setSearchedAttendee] = useState<any | null>(null);

  const handleAction = async (regNo: string, action: ScanMode) => {
    if (!regNo.trim() || manualSearching) return;
    setManualSearching(true);
    setResult(null);

    try {
      const { data, error } = await supabase.rpc('process_scan_by_reg_no', {
        p_registration_number: regNo.trim(),
        p_action: action,
        p_device_info: navigator.userAgent.slice(0, 200),
        p_session_id: null,
      });

      if (error) {
        setResult({
          type: 'error',
          message: 'Network error; attendance was not recorded',
        });
        return;
      }

      const r = Array.isArray(data) ? data[0] : data;
      if (!r || r.result === 'invalid_qr') {
        setResult({ type: 'invalid', message: 'Attendee not found or invalid registration number' });
        return;
      }

      const resultCode = r.result as string;
      const isSuccess = resultCode.startsWith('success');
      const isAlready = resultCode.startsWith('already');

      setResult({
        type: isSuccess ? 'success' : isAlready ? 'already' : 'invalid',
        message: RESULT_MESSAGES[resultCode] ?? 'Unknown result',
        name: r.name,
        regNo: r.registration_number,
        category: r.category,
        status: r.attendance_status,
      });

      // Update searched attendee status if present
      if (searchedAttendee && searchedAttendee.registration_number === r.registration_number) {
        setSearchedAttendee({ ...searchedAttendee, attendance_status: r.attendance_status });
      }
    } catch {
      setResult({
        type: 'error',
        message: 'Network error; attendance was not recorded',
      });
    } finally {
      setManualSearching(false);
    }
  };

  const handleSearchAttendee = async () => {
    const regNo = manualRegNo.trim();
    if (!regNo || manualSearching) return;

    setManualSearching(true);
    setResult(null);
    setSearchedAttendee(null);

    try {
      const { data } = await supabase
        .from('attendees')
        .select('*')
        .or(`registration_number.ilike.%${regNo}%,qr_token.ilike.%${regNo}%`)
        .maybeSingle();

      if (data) {
        setSearchedAttendee(data);
      } else {
        setResult({
          type: 'invalid',
          message: `No attendee found matching registration number "${regNo}"`,
        });
      }
    } catch {
      setResult({
        type: 'error',
        message: 'Error searching for attendee',
      });
    } finally {
      setManualSearching(false);
    }
  };

  const handleManualLookup = () => {
    handleAction(manualRegNo, mode);
  };

  // Scanner role should only access scanner — but admin also has access
  // Registration role does NOT have scanner access per requirements
  if (role === 'registration') {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1.5">
          Access Restricted
        </h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Registration accounts do not have scanner access. Please use an admin
          or scanner account.
        </p>
      </div>
    );
  }

  const inputClasses =
    'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          QR Scanner
        </h2>
        <p className="text-sm text-slate-500">
          Scan a badge QR code to check attendees in or out. Only the name and
          registration number are shown.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 bg-slate-100 rounded-xl p-1.5">
        <button
          onClick={() => setMode('check_in')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
            mode === 'check_in'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LogIn className="w-4 h-4" />
          Check In
        </button>
        <button
          onClick={() => setMode('check_out')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
            mode === 'check_out'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LogOut className="w-4 h-4" />
          Check Out
        </button>
      </div>

      {/* Result display */}
      {result && (
        <div
          className={`rounded-xl border px-5 py-4 ${
            result.type === 'success'
              ? 'bg-emerald-50 border-emerald-200'
              : result.type === 'already'
                ? 'bg-amber-50 border-amber-200'
                : result.type === 'invalid'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-slate-100 border-slate-300'
          }`}
        >
          <div className="flex items-start gap-3">
            {result.type === 'success' && (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
            )}
            {result.type === 'already' && (
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            )}
            {result.type === 'invalid' && (
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            {result.type === 'error' && (
              <AlertCircle className="w-6 h-6 text-slate-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-semibold ${
                  result.type === 'success'
                    ? 'text-emerald-900'
                    : result.type === 'already'
                      ? 'text-amber-900'
                      : result.type === 'invalid'
                        ? 'text-red-900'
                        : 'text-slate-700'
                }`}
              >
                {result.message}
              </p>
              {result.name && (
                <div className="mt-2 space-y-0.5">
                  <p className="text-sm text-slate-700 font-medium">
                    {result.name}
                  </p>
                  <p className="text-xs font-mono text-slate-500">
                    {result.regNo}
                  </p>
                  <p className="text-xs text-slate-500">{result.category}</p>
                </div>
              )}
            </div>
            {processing && (
              <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            )}
          </div>
        </div>
      )}

      {/* Camera section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Camera Scan</h3>
          {cameraActive ? (
            <button
              onClick={stopCamera}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 font-medium transition-colors"
            >
              <CameraOff className="w-4 h-4" />
              Stop Camera
            </button>
          ) : (
            <button
              onClick={startCamera}
              disabled={processing || cameraStarting}
              className="flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-3.5 py-1.5 disabled:opacity-50 transition-colors shadow-sm"
            >
              {cameraStarting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {cameraStarting ? 'Starting Camera...' : 'Start Camera Scan'}
            </button>
          )}
        </div>

        {cameraError && (
          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <CameraOff className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{cameraError}</p>
          </div>
        )}

        <div className="relative rounded-xl overflow-hidden bg-slate-950 min-h-[300px] flex items-center justify-center border border-slate-800">
          {/* Isolated mount point for Html5Qrcode — keep clean of React nodes */}
          <div
            id={containerId}
            className="w-full flex items-center justify-center"
          />

          {/* Placeholder overlay when camera is not running */}
          {!cameraActive && !cameraStarting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-sm gap-3 p-6 text-center z-10 pointer-events-none bg-slate-950">
              <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                <QrCode className="w-8 h-8 text-teal-400/80" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-200 text-base">Camera Viewfinder is Off</p>
                <p className="text-xs text-slate-400 max-w-xs">Click &ldquo;Start Camera Scan&rdquo; to activate your device camera and scan attendee QR badges</p>
              </div>
            </div>
          )}

          {/* Loading state when camera is starting */}
          {cameraStarting && (
            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-3 z-10 text-white">
              <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
              <p className="text-sm font-medium">Initializing camera stream...</p>
            </div>
          )}
        </div>
      </div>

      {/* Manual lookup section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">
            Manual Registration Number Lookup &amp; Check-In
          </h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={manualRegNo}
              onChange={(e) => setManualRegNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearchAttendee();
              }}
              placeholder="Enter reg number e.g. PMCON-5002, PMCON-2004"
              className={inputClasses + ' pl-10'}
              disabled={manualSearching}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSearchAttendee}
              disabled={manualSearching || !manualRegNo.trim()}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2.5 disabled:opacity-50 transition"
              title="Search attendee details"
            >
              {manualSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search
            </button>
            <button
              onClick={() => handleAction(manualRegNo, mode)}
              disabled={manualSearching || !manualRegNo.trim()}
              className={`flex items-center justify-center gap-2 rounded-lg text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-50 transition ${
                mode === 'check_in'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {mode === 'check_in' ? (
                <>
                  <LogIn className="w-4 h-4" />
                  Check In
                </>
              ) : (
                <>
                  <LogOut className="w-4 h-4" />
                  Check Out
                </>
              )}
            </button>
          </div>
        </div>

        {/* Searched Attendee Card */}
        {searchedAttendee && (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 space-y-3 animate-in fade-in duration-150">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-mono text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  {searchedAttendee.registration_number}
                </span>
                <h4 className="text-base font-bold text-slate-900 mt-1">
                  {searchedAttendee.name}
                </h4>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
                  <span>{searchedAttendee.category}</span>
                  {searchedAttendee.medical_council_number && (
                    <>
                      <span>•</span>
                      <span>Council: {searchedAttendee.medical_council_number}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>Food: {searchedAttendee.food_preference}</span>
                </div>
              </div>
              <div className="text-right">
                <span
                  className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${
                    searchedAttendee.attendance_status === 'checked_in'
                      ? 'bg-emerald-100 text-emerald-800'
                      : searchedAttendee.attendance_status === 'checked_out'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {searchedAttendee.attendance_status === 'checked_in'
                    ? 'Checked In'
                    : searchedAttendee.attendance_status === 'checked_out'
                      ? 'Checked Out'
                      : 'Not Checked In'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60">
              <button
                onClick={() => handleAction(searchedAttendee.registration_number, 'check_in')}
                disabled={manualSearching || searchedAttendee.attendance_status === 'checked_in'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                {searchedAttendee.attendance_status === 'checked_in'
                  ? 'Already Checked In'
                  : 'Check In Attendee'}
              </button>
              <button
                onClick={() => handleAction(searchedAttendee.registration_number, 'check_out')}
                disabled={manualSearching || searchedAttendee.attendance_status === 'checked_out'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                Check Out Attendee
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Enter any registration number to search details and check in/out, or scan badge QR with camera above.
        </p>
      </div>
    </div>
  );
}
