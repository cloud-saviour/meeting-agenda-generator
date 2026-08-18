import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AgendaEditorComponent } from './pages/agenda-editor/agenda-editor.component';
import { CheckinComponent } from './pages/checkin/checkin.component';
import { AdminRolesComponent } from './pages/admin-roles/admin-roles.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'admin', component: AgendaEditorComponent },
  { path: 'admin/roles', component: AdminRolesComponent },
  { path: 'checkin', component: CheckinComponent },
  { path: '**', redirectTo: '' },
];
