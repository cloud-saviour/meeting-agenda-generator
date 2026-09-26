import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClubDetailsFormComponent } from './club-details-form.component';
import { ClubEditableFields, ClubRecord } from '../../../core/club/club-directory.service';

const club: ClubRecord = {
  id: 'club-a-id', slug: 'club-a', name: 'Alpha Club', subLine: 'Sub', addressLine: '1 Main Rd',
  logoLeft: 'logo.png', logoRight: 'crown.png', missionStatement: 'Mission', website: 'w', facebookPage: 'f',
  createdAt: '2026-01-01T00:00:00.000Z', active: true,
};

function create(showActive: boolean) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(ClubDetailsFormComponent);
  fixture.componentRef.setInput('club', club);
  fixture.componentRef.setInput('showActive', showActive);
  fixture.componentRef.setInput('backPath', '/back');
  fixture.detectChanges();
  return fixture;
}

describe('ClubDetailsFormComponent', () => {
  it('shows the active switch to platform admins only', () => {
    expect(create(true).nativeElement.querySelector('#c-active')).not.toBeNull();
    TestBed.resetTestingModule();
    expect(create(false).nativeElement.querySelector('#c-active')).toBeNull();
  });

  it('starts from the saved club and emits the edited values on submit', () => {
    const fixture = create(false);
    const cmp = fixture.componentInstance;
    const emitted: ClubEditableFields[] = [];
    cmp.submitted.subscribe((v) => emitted.push(v));

    expect(cmp.name()).toBe('Alpha Club');
    cmp.name.set('Alpha Renamed');
    cmp.logoLeft.set('data:new');
    cmp.submit();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ name: 'Alpha Renamed', logoLeft: 'data:new', logoRight: 'crown.png' });
  });

  it('does not submit a blank name', () => {
    const cmp = create(false).componentInstance;
    const emitted: ClubEditableFields[] = [];
    cmp.submitted.subscribe((v) => emitted.push(v));
    cmp.name.set('   ');
    cmp.submit();
    expect(emitted).toHaveLength(0);
  });

  it('undoLogo() goes back to the saved logo', () => {
    const cmp = create(false).componentInstance;
    cmp.logoRight.set('data:changed');
    cmp.undoLogo('right');
    expect(cmp.logoRight()).toBe('crown.png');
  });
});
