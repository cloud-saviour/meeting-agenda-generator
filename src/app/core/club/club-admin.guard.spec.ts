import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { signal } from '@angular/core';
import { clubAdminGuard } from './club-admin.guard';
import { ClubContextService } from './club-context.service';

function callGuard(url: string): Promise<boolean | UrlTree> {
  return TestBed.runInInjectionContext(() => clubAdminGuard({} as never, { url } as never)) as Promise<
    boolean | UrlTree
  >;
}

function fakeClubContext(isAppAdmin: boolean) {
  return { isAppAdmin: signal(isAppAdmin) } as unknown as ClubContextService;
}

describe('clubAdminGuard', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function run(clubContext: ClubContextService, url = '/c/kings-speakers-12/admin') {
    TestBed.configureTestingModule({ providers: [{ provide: ClubContextService, useValue: clubContext }] });
    return callGuard(url);
  }

  // No ready()-wait case here, unlike the old global authGuard — this guard
  // only ever runs nested under c/:clubSlug, and Angular guarantees the
  // parent route's clubContextGuard has already fully resolved (including
  // waiting on readiness) before a child guard like this one runs at all.
  // See club-admin.guard.ts's own doc comment.

  it('allows navigation for an app-admin of the current club', async () => {
    const result = await run(fakeClubContext(true));
    expect(result).toBe(true);
  });

  it('redirects to /login, preserving the return url, for a non-admin', async () => {
    const result = await run(fakeClubContext(false), '/c/kings-speakers-12/admin/roles');
    expect(String(result)).toContain('/login');
    expect(String(result)).toContain(encodeURIComponent('/c/kings-speakers-12/admin/roles'));
  });
});
