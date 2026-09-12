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
    path: 'admin',
    canActivate: [authGuard],
    canDeactivate: [agendaEditorCanDeactivateGuard],
    loadComponent: () => import('./features/agenda-editor/pages/agenda-editor.component').then((m) => m.AgendaEditorComponent),
  },
  {
    path: 'admin/agendas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-agendas/pages/admin-agendas.component').then((m) => m.AdminAgendasComponent),
  },
  {
    path: 'admin/manage-agendas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-agendas-hub/pages/admin-agendas-hub.component').then((m) => m.AdminAgendasHubComponent),
  },
  {
    path: 'admin/manage-roles',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-roles-hub/pages/admin-roles-hub.component').then((m) => m.AdminRolesHubComponent),
  },
  {
    path: 'admin/roles',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-roles/pages/admin-roles.component').then((m) => m.AdminRolesComponent),
  },
  {
    path: 'admin/committee-roles',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-committee-roles/pages/admin-committee-roles.component').then((m) => m.AdminCommitteeRolesComponent),
  },
  {
    path: 'admin/manage-admins',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin-admins/pages/admin-admins.component').then((m) => m.AdminAdminsComponent),
  },
  {
    path: 'admin/audit-log',
    canActivate: [superAdminGuard],
    loadComponent: () => import('./features/admin-audit-log/pages/audit-log.component').then((m) => m.AuditLogComponent),
  },
  {
    path: 'checkin',
    loadComponent: () => import('./features/checkin/pages/checkin.component').then((m) => m.CheckinComponent),
  },
  {
    // memberGuard, not authGuard — a published agenda is for members to read,
    // not only admins. Guarded (unlike /checkin, which stays anonymous by
    // design) because the agenda exposes names plus committee contact details;
    // firestore.rules enforces the same thing on the data itself.
    path: 'preview',
    canActivate: [memberGuard],
    loadComponent: () => import('./features/agenda-viewer/pages/agenda-viewer.component').then((m) => m.AgendaViewerComponent),
  },
  { path: '**', redirectTo: '' },
];
