import { Routes } from '@angular/router';
import { AgendaEditorComponent } from './pages/agenda-editor/agenda-editor.component';
import { CheckinComponent } from './pages/checkin/checkin.component';
import { AdminRolesComponent } from './pages/admin-roles/admin-roles.component';

export const routes: Routes = [
  { path: '', component: AgendaEditorComponent },
  { path: 'checkin', component: CheckinComponent },
  { path: 'admin/roles', component: AdminRolesComponent },
  { path: '**', redirectTo: '' },
];
