import { supabase } from '@/lib/supabase';

export interface RegistrationLayout {
  top: number;
  left: number;
  width: number;
  fontSize: number;
  color: string;
}

export interface QrLayout {
  top: number;
  left: number;
  size: number;
}

export interface NameLayout {
  top: number;
  left: number;
  width: number;
  fontSize: number;
  color: string;
}

export interface BadgeLayout {
  registration: RegistrationLayout;
  qr: QrLayout;
  name: NameLayout;
}

export const DEFAULT_BADGE_LAYOUT: BadgeLayout = {
  registration: { top: 2.28, left: 0.25, width: 3.5, fontSize: 0.20, color: '#cf252b' },
  qr: { top: 2.65, left: 1.275, size: 1.45 },
  name: { top: 4.20, left: 0.25, width: 3.5, fontSize: 0.25, color: '#17251f' },
};

export const BADGE_WIDTH_IN = 4;
export const BADGE_HEIGHT_IN = 6;
// Approx position (in inches) of the Chennai footer top edge in the
// background artwork — used to stop the name/QR from overlapping it.
export const FOOTER_TOP_IN = 5.55;
// White quiet zone (in inches) maintained around the QR code.
export const QR_QUIET_ZONE_IN = 0.08;

function coerceLayout(raw: unknown): BadgeLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_BADGE_LAYOUT;
  const r = raw as Record<string, unknown>;
  const reg = (r.registration ?? {}) as Record<string, unknown>;
  const qr = (r.qr ?? {}) as Record<string, unknown>;
  const name = (r.name ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && isFinite(v) ? v : fallback;
  const col = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  return {
    registration: {
      top: num(reg.top, DEFAULT_BADGE_LAYOUT.registration.top),
      left: num(reg.left, DEFAULT_BADGE_LAYOUT.registration.left),
      width: num(reg.width, DEFAULT_BADGE_LAYOUT.registration.width),
      fontSize: num(reg.fontSize, DEFAULT_BADGE_LAYOUT.registration.fontSize),
      color: col(reg.color, DEFAULT_BADGE_LAYOUT.registration.color),
    },
    qr: {
      top: num(qr.top, DEFAULT_BADGE_LAYOUT.qr.top),
      left: num(qr.left, DEFAULT_BADGE_LAYOUT.qr.left),
      size: num(qr.size, DEFAULT_BADGE_LAYOUT.qr.size),
    },
    name: {
      top: num(name.top, DEFAULT_BADGE_LAYOUT.name.top),
      left: num(name.left, DEFAULT_BADGE_LAYOUT.name.left),
      width: num(name.width, DEFAULT_BADGE_LAYOUT.name.width),
      fontSize: num(name.fontSize, DEFAULT_BADGE_LAYOUT.name.fontSize),
      color: col(name.color, DEFAULT_BADGE_LAYOUT.name.color),
    },
  };
}

export async function loadBadgeLayout(): Promise<BadgeLayout> {
  try {
    const { data } = await supabase
      .from('application_settings')
      .select('value')
      .eq('key', 'badge_layout')
      .maybeSingle();
    if (!data) return DEFAULT_BADGE_LAYOUT;
    return coerceLayout(data.value);
  } catch {
    return DEFAULT_BADGE_LAYOUT;
  }
}

export async function saveBadgeLayout(layout: BadgeLayout): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('application_settings')
      .upsert(
        { key: 'badge_layout', value: layout as unknown as Record<string, unknown>, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    return { error: error ? error.message : null };
  } catch {
    return { error: 'Network error while saving' };
  }
}

export function validateLayout(layout: BadgeLayout): string | null {
  const W = BADGE_WIDTH_IN;
  const H = BADGE_HEIGHT_IN;
  const round = (n: number) => Math.round(n * 100) / 100;
  const reg = layout.registration;
  const qr = layout.qr;
  const name = layout.name;

  if (reg.top < 0 || reg.left < 0 || reg.width <= 0 || reg.fontSize <= 0)
    return 'Registration values must be positive.';
  if (round(reg.left + reg.width) > W)
    return 'Registration number extends past the right edge.';
  if (round(reg.top + reg.fontSize) > H)
    return 'Registration number extends past the bottom edge.';
  if (round(reg.top) < FOOTER_TOP_IN && round(reg.top + reg.fontSize) > FOOTER_TOP_IN)
    return 'Registration number overlaps the footer.';

  if (qr.size <= 0) return 'QR size must be positive.';
  if (qr.left < 0 || round(qr.left + qr.size) > W)
    return 'QR code extends past the left or right edge.';
  if (round(qr.top + qr.size) > FOOTER_TOP_IN)
    return 'QR code overlaps the footer.';
  if (round(qr.top) < 1.5)
    return 'QR code overlaps the header area.';

  if (name.top < 0 || name.left < 0 || name.width <= 0 || name.fontSize <= 0)
    return 'Name values must be positive.';
  if (round(name.left + name.width) > W)
    return 'Name extends past the right edge.';
  // Name max height ≈ 2 lines at fontSize * line-height(1.05)
  const nameHeight = name.fontSize * 1.05 * 2;
  if (round(name.top + nameHeight) > FOOTER_TOP_IN)
    return 'Name overlaps the footer.';
  return null;
}

/** QR left that horizontally centers a QR of the given size on a 4in badge. */
export function centeredQrLeft(size: number): number {
  return round2((BADGE_WIDTH_IN - size) / 2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round2in(n: number): number {
  return round2(n);
}
