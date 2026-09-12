import { Component, computed, inject } from '@angular/core';
import { AuditLogService } from '../services/audit-log.service';
import { AuditAction, AuditLogEntry } from '../../../core/audit/audit-log.models';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

/** Verbs (the part after the dot in an AuditAction) that read as undoing/removing something — everything else reads as adding/confirming something. Purely a display heuristic for badge color, not a meaningful category anywhere else. */
const NEGATIVE_VERBS = new Set(['revoke', 'archive', 'unassign', 'unpublish', 'delete', 'unconfirm']);

/** One row in the collapsed display — `latest` is the entry actually rendered; `count`/`first` cover the rest of the run when there's more than one. */
interface DisplayRow {
  latest: AuditLogEntry;
  first: AuditLogEntry;
  count: number;
}

/**
 * Route guarded by superAdminGuard, not authGuard — who granted/revoked
 * what should only be visible to a true claim-holder, even though any
 * app-admin can perform the grant/revoke itself (see AdminAdminsComponent
 * and AuthService's class doc).
 */
@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [NavbarComponent],
  templateUrl: './audit-log.component.html',
})
export class AuditLogComponent {
  readonly log = inject(AuditLogService);

  /**
   * Collapses a run of consecutive entries (log.entries() is already
   * most-recent-first) that share the same action/summary/actor into one
   * row with a count — a burst like the same "Published agenda #164"
   * repeated dozens of times in seconds (a real bug in the app's own
   * republish-on-edit effect, since fixed — see AgendaEditorComponent) is
   * still just one readable line here, not dozens. Legitimate distinct
   * activity (different meetings, different actors, different actions)
   * is never collapsed — only an exact, adjacent repeat.
   */
  readonly rows = computed<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [];
    for (const entry of this.log.entries()) {
      const top = rows[rows.length - 1];
      if (
        top &&
        top.latest.action === entry.action &&
        top.latest.summary === entry.summary &&
        top.latest.actorUid === entry.actorUid
      ) {
        top.first = entry; // entries() is newest-first, so the run's oldest member ends up last
        top.count++;
      } else {
        rows.push({ latest: entry, first: entry, count: 1 });
      }
    }
    return rows;
  });

  formatAt(at: string): string {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
  }

  /** e.g. "admin.grant" -> "Admin · grant" — a readable label with no per-action-type branching, so a new AuditAction never needs a matching UI change. */
  formatAction(action: AuditAction): string {
    const [category, verb] = action.split('.');
    return `${category.charAt(0).toUpperCase()}${category.slice(1)} · ${verb}`;
  }

  isNegative(action: AuditAction): boolean {
    const verb = action.split('.')[1];
    return NEGATIVE_VERBS.has(verb);
  }
}
