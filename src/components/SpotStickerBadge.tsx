import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import type { Attendee } from '@/lib/supabase';
import {
  type SpotStickerLayout,
  DEFAULT_SPOT_STICKER_LAYOUT,
  SPOT_BADGE_WIDTH_IN,
  SPOT_BADGE_HEIGHT_IN,
} from '@/lib/badgeLayout';

function splitName(name: string): string[] {
  const maxLen = 22;
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

type SpotStickerBadgeProps = {
  attendee: Attendee;
  layout?: SpotStickerLayout;
  preview?: boolean;
};

export default function SpotStickerBadge({
  attendee,
  layout,
  preview = false,
}: SpotStickerBadgeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const L = layout ?? DEFAULT_SPOT_STICKER_LAYOUT;

  const widthMm = L.width_mm || 100;
  const heightMm = L.height_mm || 100;

  const scaleX = widthMm / (SPOT_BADGE_WIDTH_IN * 25.4);
  const scaleY = heightMm / (SPOT_BADGE_HEIGHT_IN * 25.4);

  const nameLines = splitName(attendee.name);
  const regNo = trimRegNo(attendee.registration_number);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      attendee.qr_token,
      {
        width: 300,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
      (err) => {
        if (err) console.error('Sticker QR generation failed', err);
      },
    );
  }, [attendee.qr_token]);

  const badge = (
    <div
      className="badge-page spot-sticker-page"
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
      }}
    >
      <div
        className="badge-inner-scaler"
        style={{
          width: `${SPOT_BADGE_WIDTH_IN}in`,
          height: `${SPOT_BADGE_HEIGHT_IN}in`,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
          position: 'relative',
        }}
      >
        {/* Plain white background — no border frame image */}

        {/* Top: Registration Number */}
        <div
          className="badge-overlay"
          style={{
            top: `${L.registration.top}in`,
            left: `${L.registration.left}in`,
            width: `${L.registration.width}in`,
            color: L.registration.color,
            fontSize: `${L.registration.fontSize}in`,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {regNo}
        </div>

        {/* Middle: Centered Crisp QR Code */}
        <div
          className="badge-qr-wrapper"
          style={{
            top: `${L.qr.top}in`,
            left: `${L.qr.left}in`,
            width: `${L.qr.size}in`,
            height: `${L.qr.size}in`,
            padding: 0,
            backgroundColor: '#ffffff',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              imageRendering: 'pixelated',
            }}
          />
        </div>

        {/* Bottom: Delegate Name */}
        <div
          className="badge-overlay"
          style={{
            top: `${L.name_field.top}in`,
            left: `${L.name_field.left}in`,
            width: `${L.name_field.width}in`,
            color: L.name_field.color,
            fontSize: `${L.name_field.fontSize}in`,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
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

  // Screen preview: nicely scaled down to fit UI card
  const widthPx = widthMm * (96 / 25.4);
  const heightPx = heightMm * (96 / 25.4);
  const maxBoxSize = 240;
  const previewScale = Math.min(maxBoxSize / widthPx, maxBoxSize / heightPx, 1);

  return (
    <div
      style={{
        width: `${widthPx * previewScale}px`,
        height: `${heightPx * previewScale}px`,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#ffffff',
        margin: '0 auto',
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
