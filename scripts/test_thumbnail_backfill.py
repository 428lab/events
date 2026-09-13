"""Local synthetic media and fault-injection tests; no credentials/network."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import thumbnail_backfill as core
import thumbnail_backfill_writer as writer


def obj(data, mime='image/webp'):
    return dict(data=data, bytes=len(data), sha256=core.digest(data), metadata={'content-type': mime})


class FakeAPI:
    def __init__(self, row, source, old):
        self.row = copy.deepcopy(row)
        self.source_key, self.key = core.keys(row)
        self.objects = {self.source_key: source, self.key: old}
        self.writes = []
        self.after_put = None
        self.after_flag = None
        self.fail_put = False

    def object(self, key, method='GET', data=None, metadata=None):
        if method == 'GET':
            return copy.deepcopy(self.objects.get(key))
        assert key == self.key, 'original/video write prohibited'
        self.writes.append(method)
        if method == 'PUT':
            self.objects[key] = {**obj(data), 'metadata': metadata}
            if self.after_put:
                hook, self.after_put = self.after_put, None
                hook()
            if self.fail_put:
                self.fail_put = False
                raise core.SafetyError('injected_unknown_put')
        else:
            self.objects[key] = None

    def query(self, sql, params):
        assert sql.startswith('UPDATE event_photo SET has_thumbnail=')
        assert self.objects[self.key] is not None or params[0] == 0
        if not self.row or self.row['deleted_at'] is not None or self.row['has_thumbnail'] != params[-1]:
            return {'meta': {'changes': 0}}
        self.row['has_thumbnail'] = params[0]
        self.writes.append('FLAG')
        if self.after_flag:
            hook, self.after_flag = self.after_flag, None
            hook()
        return {'meta': {'changes': 1}}


class BackfillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temp.name)
        path = cls.directory / 'source.png'
        core.magick(['-size', '641x320', 'xc:red', '-fill', 'lime', '-draw', 'rectangle 160,0 480,319', str(path)])
        cls.source = obj(path.read_bytes(), 'image/png')
        cls.output, _ = core.encode(cls.source, cls.directory)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.path = Path(self.work.name) / 'manifest.json'
        self.row = dict(id='media-1', event_id='event-1', user_id='user-1', created_at=1,
                        kind='photo', has_thumbnail=0, admin_hidden_at=None,
                        deleted_at=None, existing_event='event-1')
        self.entry = dict(row=copy.deepcopy(self.row), status='ready', old=None,
                          source=core.evidence(self.source), output=core.evidence(self.output))
        self.state = dict(entries=[self.entry], inventory_complete=True)
        self.api = FakeAPI(self.row, self.source, None)
        self.row_patch = patch.object(writer, 'current', lambda api, row: copy.deepcopy(api.row))
        self.row_patch.start()

    def tearDown(self):
        self.row_patch.stop()
        self.work.cleanup()

    def apply(self):
        writer.operate(self.api, self.state, self.path, 'apply', 1)

    def test_centered_odd_landscape_and_real_output(self):
        core.validate_output(self.output, self.directory)
        path = self.directory / 'encoded.webp'
        path.write_bytes(self.output['data'])
        pixels = core.magick([str(path), '-crop', '1x1+10+160', '-depth', '8', 'rgb:-'])
        self.assertLess(pixels[0], 40)
        self.assertGreater(pixels[1], 200)  # center green retained, not red edges
        self.assertLess(self.output['bytes'], core.MAX_BYTES)

    def test_portrait_and_tiny_upscale(self):
        for size in ('320x641', '3x2', '1x1'):
            path = self.directory / 'tiny.png'
            core.magick(['-size', size, 'xc:blue', str(path)])
            output, _ = core.encode(obj(path.read_bytes(), 'image/png'), self.directory)
            self.assertEqual(core.validate_output(output, self.directory)['width'], 320)

    def test_jpeg_fallback(self):
        original = core.magick
        def no_webp(args):
            if args[-1].endswith('output.webp'):
                raise core.SafetyError('synthetic_webp_encoder_unavailable')
            return original(args)
        with patch.object(core, 'magick', no_webp):
            output, _ = core.encode(self.source, self.directory)
        self.assertEqual(output['metadata']['content-type'], 'image/jpeg')
        core.validate_output(output, self.directory)

    def test_deleted_row_never_reads_assets(self):
        self.api.row = None
        self.apply()
        self.assertEqual(self.api.writes, [])
        self.assertEqual(self.entry['status'], 'skip_changed_row')

    def test_post_put_source_change_rolls_back_without_flag(self):
        self.api.after_put = lambda: self.api.objects.update({self.api.source_key: obj(b'changed')})
        self.apply()
        self.assertEqual(self.entry['status'], 'rolled_back')
        self.assertNotIn('FLAG', self.api.writes)
        self.assertIsNone(self.api.object(self.api.key))

    def test_classifications(self):
        self.assertEqual(core.classify(None, self.directory)[0], 'missing')
        for size, expected in [('480x480', 'legacy_480'), ('480x360', 'non_square'), ('320x320', 'square_320_unproven_crop')]:
            path = self.directory / 'old.jpg'
            core.magick(['-size', size, 'xc:red', str(path)])
            self.assertEqual(core.classify(obj(path.read_bytes(), 'image/jpeg'), self.directory)[0], expected)

    def test_bad_mime_and_video_signature_rejected(self):
        with self.assertRaises(core.SafetyError):
            core.validate_output({**self.output, 'metadata': {'content-type': 'image/png'}}, self.directory)
        with self.assertRaises(core.SafetyError):
            core.image_format(b'\x00\x00\x00\x20ftypisom' + b'\x00' * 40)
        self.assertTrue(core.keys({**self.row, 'kind': 'video'})[0].endswith('-poster'))

    def test_production_and_wrong_targets_rejected(self):
        for field in core.TARGET:
            args = argparse.Namespace(**{**core.TARGET, field: 'production'})
            with self.assertRaises(core.SafetyError):
                core.check_target(args)

    def test_transport_write_guard(self):
        with patch.object(core, 'credential', return_value='local-test'):
            api = core.Cloudflare()
        with self.assertRaises(core.SafetyError):
            api.object('event-photos/e/p-thumbnail', 'PUT', b'x')
        with self.assertRaises(core.SafetyError):
            api.query('UPDATE event_photo SET has_thumbnail=1')
        api.allow_write = True
        with self.assertRaises(core.SafetyError):
            api.object('event-videos/e/p', 'DELETE')

    def test_apply_flag_after_object_and_resume_idempotent(self):
        self.apply()
        self.assertEqual(self.api.writes, ['PUT', 'FLAG'])
        self.assertEqual(self.entry['status'], 'verified')
        self.apply()
        self.assertEqual(self.api.writes, ['PUT', 'FLAG'])
        writer.operate(self.api, self.state, self.path, 'reconcile', 1)
        self.assertEqual(self.api.writes, ['PUT', 'FLAG'])

    def test_unknown_put_recovers_from_durable_intent(self):
        self.api.fail_put = True
        with self.assertRaises(core.SafetyError):
            self.apply()
        state = json.loads(self.path.read_text())
        self.assertEqual(state['entries'][0]['status'], 'intent')
        self.assertEqual(self.api.row['has_thumbnail'], 0)
        writer.operate(self.api, state, self.path, 'reconcile', 1)
        self.assertEqual(state['entries'][0]['status'], 'verified')

    def test_deletion_after_put_compensates(self):
        def delete():
            self.api.row = None
        self.api.after_put = delete
        self.apply()
        self.assertEqual(self.entry['status'], 'orphan_compensated')
        self.assertIsNone(self.api.objects[self.api.key])
        self.assertNotIn('FLAG', self.api.writes)

    def test_deleted_user_after_flag_compensates(self):
        self.api.after_flag = lambda: self.api.row.update(deleted_at=2)
        self.apply()
        self.assertEqual(self.entry['status'], 'orphan_compensated')
        self.assertIsNone(self.api.objects[self.api.key])

    def test_source_change_before_apply_skips(self):
        self.api.objects[self.api.source_key] = obj(b'changed', 'image/png')
        self.apply()
        self.assertEqual(self.entry['status'], 'skip_changed_object')
        self.assertEqual(self.api.writes, [])

    def test_rollback_new_object_clears_flag_before_delete(self):
        self.apply()
        writer.operate(self.api, self.state, self.path, 'rollback', 1)
        self.assertEqual(self.api.writes, ['PUT', 'FLAG', 'FLAG', 'DELETE'])
        self.assertEqual(self.api.row['has_thumbnail'], 0)
        self.assertEqual(self.entry['status'], 'rolled_back')

    def test_replacement_backup_and_rollback_exact_bytes_and_flag(self):
        old = obj(b'old-thumbnail', 'image/jpeg')
        self.entry['old'] = core.evidence(old)
        self.entry['row']['has_thumbnail'] = self.api.row['has_thumbnail'] = 1
        self.api.objects[self.api.key] = old
        self.apply()
        self.assertEqual(writer.backup_path(self.path, self.entry).read_bytes(), old['data'])
        writer.operate(self.api, self.state, self.path, 'rollback', 1)
        self.assertTrue(writer.same(self.api.object(self.api.key), old))
        self.assertEqual(self.api.row['has_thumbnail'], 1)

    def test_crash_during_restore_then_deletion_compensates_old_hash(self):
        old = obj(b'old-thumbnail', 'image/jpeg')
        self.entry['old'] = core.evidence(old)
        self.api.objects[self.api.key] = old
        self.apply()
        self.api.fail_put = True
        with self.assertRaises(core.SafetyError):
            writer.operate(self.api, self.state, self.path, 'rollback', 1)
        self.api.row = None
        writer.operate(self.api, self.state, self.path, 'reconcile', 1)
        self.assertEqual(self.entry['status'], 'orphan_compensated')
        self.assertIsNone(self.api.object(self.api.key))

    def test_recovery_conflict_does_not_overwrite(self):
        self.api.fail_put = True
        with self.assertRaises(core.SafetyError):
            self.apply()
        self.api.objects[self.api.key] = obj(b'another-writer')
        with self.assertRaises(core.SafetyError):
            writer.operate(self.api, self.state, self.path, 'reconcile', 1)
        self.assertEqual(self.api.objects[self.api.key]['data'], b'another-writer')
        self.assertEqual(self.api.row['has_thumbnail'], 0)

    def test_missing_original_flag_is_not_recreated_on_rollback(self):
        self.entry['row']['has_thumbnail'] = self.api.row['has_thumbnail'] = 1
        self.apply()
        writer.operate(self.api, self.state, self.path, 'rollback', 1)
        self.assertEqual(self.api.row['has_thumbnail'], 0)
        self.assertIsNone(self.api.object(self.api.key))

    def test_batch_bounds_and_unresolved_intent_precedes_new_work(self):
        second = copy.deepcopy(self.entry)
        second['row']['id'] = 'media-2'
        self.state['entries'].append(second)
        self.api.fail_put = True
        with self.assertRaises(core.SafetyError):
            self.apply()
        self.apply()
        self.assertEqual(second['status'], 'ready')
        self.assertEqual(self.entry['status'], 'verified')


if __name__ == '__main__':
    unittest.main()
