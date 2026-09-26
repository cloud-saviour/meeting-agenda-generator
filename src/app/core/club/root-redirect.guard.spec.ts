import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { rootRedirectGuard } from './root-redirect.guard';
import { AuthService } from '../auth/auth.service';

async function run(isAdmin: boolean): Promise<string> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { ready: signal(true), isAdmin: signal(isAdmin) } }],
  });
  const result = await TestBed.runInInjectionContext(() => rootRedirectGuard({} as never, {} as never));
  return result === true ? 'shows the picker' : TestBed.inject(Router).serializeUrl(result as UrlTree);
}

describe('rootRedirectGuard', () => {
  it('sends a platform admin to the clubs list', async () => {
    expect(await run(true)).toBe('/platform/clubs');
  });

  it('lets everyone else through to the club picker', async () => {
    expect(await run(false)).toBe('shows the picker');
  });
});
