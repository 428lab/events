"""Explicitly approved staging mutations; durable intent precedes every first PUT.

D1/R2 are not one transaction. Resume reconciliation is mandatory after uncertainty.
Only one operator workspace may own a target batch; see runbook crash limits.
"""
import os
from pathlib import Path
import tempfile

from thumbnail_backfill import (SafetyError, alive, current, digest, encode,
                                evidence, keys, save, validate_output)


def same(obj, expected):
    return (obj is None and expected is None) or bool(obj and expected and
            obj['sha256'] == expected['sha256'] and obj['metadata'] == expected['metadata'])


def backup_path(path, entry):
    return path.parent / ('backup-' + digest(keys(entry['row'])[1].encode()))


def checkpoint(path, state, entry, status):
    entry['status'] = status
    save(path, state)


def cas_flag(api, row, before, after):
    result = api.query('''UPDATE event_photo SET has_thumbnail=?
 WHERE id=? AND event_id=? AND user_id=? AND created_at=? AND kind=? AND has_thumbnail=?
 AND EXISTS (SELECT 1 FROM user u WHERE u.id=event_photo.user_id AND u.deleted_at IS NULL)
 AND EXISTS (SELECT 1 FROM event e WHERE e.id=event_photo.event_id)''',
                       [after, row['id'], row['event_id'], row['user_id'], row['created_at'], row['kind'], before])
    if result['meta']['changes'] != 1:
        raise SafetyError('flag_cas_conflict_reconcile_required')


def remove_owned_orphan(api, state, path, entry):
    """Never restores a deleted user's asset; removes only our known generated hash."""
    _, key = keys(entry['row'])
    obj = api.object(key)
    if same(obj, entry['output']):
        api.object(key, 'DELETE')
        if api.object(key) is not None:
            raise SafetyError('orphan_delete_readback_failed')
    elif obj is not None:
        raise SafetyError('orphan_object_conflict_manual_review')
    backup_path(path, entry).unlink(missing_ok=True)
    checkpoint(path, state, entry, 'orphan_compensated')


def rollback(api, state, path, entry):
    row = current(api, entry['row'])
    if not alive(row, entry['row']):
        return remove_owned_orphan(api, state, path, entry)
    _, key = keys(entry['row'])
    obj = api.object(key)
    old = entry['old']
    if not same(obj, old) and not same(obj, entry['output']):
        raise SafetyError('rollback_object_conflict_manual_review')
    checkpoint(path, state, entry, 'rollback_intent')
    if old is not None:
        data = backup_path(path, entry).read_bytes()
        if digest(data) != old['sha256'] or len(data) != old['bytes']:
            raise SafetyError('backup_integrity_failure')
        if not alive(current(api, entry['row']), entry['row']):
            return remove_owned_orphan(api, state, path, entry)
        if not same(obj, old):
            api.object(key, 'PUT', data, old['metadata'])
        if not same(api.object(key), old):
            raise SafetyError('rollback_readback_failure')
        # The restored object may itself have raced deletion. Mark its hash as ours
        # for compensation/recovery without treating another writer's object as ours.
        row = current(api, entry['row'])
        if not alive(row, entry['row']):
            restored = api.object(key)
            if same(restored, old):
                api.object(key, 'DELETE')
                if api.object(key) is not None:
                    raise SafetyError('rollback_orphan_delete_failed')
            elif restored is not None:
                raise SafetyError('rollback_orphan_conflict')
            backup_path(path, entry).unlink(missing_ok=True)
            return checkpoint(path, state, entry, 'orphan_compensated')
        if row['has_thumbnail'] != entry['row']['has_thumbnail']:
            cas_flag(api, row, row['has_thumbnail'], entry['row']['has_thumbnail'])
    else:
        # Clear flag BEFORE deleting a newly created variant. Never restore a
        # pre-existing dangling flag=1 when the original object did not exist.
        if row['has_thumbnail'] != 0:
            cas_flag(api, row, row['has_thumbnail'], 0)
        if not same(api.object(key), obj):
            raise SafetyError('rollback_delete_conflict')
        if obj is not None:
            api.object(key, 'DELETE')
        if api.object(key) is not None:
            raise SafetyError('rollback_delete_readback_failed')
    row = current(api, entry['row'])
    if not alive(row, entry['row']):
        # Re-enter the rollback path: it knows the restored object's hash.
        return reconcile(api, state, path, entry)
    expected_flag = entry['row']['has_thumbnail'] if old else 0
    if row['has_thumbnail'] != expected_flag or not same(api.object(key), old):
        raise SafetyError('rollback_final_verification_failed')
    checkpoint(path, state, entry, 'rolled_back')


def reconcile(api, state, path, entry):
    row = current(api, entry['row'])
    _, key = keys(entry['row'])
    if not alive(row, entry['row']):
        # Recovery may find an old object restored just before process death.
        obj = api.object(key)
        if entry['status'] == 'rollback_intent' and entry['old'] and same(obj, entry['old']):
            api.object(key, 'DELETE')
            if api.object(key) is not None:
                raise SafetyError('rollback_orphan_delete_failed')
            backup_path(path, entry).unlink(missing_ok=True)
            return checkpoint(path, state, entry, 'orphan_compensated')
        return remove_owned_orphan(api, state, path, entry)
    if entry['status'] == 'rollback_intent':
        return rollback(api, state, path, entry)
    obj = api.object(key)
    if not same(obj, entry['output']):
        if same(obj, entry['old']):
            # Intent saved but PUT did not land; restore/verify the original flag.
            return rollback(api, state, path, entry)
        raise SafetyError('recovery_object_conflict_manual_review')
    with tempfile.TemporaryDirectory(dir=path.parent, prefix='media-') as temp:
        validate_output(obj, Path(temp))
    source = api.object(keys(entry['row'])[0])
    if not same(source, entry['source']):
        return rollback(api, state, path, entry)
    row = current(api, entry['row'])
    if not alive(row, entry['row']):
        return remove_owned_orphan(api, state, path, entry)
    if row['has_thumbnail'] not in (entry['row']['has_thumbnail'], 1):
        raise SafetyError('unexpected_flag_state')
    if row['has_thumbnail'] != 1:
        cas_flag(api, row, row['has_thumbnail'], 1)
    # Re-read object AND row after flag CAS; on uncertainty leave durable intent.
    if not same(api.object(key), entry['output']):
        row = current(api, entry['row'])
        if alive(row, entry['row']) and row['has_thumbnail'] == 1:
            cas_flag(api, row, 1, 0)
        raise SafetyError('post_flag_object_changed_reconcile_required')
    if not alive(current(api, entry['row']), entry['row']):
        return remove_owned_orphan(api, state, path, entry)
    checkpoint(path, state, entry, 'verified')


def apply(api, state, path, entry):
    row = current(api, entry['row'])
    if not alive(row, entry['row']) or row['has_thumbnail'] != entry['row']['has_thumbnail']:
        return checkpoint(path, state, entry, 'skip_changed_row')
    source_key, key = keys(row)
    source = api.object(source_key)
    old = api.object(key)
    if not same(source, entry['source']) or not same(old, entry['old']):
        return checkpoint(path, state, entry, 'skip_changed_object')
    with tempfile.TemporaryDirectory(dir=path.parent, prefix='media-') as temp:
        output, _ = encode(source, Path(temp))
        if not same(output, entry['output']):
            raise SafetyError('encoder_changed_repeat_dry_run_in_new_workspace')
        if old:
            backup = backup_path(path, entry)
            if backup.exists():
                if backup.is_symlink() or digest(backup.read_bytes()) != old['sha256']:
                    raise SafetyError('existing_backup_conflict')
            else:
                with open(backup, 'xb') as f:
                    f.write(old['data'])
                    f.flush()
                    os.fsync(f.fileno())
        # Durable intent includes original flag, exact keys (via immutable row),
        # hashes, source identity, output metadata and backup identity.
        checkpoint(path, state, entry, 'intent')
        if not alive(current(api, row), row):
            return checkpoint(path, state, entry, 'skip_changed_row')
        if not same(api.object(source_key), entry['source']) or not same(api.object(key), entry['old']):
            return checkpoint(path, state, entry, 'skip_changed_object')
        api.object(key, 'PUT', output['data'], output['metadata'])
        reconcile(api, state, path, entry)


def operate(api, state, path, mode, batch):
    if not state.get('inventory_complete'):
        raise SafetyError('complete_dry_run_required')
    pending = [e for e in state['entries'] if e['status'] in ('intent', 'rollback_intent')]
    if mode == 'apply':
        # Never start new work while an earlier outcome is uncertain.
        selected = pending[:batch] if pending else [e for e in state['entries'] if e['status'] == 'ready'][:batch]
        for entry in selected:
            (reconcile if entry in pending else apply)(api, state, path, entry)
    elif mode == 'rollback':
        selected = [e for e in state['entries'] if e['status'] in ('intent', 'rollback_intent', 'verified')][:batch]
        for entry in selected:
            rollback(api, state, path, entry)
    else:
        if pending:
            selected = pending[:batch]
        else:
            completed = [e for e in state['entries'] if e['status'] == 'verified']
            cursor = state.get('reconcile_cursor', 0)
            selected = completed[cursor:cursor + batch]
            state['reconcile_cursor'] = cursor + len(selected) if cursor + len(selected) < len(completed) else 0
        for entry in selected:
            reconcile(api, state, path, entry)
        save(path, state)
