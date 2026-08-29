import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AgendaImportExportService } from './agenda-import-export.service';
import { AgendaStateService } from './agenda-state.service';

describe('AgendaImportExportService', () => {
  let importExport: AgendaImportExportService;
  let state: AgendaStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    importExport = TestBed.inject(AgendaImportExportService);
    state = TestBed.inject(AgendaStateService);
  });

  it('getSnapshot() reflects the current AgendaStateService state', () => {
    state.updateMeeting({ theme: 'Leadership' });
    const snapshot = importExport.getSnapshot();
    expect(snapshot.theme).toBe('Leadership');
    expect(snapshot.agItems.length).toBe(state.agItems().length);
    expect(snapshot.cmt.length).toBe(state.cmt().length);
  });

  it('round-trips: getSnapshot -> loadSnapshot -> getSnapshot produces an equivalent snapshot', () => {
    state.updateMeeting({ theme: 'Round Trip Test' });
    state.addSpeaker({ name: 'Naledi K.', title: 'My Talk' });

    const before = importExport.getSnapshot();
    importExport.loadSnapshot(before);
    const after = importExport.getSnapshot();

    expect(after.theme).toBe('Round Trip Test');
    expect(after.spks.length).toBe(1);
    expect(after.spks[0].name).toBe('Naledi K.');
    expect(after.agItems.length).toBe(before.agItems.length);
  });

  it('loadSnapshot() resets the agenda id counter to the max id present in the imported data', () => {
    importExport.loadSnapshot({
      ...importExport.getSnapshot(),
      agItems: [{ id: 500, type: 'row', title: 'Imported', person: '', roleId: '', roleVisible: true, customRoleLabel: null, duration: 1 }],
    });
    state.addAgItem('row');
    const newItem = state.agItems()[state.agItems().length - 1];
    expect(newItem.id).toBe(501);
  });

  it('loadSnapshot() replaces speakers via addSpeaker so ids are freshly assigned starting from 1', () => {
    importExport.loadSnapshot({
      ...importExport.getSnapshot(),
      spks: [
        { id: 999, name: 'A', level: '', timeLo: 5, timeHi: 7, title: '', evaluator: '', roleId: 'evaluator', roleVisible: true },
        { id: 998, name: 'B', level: '', timeLo: 5, timeHi: 7, title: '', evaluator: '', roleId: 'evaluator', roleVisible: true },
      ],
    });
    expect(state.spks().map((s) => s.id)).toEqual([1, 2]);
    expect(state.spks().map((s) => s.name)).toEqual(['A', 'B']);
  });
});
