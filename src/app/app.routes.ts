import { Routes } from '@angular/router';
import { HomeComponent } from './features/home/pages/home.component';
import { AgendaEditorComponent } from './features/agenda-editor/pages/agenda-editor.component';
import { CheckinComponent } from './features/checkin/pages/checkin.component';
import { AdminRolesComponent } from './features/admin-roles/pages/admin-roles.component';
import { AdminCommitteeRolesComponent } from './features/admin-committee-roles/pages/admin-committee-roles.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'admin', component: AgendaEditorComponent },
  { path: 'admin/roles', component: AdminRolesComponent },
  { path: 'admin/committee-roles', component: AdminCommitteeRolesComponent },
  { path: 'checkin', component: CheckinComponent },
  { path: '**', redirectTo: '' },
];
