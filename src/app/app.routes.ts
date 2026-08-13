import { Routes } from '@angular/router';
import { AgendaEditorComponent } from './pages/agenda-editor/agenda-editor.component';
import { SignupComponent } from './pages/signup/signup.component';

export const routes: Routes = [
  { path: '', component: AgendaEditorComponent },
  { path: 'signup', component: SignupComponent },
  { path: '**', redirectTo: '' },
];
