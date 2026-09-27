import { Component, Input, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ClubContextService } from '../../core/club/club-context.service';
import { PublishedAgendaService } from '../../features/agenda-editor/services/published-agenda.service';
import { NavArea, activeKey, areaFromUrl, buildMenu, meetingFromUrl } from './nav-menu';

/**
 * The app's single top bar. The links are NOT supplied by pages: the menu is
 * built here from who is looking and where they are (see nav-menu.ts), so it
 * is the same on every page and only the page's title and the projected action
 * buttons (`<ng-content>`, e.g. the Agenda Editor's Save/Export) differ.
 */
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly clubContext = inject(ClubContextService);
  private readonly published = inject(PublishedAgendaService);

  @Input() title = '';
  /**
   * Uses `position:sticky` (Bootstrap's `.sticky-top`) so the nav stays pinned
   * to the top. Deliberately `sticky`, not `fixed`: a fixed nav is removed from
   * document flow, which used to force every page to hardcode a top offset that
   * broke as soon as the nav wrapped. `sticky` keeps its real height in flow.
   */
  @Input() fixed = false;
  /** agenda-editor only, for its existing d-print-none behavior. */
  @Input() printHidden = false;

  readonly currentUser = this.auth.currentUser;
  /** Phone only: whether the collapsed menu is open. */
  readonly menuOpen = signal(false);

  private readonly url = signal(this.router.url);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.menuOpen.set(false);
      });
  }

  readonly menu = computed(() => {
    const url = this.url();
    const { area, clubSlug } = areaFromUrl(url);
    const path = url.split(/[?#]/)[0];
    return buildMenu({
      area: area as NavArea,
      clubSlug,
      signedIn: this.auth.currentUser() !== null,
      isClubAdmin: this.clubContext.isAppAdmin(),
      isPlatformAdmin: this.auth.isAdmin(),
      // The meeting this page is about, else the nearest published one.
      meetingNo: meetingFromUrl(url) ?? this.published.nearestEntry()?.no ?? null,
      authPage: path === '/login' ? 'login' : path === '/signup' ? 'signup' : undefined,
    });
  });

  readonly active = computed(() => activeKey(this.url()));

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  signOut() {
    this.auth.signOut().then(() => this.router.navigateByUrl('/'));
  }
}
