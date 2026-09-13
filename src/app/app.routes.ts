import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { memberGuard } from './core/auth/member.guard';
import { superAdminGuard } from './core/auth/super-admin.guard';
import { agendaEditorCanDeactivateGuard } from './features/agenda-editor/pages/agenda-editor-can-deactivate.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/pages/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/signup/pages/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'member',
    canActivate: [memberGuard],
    loadComponent: () => import('./features/member/pages/member-dashboard.component').then((m) => m.MemberDashboardComponent),
  },
  {
    // Every /admin* route shares authGuard — declared once here on the
    // parent rather than on each child, since Angular runs a parent route's
    // guards for every navigation into any of its children. admin/audit-log
    // still layers its own superAdminGuard on top (see below) — redundant
    // with authGuard today (isAdmin() already implies isAppAdmin()), but
    // kept explicit since audit-log's access rule is deliberately stricter
    // and shouldn't silently depend on that implication holding forever.
    path: 'admin',
    canActivate: [authGuard],
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
  { path: '**', redirectTo: '' },
];
