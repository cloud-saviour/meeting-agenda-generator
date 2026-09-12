import { CanDeactivateFn } from '@angular/router';
import { AgendaEditorComponent } from './agenda-editor.component';

/**
 * Guards every way of navigating away from /admin in-app (the navbar's
 * Home/My Agendas/Manage Roles links, or the browser back button within
 * the SPA) — not just newAgenda()'s own confirm(). Saving stopped being
 * automatic once AgendaEditorComponent got an explicit Save button, so
 * without this, clicking any nav link with unsaved changes would silently
 * discard them (a beforeunload listener only covers an actual tab
 * close/refresh/external navigation, not Angular's own router).
 */
export const agendaEditorCanDeactivateGuard: CanDeactivateFn<AgendaEditorComponent> = (component) => {
  if (!component.isDirty) return true;
  return confirm('Leave without saving? Unsaved changes to this agenda will be lost.');
};
