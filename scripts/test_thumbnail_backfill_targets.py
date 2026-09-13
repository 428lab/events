"""Focused offline target isolation and bounded multi-page inventory checks."""
import argparse
import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import thumbnail_backfill as core


class ThumbnailBackfillTargetTests(unittest.TestCase):
    def cli(self, environment, directory, *extra):
        args = ['thumbnail_backfill.py', '--workspace', str(directory)]
        for key, value in core.TARGETS[environment].items():
            args.extend(['--' + key, value])
        with patch.object(sys, 'argv', args + list(extra)), contextlib.redirect_stdout(io.StringIO()):
            core.main()

    def api(self, environment):
        with patch.object(core, 'credential', return_value='offline-test'):
            return core.Cloudflare(target=core.TARGETS[environment])

    def test_pinned_targets_and_mixed_resources_rejected_before_credentials(self):
        with patch.object(core, 'credential') as credential:
            for environment, target in core.TARGETS.items():
                self.assertEqual(core.check_target(argparse.Namespace(**target)), target)
                for field in target:
                    mixed = {**target, field: 'wrong'}
                    if field != 'account':
                        other = 'production' if environment == 'staging' else 'staging'
                        mixed[field] = core.TARGETS[other][field]
                    with self.subTest(environment=environment, field=field):
                        with self.assertRaisesRegex(core.SafetyError, 'target_mismatch'):
                            core.Cloudflare(target=mixed)
            credential.assert_not_called()

    def test_repository_binding_mismatch_rejected(self):
        config = core.tomllib.loads((core.ROOT / 'wrangler.toml').read_text())
        for environment in core.TARGETS:
            for field in ('database_id', 'database_name', 'bucket_name', 'ENVIRONMENT', 'account_id'):
                changed = copy.deepcopy(config)
                selected = changed['env']['staging'] if environment == 'staging' else changed
                if field.startswith('database_'):
                    selected['d1_databases'][0][field] = 'wrong'
                elif field == 'bucket_name':
                    selected['r2_buckets'][0][field] = 'wrong'
                elif field == 'ENVIRONMENT':
                    selected['vars'][field] = 'wrong'
                else:
                    changed[field] = 'wrong'
                with self.subTest(environment=environment, field=field):
                    with patch.object(core.tomllib, 'loads', return_value=changed), patch.object(core, 'credential') as credential:
                        with self.assertRaisesRegex(core.SafetyError, 'repository_target_mismatch'):
                            core.Cloudflare(target=core.TARGETS[environment])
                        credential.assert_not_called()

    def test_default_transport_remains_staging_and_instances_are_isolated(self):
        with patch.object(core, 'credential', return_value='offline-test'):
            stage = core.Cloudflare()
            production_target = core.TARGETS['production'].copy()
            production = core.Cloudflare(target=production_target)
        production_target['bucket'] = 'wrong'
        self.assertEqual(stage.target, core.TARGET)
        self.assertEqual(production.target, core.TARGETS['production'])
        self.assertFalse(stage.allow_write)
        self.assertFalse(production.allow_write)

    def test_acknowledgements_fail_closed_for_every_mutating_mode(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(core, 'Cloudflare') as api:
            for environment in core.TARGETS:
                other = 'production' if environment == 'staging' else 'staging'
                for mode in ('apply', 'reconcile', 'rollback'):
                    for approvals in ([], ['--approve-' + other + '-writes'],
                                      ['--approve-staging-writes', '--approve-production-writes']):
                        with self.subTest(environment=environment, mode=mode, approvals=approvals):
                            with self.assertRaisesRegex(core.SafetyError, 'approval'):
                                self.cli(environment, directory, '--mode', mode, *approvals)
            api.assert_not_called()

    def test_default_dry_run_and_matching_acknowledgement_dispatch(self):
        import thumbnail_backfill_writer as writer
        for environment, target in core.TARGETS.items():
            with tempfile.TemporaryDirectory() as directory, patch.object(core, 'Cloudflare') as api:
                with patch.object(core, 'dry_run') as dry_run:
                    self.cli(environment, directory)
                api.assert_called_once_with(False, target=target)
                self.assertEqual(dry_run.call_args.args[1]['target'], target)
                self.assertEqual(dry_run.call_args.args[3], 5)
                # Persist a complete synthetic inventory to exercise CLI dispatch only.
                core.save(Path(directory) / 'manifest.json', {
                    'version': core.VERSION, 'target': target, 'entries': [], 'inventory_complete': True})
                for mode in ('apply', 'reconcile', 'rollback'):
                    api.reset_mock()
                    with patch.object(writer, 'operate') as operate:
                        self.cli(environment, directory, '--mode', mode, '--approve-' + environment + '-writes')
                    api.assert_called_once_with(True, target=target)
                    self.assertEqual(operate.call_args.args[3:], (mode, 5))

    def test_cross_environment_and_v1_manifests_rejected_before_transport(self):
        for environment in core.TARGETS:
            other = 'production' if environment == 'staging' else 'staging'
            for target, version in ((core.TARGETS[other], 2), (core.TARGETS[environment], 1)):
                with tempfile.TemporaryDirectory() as directory, patch.object(core, 'Cloudflare') as api:
                    core.save(Path(directory) / 'manifest.json', {'target': target, 'version': version})
                    before = (Path(directory) / 'manifest.json').read_bytes()
                    for mode in ('dry-run', 'apply', 'reconcile', 'rollback'):
                        with self.assertRaisesRegex(core.SafetyError, 'manifest_target_or_version_mismatch'):
                            self.cli(environment, directory, '--mode', mode, '--approve-' + environment + '-writes')
                    api.assert_not_called()
                    self.assertEqual((Path(directory) / 'manifest.json').read_bytes(), before)

    def test_production_v1_import_is_rejected_before_transport(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(core, 'Cloudflare') as api:
            with self.assertRaisesRegex(core.SafetyError, 'v1_import_staging_only'):
                self.cli('production', directory, '--import-v1', 'manifest.json')
            api.assert_not_called()
        with self.assertRaisesRegex(core.SafetyError, 'v1_import_staging_only'):
            core.import_read_only_v1(self.api('production'), Path('manifest.json'), Path('new/manifest.json'))

    def test_selected_target_used_by_all_remote_paths(self):
        for environment, target in core.TARGETS.items():
            api = self.api(environment)
            self.assertTrue(api.base.endswith('/accounts/' + target['account']))
            with patch.object(api, 'json', return_value=[{'success': True, 'meta': {'rows_written': 0}}]) as request:
                api.query('SELECT 1')
                self.assertEqual(request.call_args.args[0], '/d1/database/' + target['database'] + '/query')
            with patch.object(api, 'json', return_value={'result': []}) as request:
                self.assertIsNone(api.stored_metadata('event-photos/e/p'))
                self.assertTrue(request.call_args.args[0].startswith('/r2/buckets/' + target['bucket'] + '/objects?'))
            stored = {'metadata': {'content-type': 'image/webp'}, 'etag': 'etag', 'bytes': 1}
            with patch.object(api, 'stored_metadata', return_value=stored), patch.object(api, 'request', return_value=(b'x', {'ETag': 'etag'})) as request:
                api.object('event-videos/e/p-poster')
                self.assertEqual(request.call_args.args[0], '/r2/buckets/' + target['bucket'] + '/objects/event-videos/e/p-poster')
                api.allow_write = True
                for method in ('PUT', 'DELETE'):
                    api.object('event-videos/e/p-thumbnail', method, b'x')
                    self.assertEqual(request.call_args.args[:2], ('/r2/buckets/' + target['bucket'] + '/objects/event-videos/e/p-thumbnail', method))

    def test_remote_identity_and_missing_migration_fail_closed(self):
        for environment, target in core.TARGETS.items():
            api = self.api(environment)
            db = {'uuid': target['database'], 'name': core.DATABASE_NAMES[environment]}
            bucket = {'name': target['bucket']}
            for wrong_db, wrong_bucket in (({**db, 'uuid': 'wrong'}, bucket),
                                            ({**db, 'name': 'wrong'}, bucket), (db, {'name': 'wrong'})):
                with patch.object(api, 'json', side_effect=[wrong_db, wrong_bucket]), patch.object(api, 'query') as query:
                    with self.assertRaisesRegex(core.SafetyError, 'remote_target_mismatch'):
                        api.preflight()
                    query.assert_not_called()
            for columns in ([], [{'name': 'has_thumbnail'}]):
                with patch.object(api, 'json', side_effect=[db, bucket]) as request, patch.object(api, 'query', return_value={'results': columns}) as query:
                    if columns:
                        api.preflight()
                    else:
                        with self.assertRaisesRegex(core.SafetyError, 'migration_0089_required_no_auto_migration'):
                            api.preflight()
                    self.assertEqual([call.args[0] for call in request.call_args_list],
                                     ['/d1/database/' + target['database'], '/r2/buckets/' + target['bucket']])
                    query.assert_called_once_with("SELECT name FROM pragma_table_info('event_photo')")

    def test_production_read_only_and_original_mutation_guards(self):
        api = self.api('production')
        with patch.object(api, 'request') as request:
            with self.assertRaisesRegex(core.SafetyError, 'remote_write_disabled'):
                api.query('UPDATE event_photo SET has_thumbnail=1')
            for method in ('PUT', 'DELETE'):
                with self.assertRaisesRegex(core.SafetyError, 'remote_write_disabled'):
                    api.object('event-photos/e/p-thumbnail', method)
            api.allow_write = True
            for key in ('event-photos/e/p', 'event-videos/e/p', 'event-videos/e/p-poster'):
                for method in ('PUT', 'DELETE'):
                    with self.assertRaisesRegex(core.SafetyError, 'only_thumbnail_mutation_allowed'):
                        api.object(key, method)
            request.assert_not_called()
        with patch.object(api, 'json', return_value=[{'success': True, 'meta': {'rows_written': 1}}]):
            with self.assertRaisesRegex(core.SafetyError, 'unexpected_d1_write'):
                api.query('SELECT 1')

    def test_batch_bounds_before_transport(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(core, 'Cloudflare') as api:
            for batch in (0, 26):
                with self.assertRaisesRegex(core.SafetyError, 'batch_must_be_1_to_25'):
                    self.cli('production', directory, '--batch', str(batch))
            api.assert_not_called()

    def test_inventory_over_25_resumes_boundedly_without_duplicate_or_truncation(self):
        rows = [dict(id=f'media-{i:03}', event_id='e', user_id='u', created_at=1,
                     kind='video' if i % 2 else 'photo', has_thumbnail=i % 2,
                     admin_hidden_at=None, deleted_at=None, existing_event='e') for i in range(60)]
        source = {'data': b'synthetic-image', 'sha256': 'source', 'bytes': 15, 'metadata': {}}
        output = {**source, 'sha256': 'output'}
        class InventoryAPI:
            def __init__(self):
                self.pages = []
                self.keys = []
            def query(self, sql, params=()):
                if 'GROUP BY' in sql:
                    return {'results': [{'kind': 'photo', 'has_thumbnail': 0, 'n': 30},
                                        {'kind': 'video', 'has_thumbnail': 1, 'n': 30}]}
                self.pages.append(tuple(params))
                return {'results': [row for row in rows if row['id'] > params[0]][:params[1]]}
            def object(self, key):
                self.keys.append(key)
                return None if key.endswith('-thumbnail') else source
        for batch, expected_lengths in ((25, [25, 50, 60]), (5, list(range(5, 61, 5)) + [60])):
            api = InventoryAPI()
            with tempfile.TemporaryDirectory() as directory, patch.object(core, 'current', side_effect=lambda api, row: row), patch.object(core, 'encode', return_value=(output, {'width': 640, 'height': 480})):
                path = Path(directory) / 'manifest.json'
                state = {'version': 2, 'target': core.TARGETS['production'], 'entries': []}
                for length in expected_lengths:
                    core.dry_run(api, state, path, batch)
                    state = json.loads(path.read_text())  # Actual persisted cursor across invocations.
                    self.assertEqual(len(state['entries']), length)
                self.assertTrue(state['inventory_complete'])
                self.assertEqual([entry['row']['id'] for entry in state['entries']], [row['id'] for row in rows])
                self.assertTrue(all(entry['status'] == 'ready' for entry in state['entries']))
                self.assertTrue(all(limit == batch for cursor, limit in api.pages))
                self.assertEqual(len(api.keys), 120)
                self.assertTrue(all(not key.startswith('event-videos/') or key.endswith(('-poster', '-thumbnail')) for key in api.keys))


if __name__ == '__main__':
    unittest.main()
