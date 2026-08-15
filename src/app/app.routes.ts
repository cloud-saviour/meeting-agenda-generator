import { Routes } from '@angular/router';
import { AgendaEditorComponent } from './pages/agenda-editor/agenda-editor.component';
import { CheckinComponent } from './pages/checkin/checkin.component';

export const routes: Routes = [
  { path: '', component: AgendaEditorComponent },
  { path: 'checkin', component: CheckinComponent },
  { path: '**', redirectTo: '' },
];
