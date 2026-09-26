import { Routes } from '@angular/router';
import { memberGuard } from './core/auth/member.guard';
import { superAdminGuard } from './core/auth/super-admin.guard';
import { clubContextGuard } from './core/club/club-context.guard';
import { clubAdminGuard } from './core/club/club-admin.guard';
import { legacyClubRedirectGuard } from './core/club/legacy-club-redirect.guard';
import { agendaEditorCanDeactivateGuard } from './features/agenda-editor/pages/agenda-editor-can-deactivate.guard';
import { environment } from '../environments/environment';

export const routes: Routes = [
  // No club-picker UI yet (groundwork-only multi-club pass — see CLAUDE.md)
  // — bare `/` always lands on the one club scripts/migrate-to-clubs.mjs
  // provisions today.
  { path: '', redirectTo: `/c/${environment.defaultClubSlug}`, pathMatch: 'full' },

  // Stay bare, unprefixed by any club — a Firebase account (real-claim
  // admin or self-service member) is global, not club-scoped, see
  // AuthService's class doc.
  {
    path: 'login',
    loadComponent: () => import('./features/login/pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/signup/pages/signup.component').then((m) => m.SignupComponent),
  },

  // Backward compatibility for already-shared, query-param-based check-in/
  // preview links pointing at the one club that existed before multi-club
  // routing — see legacy-club-redirect.guard.ts's own doc comment. `canActivate`
  // guards that return a UrlTree redirect without ever rendering a component,
  // so no `loadComponent` is needed on either of these.
  { path: 'checkin', canActivate: [legacyClubRedirectGuard('checkin')], children: [] },
  { path: 'preview', canActivate: [legacyClubRedirectGuard('preview')], children: [] },

  {
    // clubContextGuard resolves :clubSlug to a club before any child route
    // renders — every route below is scoped to that one club's own data.
    path: 'c/:clubSlug',
    canActivate: [clubContextGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/home/pages/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'member',
        canActivate: [memberGuard],
        loadComponent: () => import('./features/member/pages/member-dashboard.component').then((m) => m.MemberDashboardComponent),
      },
      {
        // Every admin/* route shares clubAdminGuard — declared once here on
        // the parent rather than on each child, since Angular runs a
        // parent route's guards for every navigation into any of its
        // children. admin/audit-log still layers its own superAdminGuard
        // on top (see below) — that one stays global/real-claim-only,
        // deliberately not club-aware (see firestore.rules' header
        // comment on isAdmin() vs isAppAdmin(clubId)).
        path: 'admin',
        canActivate: [clubAdminGuard],
        children: [
          {
            path: '',
            canDeactivate: [agendaEditorCanDeactivateGuard],
            loadComponent: () => import('./features/agenda-editor/pages/agenda-editor.component').then((m) => m.AgendaEditorComponent),
          },
          {
            path: 'agendas',
            loadComponent: () => import('./features/admin-agendas/pages/admin-agendas.component').then((m) => m.AdminAgendasComponent),
          },
          {
            // Admin-only preview of a SAVED draft, published or not —
            // distinct from the public preview route below, which only
            // ever shows the currently published meeting.
            path: 'preview',
            loadComponent: () => import('./features/agenda-viewer/pages/agenda-draft-preview.component').then((m) => m.AgendaDraftPreviewComponent),
          },
          {
            path: 'hub',
            loadComponent: () => import('./features/admin-hub/pages/admin-hub.component').then((m) => m.AdminHubComponent),
          },
          {
            path: 'manage-agendas',
            loadComponent: () => import('./features/admin-agendas-hub/pages/admin-agendas-hub.component').then((m) => m.AdminAgendasHubComponent),
          },
          {
            path: 'manage-roles',
            loadComponent: () => import('./features/admin-roles-hub/pages/admin-roles-hub.component').then((m) => m.AdminRolesHubComponent),
          },
          {
            path: 'roles',
            loadComponent: () => import('./features/admin-roles/pages/admin-roles.component').then((m) => m.AdminRolesComponent),
          },
          {
            path: 'committee-roles',
            loadComponent: () => import('./features/admin-committee-roles/pages/admin-committee-roles.component').then((m) => m.AdminCommitteeRolesComponent),
          },
          {
            path: 'manage-admins',
            loadComponent: () => import('./features/admin-admins/pages/admin-admins.component').then((m) => m.AdminAdminsComponent),
          },
          {
            path: 'audit-log',
            canActivate: [superAdminGuard],
            loadComponent: () => import('./features/admin-audit-log/pages/audit-log.component').then((m) => m.AuditLogComponent),
          },
        ],
      },
      {
        path: 'checkin',
        loadComponent: () => import('./features/checkin/pages/checkin.component').then((m) => m.CheckinComponent),
      },
      {
        path: 'preview',
        loadComponent: () => import('./features/agenda-viewer/pages/agenda-viewer.component').then((m) => m.AgendaViewerComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
