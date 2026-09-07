import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { UrlTree } from '@angular/router';
import { signal } from '@angular/core';
import { memberGuard } from './member.guard';
import { AuthService } from './auth.service';

describe('memberGuard', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function run(auth: AuthService, url = '/member'): Promise<boolean | UrlTree> {
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return TestBed.runInInjectionContext(() => memberGuard({} as never, { url } as never)) as Promise<
      boolean | UrlTree
    >;
  }

  it('allows a signed-in NON-admin account through — unlike authGuard', async () => {
    const auth = {
      ready: signal(true),
      isAdmin: signal(false),
      currentUser: signal({ uid: 'member-uid' }),
    } as unknown as AuthService;

    const result = await run(auth);
    expect(result).toBe(true);
  });

  it('allows a signed-in admin through too', async () => {
    const auth = {
      ready: signal(true),
      isAdmin: signal(true),
      currentUser: signal({ uid: 'admin-uid' }),
    } as unknown as AuthService;

    const result = await run(auth);
    expect(result).toBe(true);
  });

  it('redirects to /login when nobody is signed in', async () => {
    const auth = {
      ready: signal(true),
      isAdmin: signal(false),
      currentUser: signal(null),
    } as unknown as AuthService;

    const result = await run(auth, '/member');
    expect(String(result)).toContain('/login');
    expect(String(result)).toContain(encodeURIComponent('/member'));
  });
});
