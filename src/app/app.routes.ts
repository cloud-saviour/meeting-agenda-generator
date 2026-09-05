import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

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
    path: 'admin',
    canActivate: [authGuard],
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
    path: 'checkin',
    loadComponent: () => import('./features/checkin/pages/checkin.component').then((m) => m.CheckinComponent),
  },
  {
    path: 'preview',
    loadComponent: () => import('./features/agenda-viewer/pages/agenda-viewer.component').then((m) => m.AgendaViewerComponent),
  },
  { path: '**', redirectTo: '' },
];
