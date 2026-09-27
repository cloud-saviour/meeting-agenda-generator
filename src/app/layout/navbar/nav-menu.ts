/**
 * The one navigation menu shown on every page. It is built from WHO is
 * looking and WHERE they are, never from what a page chooses to pass in, so
 * the same links appear in the same order everywhere; a link that does not
 * apply to the viewer is absent rather than swapped for another.
 */

export type NavArea = 'club' | 'platform' | 'auth';

export type NavKey = 'home' | 'checkin' | 'agenda' | 'account' | 'agendas' | 'admin' | 'clubs' | 'signin' | 'signup';

export interface NavItem {
  key: NavKey;
  label: string;
  /** Absolute router path (already includes /c/<slug> where relevant). */
  path: string;
  queryParams?: Record<string, string>;
}

export interface NavContext {
  area: NavArea;
  /** Slug of the club the current URL is inside (`/c/<slug>/...`), if any. */
  clubSlug: string | null;
  signedIn: boolean;
  isClubAdmin: boolean;
  isPlatformAdmin: boolean;
  /** Meeting the Check in / Agenda links point at; null hides both. */
  meetingNo: string | null;
  /** Which auth page this is, to offer the other one (area 'auth' only). */
  authPage?: 'login' | 'signup';
}

/** Where the viewer is, from a router URL. */
export function areaFromUrl(url: string): { area: NavArea; clubSlug: string | null } {
  const path = url.split(/[?#]/)[0];
  const club = /^\/c\/([^/]+)/.exec(path);
  if (club) return { area: 'club', clubSlug: club[1] };
  if (path.startsWith('/platform')) return { area: 'platform', clubSlug: null };
  return { area: 'auth', clubSlug: null };
}

/** The `meeting` query parameter of a router URL, if present and non-blank. */
export function meetingFromUrl(url: string): string | null {
  const query = url.split('#')[0].split('?')[1];
  if (!query) return null;
  const value = new URLSearchParams(query).get('meeting');
  return value && value.trim() ? value : null;
}

export function buildMenu(ctx: NavContext): NavItem[] {
  if (ctx.area === 'platform') {
    return ctx.isPlatformAdmin ? [{ key: 'clubs', label: '🏢 Clubs', path: '/platform/clubs' }] : [];
  }

  if (ctx.area === 'auth' || !ctx.clubSlug) {
    const items: NavItem[] = [{ key: 'home', label: '🏠 Home', path: '/' }];
    if (ctx.authPage === 'login') items.push({ key: 'signup', label: '📝 Create account', path: '/signup' });
    if (ctx.authPage === 'signup') items.push({ key: 'signin', label: '🔑 Sign in', path: '/login' });
    return items;
  }

  const base = `/c/${ctx.clubSlug}`;
  const items: NavItem[] = [{ key: 'home', label: '🏠 Home', path: base }];
  if (ctx.meetingNo) {
    items.push(
      { key: 'checkin', label: '👥 Check in', path: `${base}/checkin`, queryParams: { meeting: ctx.meetingNo } },
      { key: 'agenda', label: '📋 Preview Recent Plan', path: `${base}/preview`, queryParams: { meeting: ctx.meetingNo } },
    );
  }
  if (ctx.signedIn) items.push({ key: 'account', label: '👤 My Account', path: `${base}/member` });
  if (ctx.isClubAdmin) {
    items.push(
      { key: 'agendas', label: '📝 Agendas', path: `${base}/admin/manage-agendas` },
      { key: 'admin', label: '⚙ Admin', path: `${base}/admin/hub` },
    );
  }
  if (ctx.isPlatformAdmin) items.push({ key: 'clubs', label: '🏢 Clubs', path: '/platform/clubs' });
  if (!ctx.signedIn) items.push({ key: 'signin', label: '🔑 Sign in', path: '/login' });
  return items;
}

/** Which menu item the current URL belongs to, so the right one is highlighted. */
export function activeKey(url: string): NavKey | null {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  if (path.startsWith('/platform')) return 'clubs';
  if (path === '/login') return 'signin';
  if (path === '/signup') return 'signup';
  const rest = path.replace(/^\/c\/[^/]+/, '');
  if (rest === '') return 'home';
  if (rest.startsWith('/checkin')) return 'checkin';
  if (rest.startsWith('/preview')) return 'agenda';
  if (rest.startsWith('/member')) return 'account';
  if (rest === '/admin' || /^\/admin\/(agendas|manage-agendas|preview)(\/|$)/.test(rest)) return 'agendas';
  if (rest.startsWith('/admin')) return 'admin';
  return null;
}
