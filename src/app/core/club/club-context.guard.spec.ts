import { beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { clubContextGuard } from './club-context.guard';
import { ClubContextService } from './club-context.service';
import { AuthService } from '../auth/auth.service';

function setup(opts: { resolves: boolean; unavailable: boolean }) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { ready: signal(true), isAdmin: signal(false) } },
      { provide: ClubContextService, useValue: { setClub: async () => opts.resolves, unavailable: () => opts.unavailable } },
    ],
  });
}

async function run(slug: string | null): Promise<string> {
  const route = { paramMap: convertToParamMap(slug ? { clubSlug: slug } : {}) } as ActivatedRouteSnapshot;
  const result = await TestBed.runInInjectionContext(() => clubContextGuard(route, {} as never));
  return result === true ? 'allow' : TestBed.inject(Router).serializeUrl(result as UrlTree);
}

describe('clubContextGuard', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('allows an active club that resolves', async () => {
    setup({ resolves: true, unavailable: false });
    expect(await run('kings-speakers-12')).toBe('allow');
  });

  it('sends an unknown slug to the root', async () => {
    setup({ resolves: false, unavailable: false });
    expect(await run('nope')).toBe('/');
  });

  it('sends everyone but a platform admin to /club-unavailable for a deactivated club', async () => {
    setup({ resolves: true, unavailable: true });
    expect(await run('closed-club')).toBe('/club-unavailable');
  });

  it('sends a missing slug to the root', async () => {
    setup({ resolves: true, unavailable: false });
    expect(await run(null)).toBe('/');
  });
});
