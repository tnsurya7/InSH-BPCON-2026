import { supabase } from '@/lib/supabase';

export type PageSizePreset = 'A4' | 'A3' | 'A6' | 'custom';

export interface PageSizeConfig {
  preset: PageSizePreset;
  name: string;
  width_mm: number;
  height_mm: number;
  columns: number;
  rows: number;
  badge_width_mm?: number;
  badge_height_mm?: number;
}

export const PRESET_PAGE_SIZES: Record<'A4' | 'A3' | 'A6', PageSizeConfig> = {
  A4: {
    preset: 'A4',
    name: 'A4 Page (1 Badge per page)',
    width_mm: 210,
    height_mm: 297,
    columns: 1,
    rows: 1,
    badge_width_mm: 210,
    badge_height_mm: 297,
  },
  A6: {
    preset: 'A6',
    name: 'A6 (4 Badges per page • 2×2)',
    width_mm: 210,
    height_mm: 297,
    columns: 2,
    rows: 2,
    badge_width_mm: 105,
    badge_height_mm: 148.5,
  },
  A3: {
    preset: 'A3',
    name: 'A3 Sheet (8 Badges • 4×2 Landscape)',
    width_mm: 420,
    height_mm: 297,
    columns: 4,
    rows: 2,
    badge_width_mm: 105,
    badge_height_mm: 148.5,
  },
};

export const DEFAULT_PAGE_SIZE_CONFIG: PageSizeConfig = PRESET_PAGE_SIZES.A6;

export const SPOT_BADGE_WIDTH_IN = 4;
export const SPOT_BADGE_HEIGHT_IN = 4;

export function centeredSpotQrLeft(size: number): number {
  return Math.max(0, (SPOT_BADGE_WIDTH_IN - size) / 2);
}

export type SpotStickerPreset = '100x100' | '100x75' | '100x50' | '75x50' | 'custom';

export interface SpotStickerLayout {
  preset: SpotStickerPreset;
  name: string;
  width_mm: number;
  height_mm: number;
  registration: RegistrationLayout;
  qr: QrLayout;
  name_field: NameLayout;
}

export const SPOT_STICKER_PRESETS: Record<'100x100' | '100x75' | '100x50' | '75x50', SpotStickerLayout> = {
  '100x100': {
    preset: '100x100',
    name: '100 × 100 mm (Square - Matches Template)',
    width_mm: 100,
    height_mm: 100,
    registration: { top: 0.35, left: 0.20, width: 3.60, fontSize: 0.26, color: '#000000' },
    qr: { top: 0.90, left: 0.95, size: 2.10 },
    name_field: { top: 3.25, left: 0.20, width: 3.60, fontSize: 0.28, color: '#000000' },
  },
  '100x75': {
    preset: '100x75',
    name: '100 × 75 mm (4" × 3" Standard)',
    width_mm: 100,
    height_mm: 75,
    registration: { top: 0.25, left: 0.20, width: 3.60, fontSize: 0.26, color: '#000000' },
    qr: { top: 0.75, left: 1.05, size: 1.90 },
    name_field: { top: 3.10, left: 0.20, width: 3.60, fontSize: 0.28, color: '#000000' },
  },
  '100x50': {
    preset: '100x50',
    name: '100 × 50 mm (4" × 2" Wide)',
    width_mm: 100,
    height_mm: 50,
    registration: { top: 0.20, left: 0.20, width: 3.60, fontSize: 0.24, color: '#000000' },
    qr: { top: 0.65, left: 1.20, size: 1.60 },
    name_field: { top: 2.95, left: 0.20, width: 3.60, fontSize: 0.26, color: '#000000' },
  },
  '75x50': {
    preset: '75x50',
    name: '75 × 50 mm (3" × 2" Compact)',
    width_mm: 75,
    height_mm: 50,
    registration: { top: 0.20, left: 0.20, width: 3.60, fontSize: 0.24, color: '#000000' },
    qr: { top: 0.65, left: 1.20, size: 1.60 },
    name_field: { top: 2.95, left: 0.20, width: 3.60, fontSize: 0.26, color: '#000000' },
  },
};

export const DEFAULT_SPOT_STICKER_LAYOUT: SpotStickerLayout = SPOT_STICKER_PRESETS['100x100'];

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
  pageSize?: PageSizeConfig;
  spotSticker?: SpotStickerLayout;
}

export const DEFAULT_BADGE_LAYOUT: BadgeLayout = {
  registration: { top: 2.10, left: 0.25, width: 3.5, fontSize: 0.22, color: '#cf252b' },
  qr: { top: 2.42, left: 1.35, size: 1.30 },
  name: { top: 3.85, left: 0.25, width: 3.5, fontSize: 0.25, color: '#0f172a' },
  pageSize: DEFAULT_PAGE_SIZE_CONFIG,
  spotSticker: DEFAULT_SPOT_STICKER_LAYOUT,
};

export const BADGE_WIDTH_IN = 4;
export const BADGE_HEIGHT_IN = 6;
// Position (in inches) of the bottom artwork landmark edge in the
// background artwork — used to stop the name/QR from overlapping it.
export const FOOTER_TOP_IN = 5.2;
// White quiet zone (in inches) maintained around the QR code.
export const QR_QUIET_ZONE_IN = 0.08;

function coercePageSize(raw: unknown): PageSizeConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_PAGE_SIZE_CONFIG;
  const p = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && isFinite(v) && v > 0 ? v : fallback;
  const preset = (p.preset === 'A4' || p.preset === 'A3' || p.preset === 'A6' || p.preset === 'custom')
    ? p.preset
    : 'A6';

  if (preset !== 'custom' && PRESET_PAGE_SIZES[preset]) {
    return PRESET_PAGE_SIZES[preset];
  }

  const columns = Math.max(1, Math.min(8, Math.floor(num(p.columns, 2))));
  const rows = Math.max(1, Math.min(8, Math.floor(num(p.rows, 2))));
  const sheetW = num(p.width_mm, 210);
  const sheetH = num(p.height_mm, 297);

  return {
    preset: 'custom',
    name: typeof p.name === 'string' && p.name ? p.name : 'Custom Page Size',
    width_mm: sheetW,
    height_mm: sheetH,
    columns,
    rows,
    badge_width_mm: num(p.badge_width_mm, Math.round((sheetW / columns) * 10) / 10),
    badge_height_mm: num(p.badge_height_mm, Math.round((sheetH / rows) * 10) / 10),
  };
}

export function coerceSpotSticker(raw: unknown): SpotStickerLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_SPOT_STICKER_LAYOUT;
  const s = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && isFinite(v) && v > 0 ? v : fallback;
  const col = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;

  const preset = (s.preset === '100x100' || s.preset === '100x75' || s.preset === '100x50' || s.preset === '75x50' || s.preset === 'custom')
    ? s.preset
    : '100x100';

  const base = preset !== 'custom' && SPOT_STICKER_PRESETS[preset]
    ? SPOT_STICKER_PRESETS[preset]
    : DEFAULT_SPOT_STICKER_LAYOUT;

  const reg = (s.registration ?? {}) as Record<string, unknown>;
  const qr = (s.qr ?? {}) as Record<string, unknown>;
  const name = (s.name_field ?? s.name ?? {}) as Record<string, unknown>;

  return {
    preset: preset as SpotStickerPreset,
    name: typeof s.name === 'string' && s.name && s.preset === 'custom' ? s.name : (base.name || 'Spot Sticker Layout'),
    width_mm: num(s.width_mm, base.width_mm),
    height_mm: num(s.height_mm, base.height_mm),
    registration: {
      top: num(reg.top, base.registration.top),
      left: num(reg.left, base.registration.left),
      width: num(reg.width, base.registration.width),
      fontSize: num(reg.fontSize, base.registration.fontSize),
      color: col(reg.color, base.registration.color),
    },
    qr: {
      top: num(qr.top, base.qr.top),
      left: num(qr.left, base.qr.left),
      size: num(qr.size, base.qr.size),
    },
    name_field: {
      top: num(name.top, base.name_field.top),
      left: num(name.left, base.name_field.left),
      width: num(name.width, base.name_field.width),
      fontSize: num(name.fontSize, base.name_field.fontSize),
      color: col(name.color, base.name_field.color),
    },
  };
}

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
    pageSize: coercePageSize(r.pageSize),
    spotSticker: coerceSpotSticker(r.spotSticker),
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
    try {
      await supabase.rpc('save_badge_layout_settings', { p_layout: layout });
    } catch {
      // ignore rpc fallback error
    }
    return { error: error ? error.message : null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error while saving';
    return { error: msg };
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
