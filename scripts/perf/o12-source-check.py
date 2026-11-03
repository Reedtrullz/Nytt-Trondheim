# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run: python3 scripts/perf/o12-source-check.py. No application/SQL imports."""
from __future__ import annotations

import ast
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    path = root / 'scripts/perf/o12-hosted.py'
    ast.parse(path.read_text())
    spec = importlib.util.spec_from_file_location('hosted_source', path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with tempfile.TemporaryDirectory(prefix='o12-source-') as raw:
        scratch = Path(raw)
        inspect = scratch / 'inspect.json'
        role = scratch / 'role.txt'
        envelope = {'HostConfig': {'NetworkMode': 'none', 'ReadonlyRootfs': True, 'Memory': 536870912, 'MemorySwap': 536870912, 'PidsLimit': 128, 'NanoCpus': 1000000000, 'Tmpfs': {'/var/lib/postgresql/data': 'size=128m'}}, 'State': {'Running': True}, 'Image': 'sha256:authored-parser-fixture'}
        inspect.write_text(json.dumps([envelope]))
        role.write_text('fixture_server|f|f|f\n')
        module.admit_database(inspect, role)
        negatives = 0
        for key, bad in [('NetworkMode', 'host'), ('ReadonlyRootfs', False), ('Memory', 1), ('PidsLimit', 129), ('NanoCpus', 2000000000)]:
            clone = json.loads(json.dumps(envelope))
            clone['HostConfig'][key] = bad
            inspect.write_text(json.dumps([clone]))
            try:
                module.admit_database(inspect, role)
            except RuntimeError:
                negatives += 1
            else:
                raise AssertionError('accepted invalid envelope ' + key)
        for malformed in ('[]', '{}', 'null', '{'):
            inspect.write_text(malformed)
            try:
                module.admit_database(inspect, role)
            except (RuntimeError, json.JSONDecodeError):
                negatives += 1
            else:
                raise AssertionError('accepted malformed inspect')
        inspect.write_text(json.dumps([envelope]))
        role.write_text('fixture_server|t|f|f\n')
        try:
            module.admit_database(inspect, role)
        except RuntimeError:
            negatives += 1
        else:
            raise AssertionError('accepted superuser')
        assert negatives == 10
        node = os.environ.get('O12_SOURCE_NODE', '/Users/reidar/.local/bin/node')
        module.NODE, module.BASELINE = node, root
        env = {'PATH': '/usr/bin:/bin', 'HOME': raw, 'TMPDIR': raw}
        module.checked([node, '-e', 'console.log(JSON.stringify({status:"expected"}))'], env, 'expected')
        child_negatives = 0
        for code in ('console.log(JSON.stringify({status:"complete"}))', 'process.exit(7)', 'process.stdout.write("x".repeat(600000))'):
            try:
                module.checked([node, '-e', code], env, 'expected')
            except RuntimeError:
                child_negatives += 1
            else:
                raise AssertionError('accepted misleading/failed/unbounded child')
        assert child_negatives == 3
    subprocess.run(['bash', '-n', str(root / 'scripts/perf/o12-hosted.sh')], check=True, timeout=10)
    print(json.dumps({'status': 'PASS', 'negativeParserCases': negatives, 'negativeBoundedChildCases': child_negatives, 'shellSyntax': 'PASS', 'temporaryDirectoryRemoved': not scratch.exists(), 'applicationImported': False, 'SQL': False, 'M': False}))


if __name__ == '__main__':
    main()
