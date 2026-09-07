import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { signal } from '@angular/core';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function callGuard(url: string): Promise<boolean | UrlTree> {
  return TestBed.runInInjectionContext(() => authGuard({} as never, { url } as never)) as Promise<
    boolean | UrlTree
  >;
}

function fakeAuth(opts: { ready: boolean; isAdmin: boolean }) {
  return {
    ready: signal(opts.ready),
    isAdmin: signal(opts.isAdmin),
    currentUser: signal(null),
  } as unknown as AuthService;
}

describe('authGuard', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function run(auth: AuthService, url = '/admin') {
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    router = TestBed.inject(Router);
    return callGuard(url);
  }

  it('allows navigation when ready and isAdmin', async () => {
    const result = await run(fakeAuth({ ready: true, isAdmin: true }));
    expect(result).toBe(true);
  });

  it('redirects to /login when ready but not admin', async () => {
    const result = await run(fakeAuth({ ready: true, isAdmin: false }), '/admin/roles');
    expect(String(result)).toContain('/login');
    expect(String(result)).toContain(encodeURIComponent('/admin/roles'));
  });

  it('waits for ready() before deciding', async () => {
    const readySignal = signal(false);
    const auth = { ready: readySignal, isAdmin: signal(true), currentUser: signal(null) } as unknown as AuthService;
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    const resultPromise = callGuard('/admin');

    let resolved = false;
    resultPromise.then(() => (resolved = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    readySignal.set(true);
    const result = await resultPromise;
    expect(result).toBe(true);
  });
});
