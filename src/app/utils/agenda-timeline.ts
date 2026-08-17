import { AgendaItem, Speaker } from '../models/agenda.models';

/**
 * One computed timeline entry per input `AgendaItem`, in the same order.
 * `time`/`timeA`/`timeB` are the "clock" strings shown to the reader
 * (e.g. "18h15"); other item kinds don't advance visibly but may still
 * move the underlying clock forward (see 'evaluators' below).
 */
export interface TimelineEntry {
  kind: 'row' | 'dual' | 'speakers' | 'evaluators' | 'notes';
  time?: string;   // 'row'
  timeA?: string;  // 'dual'
  timeB?: string;  // 'dual'
}

function toMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function fmMin(n: number): string {
  const h = Math.floor(n / 60) % 24;
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function aT(s: string): string {
  const [h, m] = s.split(':');
  return `${h}h${m}`;
}

/**
 * Simulates the meeting clock ticking through the agenda, item by item.
 * Shared by DocxService (export) and AgendaPreviewComponent (on-screen
 * preview) so both always agree on start times — see CLAUDE.md.
 */
export function computeAgendaTimeline(
  items: AgendaItem[],
  spks: Speaker[],
  startTime: string
): TimelineEntry[] {
  let t = toMin(startTime || '18:15');
  const tick = (n: number) => {
    const r = aT(fmMin(t));
    t += n;
    return r;
  };
  const peek = () => aT(fmMin(t));

  const result: TimelineEntry[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'row':
      case 'recess':
        result.push({ kind: 'row', time: tick(item.duration || 0) });
        break;
      case 'dual': {
        const timeA = tick(item.durationA || 10);
        const timeB = peek();
        spks.forEach((s) => { t += (s.timeHi || 7) + 2; });
        t += 1;
        result.push({ kind: 'dual', timeA, timeB });
        break;
      }
      case 'speakers':
        result.push({ kind: 'speakers' });
        break;
      case 'evaluators':
        spks.forEach(() => { t += 4; });
        result.push({ kind: 'evaluators' });
        break;
      case 'notes':
        result.push({ kind: 'notes' });
        break;
    }
  }
  return result;
}
