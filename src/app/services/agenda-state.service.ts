import { Injectable, signal, computed } from '@angular/core';
import { saveAs } from 'file-saver';
import {
  AgendaItem,
  AgendaSnapshot,
  CommitteeMember,
  MeetingData,
  Speaker,
} from '../models/agenda.models';

@Injectable({ providedIn: 'root' })
export class AgendaStateService {
  // ── Private counters ──────────────────────────────────────────────────────
  private agId = 0;
  private spId = 0;

  // ── State signals ─────────────────────────────────────────────────────────
  readonly meeting = signal<MeetingData>({
    no: '160',
    date: new Date().toISOString().slice(0, 10),
    arr: '18:00',
    st: '18:15',
    theme: '',
    word: '',
    club: '"King\'s Speakers" Club #12',
    sub: 'Phobians,',
    addr: '378 Queen\'s Cres, Lynnwood, Pretoria, 0001',
    mission:
      'Agora empowers you to become a brilliant communicator and a confident leader who will actively build a better world.',
    vpe: '',
    hotSeat: '',
    reserve: '',
    apologies: '',
    period: 'Aug 2025 – February 2026',
    web: 'http://www.agoraspeakers.org/',
    fb: 'Agora Speakers South Africa',
  });

  readonly spks = signal<Speaker[]>([]);

  readonly cmt = signal<CommitteeMember[]>(
    [
      'President',
      'Secretary',
      'VP Education',
      'Community Manager',
      'VP Membership',
      'RSA Ambassador',
      'Treasurer',
    ].map((role) => ({ role, name: '', email: '', phone: '' }))
  );

  readonly agItems = signal<AgendaItem[]>(this.defaultAgenda());

  readonly logoLeft = signal<string>('logo.png');
  readonly logoRight = signal<string>('crown.png');

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly agendaFileName = computed(() => {
    const d = this.meeting();
    const dt = d.date ? new Date(d.date + 'T00:00:00') : null;
    const datePart = dt
      ? dt.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'draft';
    return `Agora Agenda - Meeting ${d.no || '?'} - ${datePart}`;
  });

  // ── Meeting methods ───────────────────────────────────────────────────────
  updateMeeting(patch: Partial<MeetingData>): void {
    this.meeting.update((m) => ({ ...m, ...patch }));
  }

  // ── AgendaItem methods ────────────────────────────────────────────────────
  addAgItem(type: AgendaItem['type']): void {
    const id = ++this.agId;
    let item: AgendaItem;

    switch (type) {
      case 'row':
        item = {
          id,
          type: 'row',
          title: 'New item',
          person: '',
          roleLabel: null,
          duration: 5,
        } as AgendaItem;
        break;
      case 'dual':
        item = {
          id,
          type: 'dual',
          durationA: 10,
          items: [
            { title: 'Session A', person: '', roleLabel: null },
            { title: 'Session B', person: '', roleLabel: null },
          ],
        } as AgendaItem;
        break;
      case 'speakers':
        item = { id, type: 'speakers' } as AgendaItem;
        break;
      case 'evaluators':
        item = { id, type: 'evaluators' } as AgendaItem;
        break;
      case 'recess':
        item = { id, type: 'recess', title: 'Recess', duration: 15 } as AgendaItem;
        break;
      case 'notes':
        item = { id, type: 'notes', text: '' } as AgendaItem;
        break;
      default:
        item = {
          id,
          type: 'row',
          title: 'New item',
          person: '',
          roleLabel: null,
          duration: 5,
        } as AgendaItem;
    }

    this.agItems.update((items) => [...items, item]);
  }

  removeAgItem(id: number): void {
    this.agItems.update((items) => items.filter((i) => i.id !== id));
  }

  updateAgItem(id: number, field: string, value: any): void {
    this.agItems.update((items) =>
      items.map((i) => (i.id === id ? ({ ...i, [field]: value } as AgendaItem) : i))
    );
  }

  updateDualSubItem(id: number, subIdx: 0 | 1, field: string, value: any): void {
    this.agItems.update((items) =>
      items.map((i) => {
        if (i.id !== id || i.type !== 'dual') return i;
        const newSubs: [typeof i.items[0], typeof i.items[1]] = [
          { ...i.items[0] },
          { ...i.items[1] },
        ];
        newSubs[subIdx] = { ...newSubs[subIdx], [field]: value };
        return { ...i, items: newSubs } as AgendaItem;
      })
    );
  }

  moveAgItem(fromIdx: number, toIdx: number): void {
    this.agItems.update((items) => {
      const arr = [...items];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  }

  resetToDefaultAgenda(): void {
    this.agId = 0;
    this.agItems.set(this.defaultAgenda());
  }

  // ── Speaker methods ───────────────────────────────────────────────────────
  addSpeaker(d?: Partial<Speaker>): void {
    const id = ++this.spId;
    const speaker: Speaker = {
      id,
      name: d?.name ?? '',
      level: d?.level ?? '',
      timeLo: d?.timeLo ?? 7,
      timeHi: d?.timeHi ?? 10,
      title: d?.title ?? '',
      evaluator: d?.evaluator ?? '',
    };
    this.spks.update((spks) => [...spks, speaker]);
  }

  removeSpeaker(id: number): void {
    this.spks.update((spks) => spks.filter((s) => s.id !== id));
  }

  updateSpeaker(id: number, field: keyof Speaker, value: any): void {
    this.spks.update((spks) =>
      spks.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, [field]: value };
        // Enforce timeLo <= timeHi
        if (field === 'timeLo' && updated.timeLo > updated.timeHi) {
          updated.timeHi = updated.timeLo;
        }
        if (field === 'timeHi' && updated.timeHi < updated.timeLo) {
          updated.timeLo = updated.timeHi;
        }
        return updated;
      })
    );
  }

  // ── Committee methods ─────────────────────────────────────────────────────
  updateCommitteeMember(index: number, field: keyof CommitteeMember, value: string): void {
    this.cmt.update((members) =>
      members.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  // ── Logo methods ──────────────────────────────────────────────────────────
  setLogo(side: 'left' | 'right', dataUrl: string): void {
    if (side === 'left') {
      this.logoLeft.set(dataUrl);
    } else {
      this.logoRight.set(dataUrl);
    }
  }

  resetLogo(side: 'left' | 'right'): void {
    if (side === 'left') {
      this.logoLeft.set('logo.png');
    } else {
      this.logoRight.set('crown.png');
    }
  }

  // ── JSON methods ──────────────────────────────────────────────────────────
  getSnapshot(): AgendaSnapshot {
    const m = this.meeting();
    return {
      ...JSON.parse(JSON.stringify(m)),
      agItems: JSON.parse(JSON.stringify(this.agItems())),
      spks: JSON.parse(JSON.stringify(this.spks())),
      cmt: JSON.parse(JSON.stringify(this.cmt())),
      logoLeft: this.logoLeft(),
      logoRight: this.logoRight(),
    } as AgendaSnapshot;
  }

  saveJSON(): void {
    const snapshot = this.getSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    saveAs(blob, `${this.agendaFileName()}.json`);
  }

  loadSnapshot(data: AgendaSnapshot): void {
    const { agItems, spks, cmt, logoLeft, logoRight, ...meetingData } = data;

    this.meeting.set(meetingData as MeetingData);

    // Reset agId to max id found in snapshot
    const maxAgId = agItems.reduce((max, item) => Math.max(max, item.id), 0);
    this.agId = maxAgId;
    this.agItems.set(JSON.parse(JSON.stringify(agItems)));

    // Reset speakers
    this.spId = 0;
    this.spks.set([]);
    for (const spk of spks) {
      this.addSpeaker(spk);
    }

    if (cmt) {
      this.cmt.set(JSON.parse(JSON.stringify(cmt)));
    }

    if (logoLeft !== undefined) {
      this.logoLeft.set(logoLeft);
    }
    if (logoRight !== undefined) {
      this.logoRight.set(logoRight);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private defaultAgenda(): AgendaItem[] {
    const cmt = this.cmt();
    return [
      {
        id: ++this.agId,
        type: 'row',
        title: 'Call to order',
        person: cmt[1]?.name || '',
        roleLabel: 'Secretary',
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Welcome',
        person: cmt[0]?.name || '',
        roleLabel: 'President',
        duration: 3,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Meeting Leader (Evening Chairman)',
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Programme Information',
        person: cmt[2]?.name || '',
        roleLabel: 'VPE',
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Timekeeper (explain role)',
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Grammarian (explain role)',
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Filler Word Counter (explain role)',
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Introductions',
        person: '',
        roleLabel: 'Evening Chairman',
        duration: 16,
      },
      {
        id: ++this.agId,
        type: 'dual',
        durationA: 10,
        items: [
          { title: 'Impromptu Session', person: '', roleLabel: 'Impromptu Master' },
          { title: 'Prepared Speaking Session', person: '', roleLabel: 'Evening Chairman' },
        ],
      },
      {
        id: ++this.agId,
        type: 'speakers',
      },
      {
        id: ++this.agId,
        type: 'recess',
        title: 'Recess',
        duration: 15,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Call to order',
        person: cmt[1]?.name || '',
        roleLabel: 'Secretary',
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Evaluation Session',
        person: '',
        roleLabel: 'Evening Chairman',
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'evaluators',
      },
      {
        id: ++this.agId,
        type: 'row',
        title: "Timekeeper's Report",
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: "Grammarian's Report",
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: "Filler Word Counter's Report",
        person: '',
        roleLabel: null,
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Meeting Evaluator',
        person: '',
        roleLabel: null,
        duration: 5,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Educational',
        person: '',
        roleLabel: null,
        duration: 10,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Planning for Next Meeting',
        person: cmt[2]?.name || '',
        roleLabel: 'VPE',
        duration: 2,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Awards/Open Discussion',
        person: cmt[0]?.name || '',
        roleLabel: 'President',
        duration: 4,
      },
      {
        id: ++this.agId,
        type: 'row',
        title: 'Meeting Adjourned',
        person: cmt[0]?.name || '',
        roleLabel: 'President',
        duration: 0,
      },
    ] as AgendaItem[];
  }
}
