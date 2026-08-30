import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/pages/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/agenda-editor/pages/agenda-editor.component').then((m) => m.AgendaEditorComponent),
  },
  {
    path: 'admin/manage-roles',
    loadComponent: () => import('./features/admin-roles-hub/pages/admin-roles-hub.component').then((m) => m.AdminRolesHubComponent),
  },
  {
    path: 'admin/roles',
    loadComponent: () => import('./features/admin-roles/pages/admin-roles.component').then((m) => m.AdminRolesComponent),
  },
  {
    path: 'admin/committee-roles',
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
