import { Injectable, inject } from '@angular/core';
import { saveAs } from 'file-saver';
import { AgendaStateService } from './agenda-state.service';
import { AgendaSnapshot, MeetingData } from '../models/agenda.models';

/**
 * JSON export/import for the agenda editor. Depends on AgendaStateService,
 * reading and writing only through its public signals/methods — never the
 * reverse — so AgendaStateService has no knowledge of import/export.
 */
@Injectable({ providedIn: 'root' })
export class AgendaImportExportService {
  private readonly state = inject(AgendaStateService);

  getSnapshot(): AgendaSnapshot {
    const s = this.state;
    return {
      ...JSON.parse(JSON.stringify(s.meeting())),
      agItems: JSON.parse(JSON.stringify(s.agItems())),
      spks: JSON.parse(JSON.stringify(s.spks())),
      cmt: JSON.parse(JSON.stringify(s.cmt())),
      logoLeft: s.logoLeft(),
      logoRight: s.logoRight(),
      overriddenRoles: [...s.overriddenRoles()],
    } as AgendaSnapshot;
  }

  saveJSON(fileName: string): void {
    const snapshot = this.getSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    saveAs(blob, `${fileName}.json`);
  }

  loadSnapshot(data: AgendaSnapshot): void {
    const { agItems, spks, cmt, logoLeft, logoRight, overriddenRoles, ...meetingData } = data;

    this.state.meeting.set(meetingData as MeetingData);
    this.state.setAgItemsFromSnapshot(agItems);
    this.state.setSpeakersFromSnapshot(spks);

    if (cmt) {
      this.state.cmt.set(JSON.parse(JSON.stringify(cmt)));
    }
    if (logoLeft !== undefined) {
      this.state.logoLeft.set(logoLeft);
    }
    if (logoRight !== undefined) {
      this.state.logoRight.set(logoRight);
    }
    this.state.overriddenRoles.set(new Set(overriddenRoles ?? []));
  }
}
