/**
 * Every action type the audit trail covers — deliberately scoped to
 * meaningful, admin-initiated changes to shared app data, not every write
 * in the app. Notably excluded: role/committee-role label edits
 * (`update()`) and JSON-import upserts (`setDefinition()`/`replaceAll()`).
 * `agenda.save` covers `SavedAgendaService.save()` — this used to be
 * excluded too, back when it fired automatically on every keystroke
 * (debounced ~500ms), which would have flooded the log with no real
 * signal; now that saving is an explicit Save-button click (see
 * AgendaEditorComponent), each one is exactly as meaningful as
 * `agenda.publish`/`agenda.delete` and gets the same treatment.
 *
 * Lives in core, not the admin-audit-log feature, because several
 * core/services and other features' services need it to call
 * appendAuditEntry() — core must not depend on a feature.
 */
export type AuditAction =
  | 'admin.grant'
  | 'admin.revoke'
  | 'role.create'
  | 'role.archive'
  | 'role.restore'
  | 'committeeRole.create'
  | 'committeeRole.archive'
  | 'committeeRole.restore'
  | 'committeeRoster.assign'
  | 'committeeRoster.unassign'
  | 'agenda.save'
  | 'agenda.publish'
  | 'agenda.unpublish'
  | 'agenda.delete'
  | 'attendance.confirm'
  | 'attendance.unconfirm';

/**
 * One immutable entry in the append-only `auditLog` collection — see
 * AuditLogService (read, in the admin-audit-log feature) and
 * appendAuditEntry() below (the only way anything gets written, always
 * inside the same writeBatch() as the change itself). `summary` is a
 * human-readable one-liner built by the writer at write time — this is
 * what AuditLogComponent renders directly, so adding a new action type
 * never requires a matching change in the UI's rendering logic.
 */
export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorUid: string;
  actorEmail: string;
  at: string;
  summary: string;
}
