import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { legacyClubPrefixGuard, legacyClubRedirectGuard } from './legacy-club-redirect.guard';
import { environment } from '../../../environments/environment';

function run(guard: (r: never, s: RouterStateSnapshot) => unknown, url: string): string {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const state = { url } as RouterStateSnapshot;
  const tree = TestBed.runInInjectionContext(() => guard({} as never, state)) as UrlTree;
  return TestBed.inject(Router).serializeUrl(tree);
}

describe('legacy club redirect guards', () => {
  const slug = environment.defaultClubSlug;

  it('prefixes an old admin sub-page and keeps its query string', () => {
    expect(run(legacyClubPrefixGuard as never, '/admin/agendas?x=1')).toBe(`/c/${slug}/admin/agendas?x=1`);
  });

  it('prefixes the bare member page', () => {
    expect(run(legacyClubPrefixGuard as never, '/member')).toBe(`/c/${slug}/member`);
  });

  it('still redirects legacy check-in links with the meeting param', () => {
    expect(run(legacyClubRedirectGuard('checkin') as never, '/checkin?meeting=42')).toBe(`/c/${slug}/checkin?meeting=42`);
  });
});
