import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import type { Attendee } from '@/lib/supabase';
import {
  type BadgeLayout,
  DEFAULT_BADGE_LAYOUT,
  BADGE_HEIGHT_IN,
  BADGE_WIDTH_IN,
} from '@/lib/badgeLayout';

function splitName(name: string): string[] {
  const maxLen = 28;
  if (name.length <= maxLen) return [name];
  const words = name.split(' ');
  if (words.length === 1) return [name.slice(0, maxLen - 1) + '…'];
  let line1 = '';
  let line2 = '';
  for (const w of words) {
    if ((line1 + ' ' + w).trim().length <= maxLen) {
      line1 = (line1 + ' ' + w).trim();
    } else {
      line2 = (line2 + ' ' + w).trim();
    }
  }
  if (line2.length > maxLen) line2 = line2.slice(0, maxLen - 1) + '…';
  return [line1, line2].filter((l) => l.length > 0);
}

function trimRegNo(regNo: string): string {
  return regNo.length > 24 ? regNo.slice(0, 23) + '…' : regNo;
}

type BadgeProps = {
  attendee: Attendee;
  layout?: BadgeLayout;
  preview?: boolean;
};

// Scale factor from base coordinates (4in x 6in) to ISO A6 size (105mm x 148.5mm)
// 105mm / (4 * 25.4mm) = 1.0334645
// 148.5mm / (6 * 25.4mm) = 0.9744094
const SCALE_X_A6 = 105 / (BADGE_WIDTH_IN * 25.4);
const SCALE_Y_A6 = 148.5 / (BADGE_HEIGHT_IN * 25.4);

export default function Badge({ attendee, layout, preview = false }: BadgeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const L = layout ?? DEFAULT_BADGE_LAYOUT;
  const nameLines = splitName(attendee.name);
  const regNo = trimRegNo(attendee.registration_number);

  const ps = L.pageSize;
  const targetWidthMm = ps?.badge_width_mm || (ps?.columns === 1 && ps?.rows === 1 && ps?.preset === 'A4' ? 210 : 105);
  const targetHeightMm = ps?.badge_height_mm || (ps?.columns === 1 && ps?.rows === 1 && ps?.preset === 'A4' ? 297 : 148.5);

  const scaleX = targetWidthMm / (BADGE_WIDTH_IN * 25.4);
  const scaleY = targetHeightMm / (BADGE_HEIGHT_IN * 25.4);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      attendee.qr_token,
      {
        width: 270,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
      (err) => {
        if (err) console.error('QR generation failed', err);
      },
    );
  }, [attendee.qr_token]);

  const badge = (
    <div
      className="badge-page"
      style={{
        width: `${targetWidthMm}mm`,
        height: `${targetHeightMm}mm`,
      }}
    >
      <div
        className="badge-inner-scaler"
        style={{
          width: `${BADGE_WIDTH_IN}in`,
          height: `${BADGE_HEIGHT_IN}in`,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        }}
      >
        <img src="/Empty_Sample.png" alt="" className="badge-background" />

        <div
          className="badge-overlay"
          style={{
            top: `${L.registration.top}in`,
            left: `${L.registration.left}in`,
            width: `${L.registration.width}in`,
            color: L.registration.color,
            fontSize: `${L.registration.fontSize}in`,
          }}
        >
          {regNo}
        </div>

        <div
          className="badge-qr-wrapper"
          style={{
            top: `${L.qr.top}in`,
            left: `${L.qr.left}in`,
            width: `${L.qr.size}in`,
            height: `${L.qr.size}in`,
          }}
        >
          <canvas ref={canvasRef} />
        </div>

        <div
          className="badge-overlay"
          style={{
            top: `${L.name.top}in`,
            left: `${L.name.left}in`,
            width: `${L.name.width}in`,
            color: L.name.color,
            fontSize: `${L.name.fontSize}in`,
          }}
        >
          {nameLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );

  if (!preview) return badge;

  // Screen preview: scaled down to fit UI cards/modals neatly
  const a6WidthPx = targetWidthMm * (96 / 25.4);
  const a6HeightPx = targetHeightMm * (96 / 25.4);
  const previewScale = Math.min(270 / a6WidthPx, 380 / a6HeightPx, 0.68);

  return (
    <div
      style={{
        width: `${a6WidthPx * previewScale}px`,
        height: `${a6HeightPx * previewScale}px`,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.1)',
        borderRadius: '6px',
        backgroundColor: '#fff',
      }}
    >
      <div
        style={{
          transform: `scale(${previewScale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {badge}
      </div>
    </div>
  );
}
