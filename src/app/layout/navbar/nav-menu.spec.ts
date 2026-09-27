import { describe, expect, it } from 'vitest';
import { NavContext, activeKey, areaFromUrl, buildMenu, meetingFromUrl } from './nav-menu';

const base: NavContext = {
  area: 'club', clubSlug: 'k12', signedIn: false, isClubAdmin: false, isPlatformAdmin: false, meetingNo: null,
};
const keys = (ctx: Partial<NavContext>) => buildMenu({ ...base, ...ctx }).map((i) => i.key);

describe('buildMenu', () => {
  it('guest with nothing published: Home and Sign in only', () => {
    expect(keys({})).toEqual(['home', 'signin']);
  });

  it('adds Check in and Agenda (with the meeting) when a meeting is published', () => {
    const items = buildMenu({ ...base, meetingNo: '43' });
    expect(items.map((i) => i.key)).toEqual(['home', 'checkin', 'agenda', 'signin']);
    expect(items[1]).toMatchObject({ path: '/c/k12/checkin', queryParams: { meeting: '43' } });
  });

  it('member: My Account instead of Sign in, no admin links', () => {
    expect(keys({ signedIn: true, meetingNo: '43' })).toEqual(['home', 'checkin', 'agenda', 'account']);
  });

  it('club admin: Agendas then Admin after the member links', () => {
    expect(keys({ signedIn: true, isClubAdmin: true, meetingNo: '43' }))
      .toEqual(['home', 'checkin', 'agenda', 'account', 'agendas', 'admin']);
  });

  it('platform admin also gets Clubs, last', () => {
    expect(keys({ signedIn: true, isClubAdmin: true, isPlatformAdmin: true }))
      .toEqual(['home', 'account', 'agendas', 'admin', 'clubs']);
  });

  it('platform pages show only Clubs, and nothing to a non-platform user', () => {
    expect(keys({ area: 'platform', clubSlug: null, isPlatformAdmin: true, isClubAdmin: true })).toEqual(['clubs']);
    expect(keys({ area: 'platform', clubSlug: null })).toEqual([]);
  });

  it('login and sign-up offer Home plus the other page, without any club links', () => {
    expect(keys({ area: 'auth', clubSlug: null, authPage: 'login', meetingNo: '43' })).toEqual(['home', 'signup']);
    expect(keys({ area: 'auth', clubSlug: null, authPage: 'signup' })).toEqual(['home', 'signin']);
  });
});

describe('url helpers', () => {
  it('reads the area and club slug from a URL', () => {
    expect(areaFromUrl('/c/k12/admin/hub')).toEqual({ area: 'club', clubSlug: 'k12' });
    expect(areaFromUrl('/platform/clubs')).toEqual({ area: 'platform', clubSlug: null });
    expect(areaFromUrl('/login?returnUrl=%2Fc%2Fk12')).toEqual({ area: 'auth', clubSlug: null });
  });

  it('reads the meeting query parameter', () => {
    expect(meetingFromUrl('/c/k12/checkin?meeting=43')).toBe('43');
    expect(meetingFromUrl('/c/k12/checkin?meeting=')).toBeNull();
    expect(meetingFromUrl('/c/k12/checkin')).toBeNull();
  });

  it('highlights the section the URL belongs to', () => {
    expect(activeKey('/c/k12')).toBe('home');
    expect(activeKey('/c/k12/checkin?meeting=1')).toBe('checkin');
    expect(activeKey('/c/k12/preview')).toBe('agenda');
    expect(activeKey('/c/k12/member')).toBe('account');
    for (const p of ['/admin', '/admin/agendas', '/admin/manage-agendas', '/admin/preview?meeting=1']) {
      expect(activeKey('/c/k12' + p)).toBe('agendas');
    }
    for (const p of ['/admin/hub', '/admin/roles', '/admin/committee-roles', '/admin/manage-roles', '/admin/members', '/admin/manage-admins', '/admin/club', '/admin/audit-log']) {
      expect(activeKey('/c/k12' + p)).toBe('admin');
    }
    expect(activeKey('/platform/members')).toBe('clubs');
    expect(activeKey('/login')).toBe('signin');
  });
});
