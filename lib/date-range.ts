/**
 * Date-range parsing for ?from=YYYY-MM-DD&to=YYYY-MM-DD&preset=...
 *
 * Presets: today | yesterday | 7d | 30d | mtd | qtd | ytd | custom
 *
 * Every dashboard page accepts these query params; serverside we resolve
 * them into concrete ISO date strings before hitting Supabase.
 */

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'mtd' | 'qtd' | 'ytd' | 'custom';

export interface DateRange {
  preset: Preset;
  from:   string;   // YYYY-MM-DD (inclusive)
  to:     string;   // YYYY-MM-DD (inclusive)
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

export function resolveRange(input?: { preset?: string; from?: string; to?: string }): DateRange {
  const now = new Date();
  const today = startOfDay(now);

  const preset = (input?.preset as Preset | undefined) ?? '30d';

  const explicit = input?.from && input?.to;
  if (explicit) {
    return { preset: 'custom', from: input!.from!, to: input!.to! };
  }

  let from: Date;
  let to: Date = today;

  switch (preset) {
    case 'today':
      from = today;
      break;
    case 'yesterday':
      from = new Date(today); from.setUTCDate(today.getUTCDate() - 1);
      to   = new Date(from);
      break;
    case '7d':
      from = new Date(today); from.setUTCDate(today.getUTCDate() - 6);
      break;
    case 'mtd':
      from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      break;
    case 'qtd': {
      const q = Math.floor(today.getUTCMonth() / 3);
      from = new Date(Date.UTC(today.getUTCFullYear(), q * 3, 1));
      break;
    }
    case 'ytd':
      from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      break;
    case '30d':
    default:
      from = new Date(today); from.setUTCDate(today.getUTCDate() - 29);
      break;
  }

  return { preset: preset === 'custom' ? '30d' : preset, from: ymd(from), to: ymd(to) };
}

export function rangeToQuery(r: DateRange): string {
  return `preset=${r.preset}&from=${r.from}&to=${r.to}`;
}
