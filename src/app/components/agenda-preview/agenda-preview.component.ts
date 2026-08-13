import { Component, inject, ViewEncapsulation } from '@angular/core';
import { AgendaStateService } from '../../services/agenda-state.service';
import { AgendaDualItem, AgendaNotesItem, AgendaRecessItem, AgendaRowItem, CommitteeMember } from '../../models/agenda.models';

interface RenderedRow {
  time: string;
  timeB?: string;
  title?: string;
  titleB?: string;
  roleLabel?: string | null;
  roleLabelB?: string | null;
  person?: string;
  personB?: string;
  isDual: boolean;
}

type Segment =
  | { type: 'table'; rows: RenderedRow[] }
  | { type: 'speakers' }
  | { type: 'evaluators' }
  | { type: 'notes'; text: string };

@Component({
  selector: 'app-agenda-preview',
  standalone: true,
  templateUrl: './agenda-preview.component.html',
  encapsulation: ViewEncapsulation.None,
})
export class AgendaPreviewComponent {
  readonly state = inject(AgendaStateService);

  get d() {
    return this.state.meeting();
  }
  get agItems() {
    return this.state.agItems();
  }
  get spks() {
    return this.state.spks();
  }
  get cmt() {
    return this.state.cmt();
  }
  get logoLeft() {
    return this.state.logoLeft();
  }
  get logoRight() {
    return this.state.logoRight();
  }

  get arrFmt(): string {
    return (this.d.arr || '18:00').replace(':', 'h');
  }
  get stFmt(): string {
    return (this.d.st || '18:15').replace(':', 'h');
  }
  get dateStr(): string {
    if (!this.d.date) return '';
    return new Date(this.d.date + 'T00:00:00').toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  get hasNotes(): boolean {
    return !!(this.d.hotSeat || this.d.reserve || this.d.apologies);
  }

  get cmtPairs(): [CommitteeMember | undefined, CommitteeMember | undefined][] {
    const c = this.cmt;
    return [
      [c[0], c[1]],
      [c[2], c[3]],
      [c[4], c[5]],
    ];
  }
  get cmtTreasurer(): CommitteeMember | undefined {
    return this.cmt[6];
  }

  private get renderedAgenda(): { row?: RenderedRow; kind: 'row' | 'speakers' | 'evaluators' | 'notes'; text?: string }[] {
    const toMin = (s: string) => {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    const fmMin = (n: number) => {
      const h = Math.floor(n / 60) % 24,
        m = n % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    const aT = (s: string) => {
      const [h, m] = s.split(':');
      return `${h}h${m}`;
    };
    let t = toMin(this.d.st || '18:15');
    const tick = (n: number) => {
      const r = aT(fmMin(t));
      t += n;
      return r;
    };
    const peek = () => aT(fmMin(t));

    const result: { row?: RenderedRow; kind: 'row' | 'speakers' | 'evaluators' | 'notes'; text?: string }[] = [];

    for (const item of this.agItems) {
      if (item.type === 'row' || item.type === 'recess') {
        const it = item as AgendaRowItem | AgendaRecessItem;
        result.push({
          kind: 'row',
          row: {
            time: tick(it.duration || 0),
            title: it.title,
            roleLabel: 'roleLabel' in it ? it.roleLabel : null,
            person: 'person' in it ? it.person : '',
            isDual: false,
          },
        });
      } else if (item.type === 'dual') {
        const it = item as AgendaDualItem;
        const a = it.items[0],
          b = it.items[1];
        const tA = tick(it.durationA || 10);
        const tB = peek();
        this.spks.forEach((s) => {
          t += (s.timeHi || 7) + 2;
        });
        t += 1;
        result.push({
          kind: 'row',
          row: {
            time: tA,
            timeB: tB,
            title: a.title,
            titleB: b.title,
            roleLabel: a.roleLabel,
            roleLabelB: b.roleLabel,
            person: a.person,
            personB: b.person,
            isDual: true,
          },
        });
      } else if (item.type === 'speakers') {
        result.push({ kind: 'speakers' });
      } else if (item.type === 'evaluators') {
        this.spks.forEach(() => {
          t += 4;
        });
        result.push({ kind: 'evaluators' });
      } else if (item.type === 'notes') {
        const it = item as AgendaNotesItem;
        if (it.text) result.push({ kind: 'notes', text: it.text });
      }
    }
    return result;
  }

  get agendaSegments(): Segment[] {
    const segs: Segment[] = [];
    let cur: RenderedRow[] = [];
    const flush = () => {
      if (cur.length) {
        segs.push({ type: 'table', rows: cur });
        cur = [];
      }
    };
    for (const r of this.renderedAgenda) {
      if (r.kind === 'row' && r.row) {
        cur.push(r.row);
      } else if (r.kind === 'speakers') {
        flush();
        segs.push({ type: 'speakers' });
      } else if (r.kind === 'evaluators') {
        flush();
        segs.push({ type: 'evaluators' });
      } else if (r.kind === 'notes') {
        flush();
        segs.push({ type: 'notes', text: r.text || '' });
      }
    }
    flush();
    return segs;
  }

  personStr(role: string | null | undefined, name: string | undefined): { role: string; name: string } {
    return { role: role || '', name: name || '' };
  }

  notesHtml(text: string): string {
    return text.replace(/\n/g, '<br>');
  }
}
