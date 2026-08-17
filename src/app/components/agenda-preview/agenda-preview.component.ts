import { Component, inject, ViewEncapsulation } from '@angular/core';
import { AgendaStateService } from '../../services/agenda-state.service';
import { AgendaDualItem, CommitteeMember } from '../../models/agenda.models';
import { computeAgendaTimeline } from '../../utils/agenda-timeline';
import { APP_LOCALE } from '../../utils/locale';

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
    return new Date(this.d.date + 'T00:00:00').toLocaleDateString(APP_LOCALE, {
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
    const timeline = computeAgendaTimeline(this.agItems, this.spks, this.d.st || '18:15');
    const result: { row?: RenderedRow; kind: 'row' | 'speakers' | 'evaluators' | 'notes'; text?: string }[] = [];

    this.agItems.forEach((item, i) => {
      const entry = timeline[i];
      switch (item.type) {
        case 'row':
        case 'recess':
          result.push({
            kind: 'row',
            row: {
              time: entry.time!,
              title: item.title,
              roleLabel: 'roleLabel' in item ? item.roleLabel : null,
              person: 'person' in item ? item.person : '',
              isDual: false,
            },
          });
          break;
        case 'dual': {
          const it: AgendaDualItem = item;
          const a = it.items[0], b = it.items[1];
          result.push({
            kind: 'row',
            row: {
              time: entry.timeA!,
              timeB: entry.timeB!,
              title: a.title,
              titleB: b.title,
              roleLabel: a.roleLabel,
              roleLabelB: b.roleLabel,
              person: a.person,
              personB: b.person,
              isDual: true,
            },
          });
          break;
        }
        case 'speakers':
          result.push({ kind: 'speakers' });
          break;
        case 'evaluators':
          result.push({ kind: 'evaluators' });
          break;
        case 'notes':
          if (item.text) result.push({ kind: 'notes', text: item.text });
          break;
      }
    });
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
