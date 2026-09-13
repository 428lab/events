#!/usr/bin/env python3
"""Staging-only thumbnail backfill. Dry-run by default; see the scoped runbook."""
import argparse
import collections
import contextlib
import copy
import datetime
import email.utils
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request

TARGET = dict(environment="staging", account="b9cec3916d500760a7c7b9c31c720d80",
              database="389e4625-8e13-4a41-9530-3ab3be10cee5",
              bucket="eventer-images-staging")
ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 128 * 1024
MAX_SOURCE = 10 * 1024 * 1024
VERSION = 2
HTTP_METADATA = {
    'contentType': 'content-type', 'contentDisposition': 'content-disposition',
    'contentEncoding': 'content-encoding', 'contentLanguage': 'content-language',
    'cacheControl': 'cache-control', 'cacheExpiry': 'expires',
}


class SafetyError(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    """Atomic, fsynced private checkpoint (including directory entry)."""
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w', opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW, 0o600)) as f:
        json.dump(value, f, sort_keys=True, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def check_target(args):
    if any(getattr(args, k) != v for k, v in TARGET.items()):
        raise SafetyError('target_mismatch_production_rejected')
    c = tomllib.loads((ROOT / 'wrangler.toml').read_text())
    stage = c['env']['staging']
    if (c['account_id'] != TARGET['account'] or stage['vars']['ENVIRONMENT'] != 'staging'
            or stage['d1_databases'][0]['database_id'] != TARGET['database']
            or stage['d1_databases'][0]['database_name'] != 'eventer-staging'
            or stage['r2_buckets'][0]['bucket_name'] != TARGET['bucket']):
        raise SafetyError('repository_target_mismatch')


def credential():
    if os.environ.get('CLOUDFLARE_API_TOKEN'):
        return os.environ['CLOUDFLARE_API_TOKEN']
    candidates = [Path.home() / 'Library/Preferences/.wrangler/config/default.toml',
                  Path.home() / '.config/.wrangler/config/default.toml']
    for path in candidates:
        if path.exists():
            return tomllib.loads(path.read_text())['oauth_token']
    raise SafetyError('credential_missing_use_existing_wrangler_login')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise SafetyError('api_redirect_rejected')


class Cloudflare:
    """Same account-scoped REST endpoints used by Wrangler; never logs responses."""
    def __init__(self, allow_write=False):
        self.token = credential()
        self.allow_write = allow_write
        self.base = 'https://api.cloudflare.com/client/v4/accounts/' + TARGET['account']
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, method='GET', data=None, headers=None, missing=False):
        h = {'Authorization': 'Bearer ' + self.token, **(headers or {})}
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with self.opener.open(req, timeout=45) as response:
                body = response.read(MAX_SOURCE + 1)
                if len(body) > MAX_SOURCE:
                    raise SafetyError('response_too_large')
                return body, dict(response.headers.items())
        except urllib.error.HTTPError as e:
            if missing and e.code == 404:
                return None
            raise SafetyError('cloudflare_http_' + str(e.code)) from None
        except (urllib.error.URLError, TimeoutError):
            raise SafetyError('cloudflare_transport_unknown_outcome') from None

    def json(self, path, method='GET', data=None, full=False):
        raw, _ = self.request(path, method, json.dumps(data).encode() if data else None,
                              {'Content-Type': 'application/json'})
        result = json.loads(raw)
        if not result.get('success'):
            raise SafetyError('cloudflare_api_failure')
        return result if full else result['result']

    def query(self, sql, params=()):
        read = sql.lstrip().startswith('SELECT ')
        if not read and not self.allow_write:
            raise SafetyError('remote_write_disabled')
        result = self.json('/d1/database/' + TARGET['database'] + '/query', 'POST',
                           {'sql': sql, 'params': list(params)})
        if not result or not result[0].get('success'):
            raise SafetyError('d1_query_failure')
        if read and result[0].get('meta', {}).get('rows_written', 0) != 0:
            raise SafetyError('unexpected_d1_write')
        return result[0]

    def preflight(self):
        db = self.json('/d1/database/' + TARGET['database'])
        bucket = self.json('/r2/buckets/' + TARGET['bucket'])
        if db.get('uuid') != TARGET['database'] or db.get('name') != 'eventer-staging' or bucket.get('name') != TARGET['bucket']:
            raise SafetyError('remote_target_mismatch')
        cols = self.query("SELECT name FROM pragma_table_info('event_photo')")['results']
        if 'has_thumbnail' not in [r['name'] for r in cols]:
            raise SafetyError('migration_0089_required_no_auto_migration')

    def stored_metadata(self, key):
        # Official List Objects JSON exposes persisted metadata; download response
        # headers do not (notably their synthetic attachment Content-Disposition).
        response = self.json('/r2/buckets/' + TARGET['bucket'] + '/objects?' +
                             urllib.parse.urlencode({'prefix': key, 'per_page': 25}), full=True)
        records = response['result']
        if not isinstance(records, list) or len(records) > 25:
            raise SafetyError('unexpected_metadata_response')
        exact = [record for record in records if record.get('key') == key]
        if not exact:
            info = response.get('result_info', {})
            if len(records) == 25 or info.get('is_truncated') or info.get('cursor'):
                raise SafetyError('metadata_prefix_ambiguous')
            return None
        if len(exact) != 1:
            raise SafetyError('unexpected_metadata_response')
        record = exact[0]
        http = record.get('http_metadata')
        if not isinstance(http, dict) or 'custom_metadata' not in record:
            raise SafetyError('persisted_metadata_missing')
        # Wrangler's supported PUT headers cannot round-trip custom metadata.
        # Refuse these objects instead of silently discarding genuine fields.
        if record['custom_metadata'] != {} or set(http) - HTTP_METADATA.keys():
            raise SafetyError('unsupported_persisted_metadata')
        if record.get('storage_class') != 'Standard' or record.get('ssec'):
            raise SafetyError('unsupported_object_storage_attributes')
        if not isinstance(record.get('etag'), str) or not record['etag'] or not isinstance(record.get('size'), int):
            raise SafetyError('metadata_identity_missing')
        metadata = {}
        for name, value in http.items():
            if not isinstance(value, str) or '\r' in value or '\n' in value:
                raise SafetyError('invalid_persisted_metadata')
            if name == 'cacheExpiry':
                try:
                    expiry = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
                    if expiry.utcoffset() is None or expiry.microsecond:
                        raise ValueError()
                    value = email.utils.format_datetime(expiry.astimezone(datetime.timezone.utc), usegmt=True)
                except ValueError:
                    raise SafetyError('unsupported_cache_expiry') from None
            metadata[HTTP_METADATA[name]] = value
        return {'metadata': metadata, 'etag': record['etag'], 'bytes': record['size'],
                'last_modified': record.get('last_modified')}

    def object(self, key, method='GET', data=None, metadata=None):
        if method != 'GET' and not self.allow_write:
            raise SafetyError('remote_write_disabled')
        if method != 'GET' and not re.fullmatch(r'event-(photos|videos)/[\w-]+/[\w-]+-thumbnail', key):
            raise SafetyError('only_thumbnail_mutation_allowed')
        before = self.stored_metadata(key) if method == 'GET' else None
        if method == 'GET' and before is None:
            return None
        result = self.request('/r2/buckets/' + TARGET['bucket'] + '/objects/' +
                              urllib.parse.quote(key, safe='/'), method, data, metadata, missing=method == 'GET')
        if method != 'GET':
            return None  # PUT/DELETE response is not object evidence.
        if result is None:
            raise SafetyError('object_changed_during_download')
        body, headers = result
        headers = {k.lower(): v for k, v in headers.items()}
        after = self.stored_metadata(key)
        if (before != after or headers.get('etag', '').strip('"') != before['etag']
                or len(body) != before['bytes']):
            raise SafetyError('object_changed_during_download')
        return {'data': body, 'sha256': digest(body), **before}


def keys(row):
    if row['kind'] not in ('photo', 'video') or any(not re.fullmatch(r'[\w-]+', row[k]) for k in ('id', 'event_id')):
        raise SafetyError('unsupported_row_identity')
    base = ('event-videos/' if row['kind'] == 'video' else 'event-photos/') + row['event_id'] + '/' + row['id']
    return base + ('-poster' if row['kind'] == 'video' else ''), base + '-thumbnail'


ROW_SQL = '''SELECT p.id,p.event_id,p.user_id,p.created_at,p.kind,p.has_thumbnail,
 p.admin_hidden_at,u.deleted_at, e.id AS existing_event
 FROM event_photo p LEFT JOIN user u ON u.id=p.user_id
 LEFT JOIN event e ON e.id=p.event_id'''


def current(api, row):
    rows = api.query(ROW_SQL + ' WHERE p.id=? AND EXISTS (SELECT 1 FROM user WHERE id=p.user_id)', [row['id']])['results']
    return rows[0] if rows else None


def alive(row, expected):
    return bool(row and row['deleted_at'] is None and row['existing_event'] and
                all(row[k] == expected[k] for k in ('id', 'event_id', 'user_id', 'created_at', 'kind')))


def evidence(obj):
    return {k: v for k, v in obj.items() if k != 'data'} if obj else None


def magick(args):
    try:
        p = subprocess.run(['magick', '-limit', 'thread', '1', '-limit', 'memory', '128MiB',
                            '-limit', 'map', '256MiB', '-limit', 'disk', '0', *args],
                           capture_output=True, timeout=45, check=True)
        return p.stdout
    except (subprocess.SubprocessError, OSError):
        raise SafetyError('image_decode_or_encode_failure') from None


def image_format(data):
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpeg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    # Do not admit generic ISOBMFF/MP4 or SVG to any decoder.
    if data[4:8] == b'ftyp' and data[8:12] in (b'avif', b'avis'):
        return 'avif'
    raise SafetyError('unsupported_image_signature_no_video_decode')


def inspect_image(obj, directory):
    fmt = image_format(obj['data'])
    source = directory / 'image'
    source.write_bytes(obj['data'])
    output = magick([f'{fmt}:{source}[0]', '-auto-orient', '-format', '%w %h', 'info:'])
    w, h = map(int, output.decode().split())
    if w <= 0 or h <= 0 or w * h > 40_000_000:
        raise SafetyError('image_dimensions_out_of_bounds')
    return {'width': w, 'height': h, 'mime': 'image/' + fmt}


def validate_output(obj, directory):
    dims = inspect_image(obj, directory)
    if (dims['width'], dims['height']) != (320, 320) or dims['mime'] not in ('image/webp', 'image/jpeg') or not 0 < obj['bytes'] <= MAX_BYTES:
        raise SafetyError('output_contract_failure')
    if obj['metadata'].get('content-type', '').split(';')[0] != dims['mime']:
        raise SafetyError('output_mime_mismatch')
    return dims


def encode(source, directory):
    dims = inspect_image(source, directory)
    fmt = image_format(source['data'])
    oriented = directory / 'oriented.png'
    magick([f'{fmt}:{directory / "image"}[0]', '-auto-orient', '-strip', str(oriented)])
    scale = 320 / min(dims['width'], dims['height'])
    # Continuous centered square, including fractional offsets for odd differences.
    matrix = f'{scale},0,0,{scale},{160-scale*dims["width"]/2},{160-scale*dims["height"]/2}'
    for mime in ('webp', 'jpeg'):
        for quality in (80, 50):
            output = directory / ('output.' + mime)
            try:
                magick([str(oriented), '-virtual-pixel', 'edge', '-define', 'distort:viewport=320x320+0+0',
                        '-distort', 'AffineProjection', matrix, '+repage', '-strip', '-quality', str(quality), str(output)])
            except SafetyError:
                continue
            data = output.read_bytes()
            obj = {'data': data, 'bytes': len(data), 'sha256': digest(data), 'metadata': {'content-type': 'image/' + mime}}
            if len(data) <= MAX_BYTES:
                validate_output(obj, directory)
                return obj, dims
    raise SafetyError('encoding_failed_or_exceeds_byte_limit')


def classify(obj, directory):
    if obj is None:
        return 'missing', None
    try:
        dims = inspect_image(obj, directory)
    except SafetyError:
        return 'invalid_image', None
    if dims['width'] != dims['height']:
        return 'non_square', dims
    if dims['width'] == 480:
        return 'legacy_480', dims
    try:
        validate_output(obj, directory)
        return 'square_320_unproven_crop', dims
    except SafetyError:
        return 'other_noncompliant', dims


def dry_run(api, state, path, batch):
    if not state.get('inventory'):
        state['inventory'] = api.query('''SELECT p.kind,p.has_thumbnail,COUNT(*) AS n,
 SUM(u.deleted_at IS NOT NULL) AS deleted_users, SUM(p.admin_hidden_at IS NOT NULL) AS hidden
 FROM event_photo p LEFT JOIN user u ON u.id=p.user_id GROUP BY p.kind,p.has_thumbnail''')['results']
    rows = api.query(ROW_SQL + ' WHERE p.id>? ORDER BY p.id LIMIT ?', [state.get('cursor', ''), batch])['results']
    for row in rows:
        entry = {'row': row, 'status': 'pending'}
        state['entries'].append(entry)
        try:
            if not alive(current(api, row), row):
                entry['status'] = 'skip_ineligible'
            else:
                source_key, target_key = keys(row)
                with tempfile.TemporaryDirectory(dir=path.parent, prefix='media-') as temp:
                    directory = Path(temp)
                    old = api.object(target_key)
                    entry['old'] = evidence(old)
                    entry['classification'], entry['old_dimensions'] = classify(old, directory)
                    source = api.object(source_key)
                    if source is None:
                        entry['status'] = 'skip_missing_poster' if row['kind'] == 'video' else 'skip_missing_photo'
                    else:
                        output, dims = encode(source, directory)
                        entry.update(source=evidence(source), source_dimensions=dims, output=evidence(output))
                        entry['status'] = 'ready' if alive(current(api, row), row) else 'skip_changed_row'
                        # Same encoder/source hash is evidence of the precise crop; dimensions alone are not.
                        if entry['status'] == 'ready' and old and old['sha256'] == output['sha256'] and row['has_thumbnail'] == 1 and old['metadata'].get('content-type') == output['metadata']['content-type']:
                            entry['status'] = 'skip_compliant_hash'
        except SafetyError as e:
            entry['status'] = 'failure'
            entry['error'] = str(e)
        state['cursor'] = row['id']
        save(path, state)
    state['inventory_complete'] = len(rows) < batch
    save(path, state)


def import_read_only_v1(api, source_path, destination):
    """Metadata-only migration of an untouched v1 dry-run into a NEW workspace."""
    if source_path.is_symlink() or source_path.name != 'manifest.json' or source_path.parent.resolve() == destination.parent.resolve():
        raise SafetyError('invalid_v1_import_path')
    with workspace(source_path.parent):
        raw = source_path.read_bytes()
        previous = json.loads(raw)
        if (previous.get('version') != 1 or previous.get('target') != TARGET
                or not previous.get('inventory_complete') or not 1 <= len(previous.get('entries', [])) <= 25
                or any(e['status'] != 'ready' for e in previous['entries'])
                or any(source_path.parent.glob('backup-*'))):
            raise SafetyError('import_requires_untouched_ready_v1_dry_run')
        state = copy.deepcopy(previous)
        for entry in state['entries']:
            row = entry['row']
            now = current(api, row)
            if not alive(now, row) or now != row:
                raise SafetyError('v1_row_changed_new_inventory_required')
            for name, key in zip(('source', 'old'), keys(row)):
                recorded = entry[name]
                actual = api.stored_metadata(key)
                if recorded is None and actual is None:
                    continue
                if (not recorded or not actual or recorded.get('etag', '').strip('"') != actual['etag']
                        or recorded['bytes'] != actual['bytes']):
                    raise SafetyError('v1_object_changed_new_inventory_required')
                entry[name] = {**recorded, **actual}
        state.update(version=VERSION, imported_v1_sha256=digest(raw), metadata_refreshed_at=int(time.time()))
        save(destination, state)
        return state


@contextlib.contextmanager
def workspace(path):
    path = path.absolute()
    if path.is_symlink():
        raise SafetyError('workspace_symlink_rejected')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if ROOT == path.resolve() or ROOT in path.resolve().parents or (path.stat().st_mode & 0o077) or path.stat().st_uid != os.getuid():
        raise SafetyError('workspace_must_be_private_and_outside_repo')
    with open(path / 'lock', 'a', opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW, 0o600)) as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SafetyError('workspace_already_locked') from None
        yield path


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    for key in TARGET:
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--mode', choices=['dry-run', 'apply', 'reconcile', 'rollback'], default='dry-run')
    parser.add_argument('--batch', type=int, default=5)
    parser.add_argument('--approve-staging-writes', action='store_true')
    parser.add_argument('--import-v1', type=Path, help='Read-only metadata refresh of untouched v1 manifest into new workspace')
    args = parser.parse_args()
    check_target(args)
    if not 1 <= args.batch <= 25:
        raise SafetyError('batch_must_be_1_to_25')
    writes = args.mode != 'dry-run'
    if args.import_v1 and writes:
        raise SafetyError('v1_import_is_read_only')
    if writes and not args.approve_staging_writes:
        raise SafetyError('explicit_staging_write_approval_required')
    with workspace(args.workspace) as directory:
        path = directory / 'manifest.json'
        if path.is_symlink():
            raise SafetyError('manifest_symlink_rejected')
        if args.import_v1 and path.exists():
            raise SafetyError('v1_import_requires_new_workspace')
        state = json.loads(path.read_text()) if path.exists() else {
            'version': VERSION, 'target': TARGET, 'created_at': int(time.time()), 'entries': []}
        if state['target'] != TARGET or state['version'] != VERSION:
            raise SafetyError('manifest_target_or_version_mismatch')
        api = Cloudflare(writes)
        api.preflight()
        if args.import_v1:
            state = import_read_only_v1(api, args.import_v1, path)
        elif args.mode == 'dry-run':
            if not state.get('inventory_complete'):
                dry_run(api, state, path, args.batch)
        else:
            from thumbnail_backfill_writer import operate
            operate(api, state, path, args.mode, args.batch)
        print(json.dumps({'mode': args.mode, 'inventory_complete': state.get('inventory_complete', False),
                          'inventory': state.get('inventory', []),
                          'status_counts': dict(collections.Counter(e['status'] for e in state['entries'])),
                          'classification_counts': dict(collections.Counter(e.get('classification', 'not_read') for e in state['entries']))}, sort_keys=True))


if __name__ == '__main__':
    sys.modules['thumbnail_backfill'] = sys.modules[__name__]
    try:
        main()
    except SafetyError as error:
        print(json.dumps({'error': str(error)}))
        raise SystemExit(1)
