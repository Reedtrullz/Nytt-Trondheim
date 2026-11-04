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
import shlex
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from typing import Any


def alias_checks(root: Path, scratch: Path, node: str) -> dict[str, Any]:
    """Execute the authored shell entry with fake mounts, never a native namespace."""
    fixture = scratch / 'alias-entry'
    fixture.mkdir()
    owned = fixture / 'original-private-parent'
    for phase in ('baseline', 'candidate'):
        source = owned / phase
        (source / 'scripts/qa').mkdir(parents=True)
        (source / 'scripts/perf').mkdir()
        (source / 'apps/server/node_modules/tsx/dist').mkdir(parents=True)
        (source / 'scripts/qa/portfolio-hosted-admission.mjs').write_text('console.log(JSON.stringify({entry:process.cwd()}))')
        (source / 'scripts/perf/o12-hosted.py').write_text('authored-python-entry')
        (source / 'apps/server/node_modules/tsx/dist/cli.mjs').write_text('console.log("authored-tsx-entry")')
    for name in ('db-inspect.json', 'db-role.txt', 'pre-schema-admission.json'):
        (owned / name).write_text(name)
    (owned / 'result').mkdir()
    (owned / 'socket').mkdir()
    shell = (root / 'scripts/perf/o12-hosted.sh').read_text()
    argv = shlex.split(shell.split('sudo --preserve-env=owned,node_binary,tsx_binary,source_root,stage unshare', 1)[1])
    entry = argv[argv.index('-c') + 1]
    assert 'mount --make-rprivate /' in entry
    tmp = fixture / 'tmp'
    tmp.mkdir()
    entry = entry.replace('/tmp', str(tmp))
    # Fake bind mounts copy only authored sentinel files; no source/app/SQL execution.
    controls = r'''
mount() {
  if [[ "$1" == --bind && "$2" == "$owned/"* && "$3" == "$test_tmp/source/"* ]]; then
    cp -a "$2/." "$3/"
  fi
}
ip() { :; }
chown() { :; }
setpriv() {
  while [[ "$1" != env ]]; do shift; done
  shift
  [[ "$1" != -i ]] || shift
  while [[ "$1" == *=* ]]; do shift; done
  "$@"
}
python3() {
  [[ "$1" == "$test_tmp/source/baseline/scripts/perf/o12-hosted.py" && -r "$1" ]] || return 71
  [[ "$3" == "$test_tmp/source/baseline" && "$4" == "$test_tmp/source/candidate" ]] || return 72
  [[ "$6" == "$test_tmp/source/candidate/"* && -r "$6" ]] || return 73
  "$5" "$6" > "$test_tmp/measurement/tsx-entry.txt"
  printf "%s\n" "$@" > "$test_tmp/measurement/argv.txt"
}
'''
    env = {**os.environ, 'owned': str(owned), 'node_binary': node,
           'tsx_binary': str(owned / 'candidate/apps/server/node_modules/tsx/dist/cli.mjs'),
           'source_root': str(owned), 'stage': 'qualification', 'test_tmp': str(tmp)}
    result = subprocess.run(['bash', '-euo', 'pipefail', '-c', controls + entry], env=env, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stdout + result.stderr + ' alias exit ' + str(result.returncode)
    admission = json.loads((owned / 'result/admission.json').read_text())
    assert admission['entry'] == str(tmp / 'source/baseline')
    assert (owned / 'result/tsx-entry.txt').read_text().strip() == 'authored-tsx-entry'
    return {'status': 'PASS', 'scope': 'fake mount shell-entry behavior only', 'admission': admission,
            'argv': (owned / 'result/argv.txt').read_text().splitlines()}


def stage_checks(module, root: Path, scratch: Path, node: str) -> dict[str, Any]:
    sys.path.insert(0, str(root / 'scripts/perf/o12-engine/work/portfolio-performance/tools'))
    import importlib
    protocol = importlib.import_module('protocol')
    native = importlib.import_module('native')
    limits = importlib.import_module('resource_limits')
    work = scratch / 'boundary'
    work.mkdir()
    budget = limits.ResourceBudget(16777216, work, work / 'native', work / 'artifacts', ())
    data: dict[str, Any] = {'qualificationOnly': True, 'pairs': 10, 'temperature': 'warm', 'fixtures': {'authored': 'fixture'}, 'harness': {'authored': 'harness'},
            'shape': 'W1-10000-3-27-unix-socket', 'economicsDigest': 'authored',
            'baseline': {'revision': 'b', 'cwd': str(work)}, 'candidate': {'revision': 'c', 'cwd': str(work)},
            'timeout': 2, 'outputBytes': 1048576, 'parentEnvironment': {'PATH': '/usr/bin:/bin'},
            'semanticDigest': 'authored', 'capabilities': {'authored': True},
            'metrics': {'qualified_calls': {'scope': 'invocation', 'unit': 'count', 'aggregate': 'sum', 'repetitions': 1}}}
    case = SimpleNamespace(data=data, sha256='authored-case')
    data['qualificationScenarios'] = ['A' + str(i) for i in range(27)]
    prefix = 'const r=JSON.parse(process.env.MEASURE_REQUEST);const v={...r,status:"complete",stage:"qualification",purpose:"correctness-only",semanticDigest:"authored",capabilities:{authored:true},metrics:{qualified_calls:{scope:"invocation",unit:"count",values:[81]}},calls:Array.from({length:81},(_,i)=>({id:"A"+(i%27),repeat:Math.floor(i/27),digest:"a".repeat(64),expectedDigest:"a".repeat(64)})),plans:{authored:true},serverWriteDenial:{sqlState:"42501",role:"fixture_server",plan:null}};'
    good = prefix + 'console.log(JSON.stringify(v))'
    def commands(code):
        data['commands'] = {'happy': {p: [node, '-e', code] for p in ('baseline', 'candidate')}}
    saved = []
    real_save = protocol.save
    def save(path, value):
        saved.append((path.name, value))
        real_save(path, value)
    events = []
    boundary_results = []
    with patch.object(protocol.Case, 'read', return_value=case), patch.object(limits.ResourceBudget, 'read', return_value=budget), patch.object(native, 'verify_source'), patch.object(native, 'bindings'), patch.object(protocol, 'save', side_effect=save):
        commands(good)
        module.execute_stage('qualification', work / 'case.json', work, budget.artifacts, {})
        assert [n for n, _ in saved] == ['qualification-baseline.json', 'qualification-candidate.json', 'qualification.json']
        assert saved[-1][1]['formalSamples'] == 0 and saved[-1][1]['comparison'] is False
        events.append('qualification-both-phases-zero-formal-slots-no-compare')
        for label, code in [
            ('misleading-purpose', prefix + 'v.purpose="measurement";console.log(JSON.stringify(v))'),
            ('partial-calls', prefix + 'v.calls.pop();console.log(JSON.stringify(v))'),
            ('missing-plans', prefix + 'delete v.plans;console.log(JSON.stringify(v))'),
            ('malformed-calls', prefix + 'v.calls="x".repeat(81);console.log(JSON.stringify(v))'),
            ('duplicate-scenario', prefix + 'v.calls[1]=v.calls[0];console.log(JSON.stringify(v))'),
            ('digest-disagreement', prefix + 'v.calls[0].digest="b".repeat(64);console.log(JSON.stringify(v))'),
            ('missing-role-denial', prefix + 'delete v.serverWriteDenial;console.log(JSON.stringify(v))'),
            ('formal-sample', prefix + 'v.sample=0;console.log(JSON.stringify(v))'),
            ('wrong-stage', prefix + 'v.stage="measurement";console.log(JSON.stringify(v))'),
            ('failed-child', 'process.exit(7)'),
            ('partial-native', 'console.log(JSON.stringify({status:"partial"}))'),
            ('malformed-json', 'console.log("{")'),
            ('oversized-native', 'process.stdout.write("x".repeat(1048577))'),
            ('stale-binding', prefix + 'v.caseHash="stale";console.log(JSON.stringify(v))'),
            ('semantic-mismatch', prefix + 'v.semanticDigest="wrong";console.log(JSON.stringify(v))'),
            ('capability-mismatch', prefix + 'v.capabilities={};console.log(JSON.stringify(v))'),
            ('hung-child', 'setInterval(()=>{},1000)')]:
            commands(code)
            data['timeout'] = .15 if label == 'hung-child' else 2
            saved.clear()
            try:
                module.execute_stage('qualification', work / 'case.json', work, budget.artifacts, {})
            except RuntimeError:
                assert [n for n, _ in saved] == ['qualification-baseline.json']
                receipt = saved[0][1]
                assert receipt['reaped'] and receipt['scratchCleaned'] and receipt['parentScratchCleaned']
                assert not list(budget.native_root.iterdir())
                boundary_results.append({'scenario': label, 'status': receipt['status'], 'error': receipt.get('error'), 'returncode': receipt.get('returncode'), 'stdoutBytes': len(receipt['stdout'].encode()), 'reaped': receipt['reaped'], 'scratchCleaned': receipt['scratchCleaned'], 'parentScratchCleaned': receipt['parentScratchCleaned']})
                events.append(label + '-rejected-no-fallthrough-reaped')
            else:
                raise AssertionError('accepted ' + label)
        commands(good)
        data['timeout'] = 2
        for field in ('scratchCleaned', 'parentScratchCleaned', 'reaped'):
            with patch.object(native, 'invoke', return_value={'status': 'PASS', field: False}):
                try:
                    module.execute_stage('qualification', work / 'case.json', work, budget.artifacts, {})
                except RuntimeError:
                    events.append(field + '-failure-rejected')
                else:
                    raise AssertionError('accepted missing cleanup')
        for value in ('', 'formal', 'QUALIFICATION', None):
            with patch.object(native, 'invoke', side_effect=AssertionError('unknown stage dispatched')):
                try:
                    module.execute_stage(value, work / 'case.json', work, budget.artifacts, {})
                except RuntimeError:
                    events.append('unknown-stage-' + str(value) + '-rejected')
                else:
                    raise AssertionError('unknown stage accepted')
        for stage, flag in [('measurement', True), ('qualification', False)]:
            data['qualificationOnly'] = flag
            try:
                module.execute_stage(stage, work / 'case.json', work, budget.artifacts, {})
            except RuntimeError as error:
                assert str(error) == 'case/stage mismatch'
                events.append(stage + '-mismatched-case-rejected')
            else:
                raise AssertionError('mismatched case accepted')
        data['qualificationOnly'] = False
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as formal, patch.object(native, 'invoke', side_effect=AssertionError('formal used qualification')):
            module.execute_stage('measurement', work / 'case.json', work, budget.artifacts, {})
            assert formal.call_count == 35
            for i, call in enumerate(formal.call_args_list[:34]):
                argv = call.args[0]
                assert argv[1] == str(work / 'measure.py') and argv[argv.index('--sample') + 1] == str(i)
                assert argv[argv.index('--phase') + 1] == protocol.slot(data, i)['phase']
            assert formal.call_args_list[-1].args[0][1] == str(work / 'compare.py')
            events.append('formal-34-original-slots-one-compare-zero-qualification')
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=1)) as formal:
            try:
                module.execute_stage('measurement', work / 'case.json', work, budget.artifacts, {})
            except RuntimeError:
                assert formal.call_count == 1
                events.append('formal-failure-no-retry-no-compare')
            else:
                raise AssertionError('formal failure accepted')
    source = work / 'source'
    source.write_bytes(b'actual before bytes')
    pins = {str(source): protocol.file_hash(source)}
    source.write_bytes(b'changed bytes')
    try:
        protocol.bindings(pins)
    except protocol.Rejected:
        events.append('stale-source-bytes-rejected')
    else:
        raise AssertionError('stale source accepted')
    with patch.dict(os.environ, {'NODE_COMPILE_CACHE': str(work), 'BUN_RUNTIME_TRANSPILER_CACHE_PATH': str(work)}), patch.object(protocol, 'bindings'), patch.object(protocol, 'load', return_value={'rows': [{'identity': 'authored', 'roots': [], 'taskOwnedCheckouts': [{'taskId': 12, 'checkout': str(work), 'created': True}]}]}), patch.object(protocol.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='', stderr='')):
        try:
            protocol.verify_source({'baseline': {'sources': pins, 'cwd': str(work), 'revision': 'b', 'tree': 't'}, 'identities': ['authored'], 'task': 12}, 'baseline')
        except protocol.Rejected:
            events.append('dirty-git-boundary-rejected')
        else:
            raise AssertionError('dirty source accepted')
    tiny = limits.ResourceBudget(1, work, work / 'native', work / 'artifacts', ())
    try:
        tiny.enforce()
    except protocol.Rejected:
        events.append('combined-scratch-overflow-rejected')
    else:
        raise AssertionError('scratch overflow accepted')
    return {'status': 'PASS', 'boundary': 'source-only fake Node receipts; no app/DB imports', 'observables': events, 'boundaryResults': boundary_results}


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
        setattr(module, 'NODE', node)
        setattr(module, 'BASELINE', root)
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
        stages = stage_checks(module, root, scratch, node)
        driver = subprocess.run([node, '--experimental-strip-types', '--disable-warning=ExperimentalWarning', str(root / 'scripts/perf/o12-inputs/query-driver.mts'), '--self-check'], capture_output=True, text=True, timeout=20, env={**os.environ, 'TMPDIR': raw})
        assert driver.returncode == 0, driver.stdout + driver.stderr
        driver_result = json.loads(driver.stdout)
        assert driver_result['status'] == 'PASS'
        aliases = alias_checks(root, scratch, node)
    subprocess.run(['bash', '-n', str(root / 'scripts/perf/o12-hosted.sh')], check=True, timeout=10)
    header = (root / 'scripts/perf/o12-hosted.sh').read_text().split('[[ "${GITHUB_EVENT_NAME:?}"')[0]
    for stage, expected_code, expected_value in [(None, 0, 'qualification'), ('qualification', 0, 'qualification'), ('measurement', 0, 'measurement'), ('', 2, ''), ('unknown', 2, '')]:
        env = dict(os.environ)
        env.pop('O12_STAGE', None)
        if stage is not None:
            env['O12_STAGE'] = stage
        selected = subprocess.run(['bash', '-c', header + '\nprintf "%s" "$stage"'], env=env, capture_output=True, text=True, timeout=3)
        assert selected.returncode == expected_code and selected.stdout == expected_value
    assert not scratch.exists()
    print(json.dumps({'status': 'PASS', 'negativeParserCases': negatives, 'negativeBoundedChildCases': child_negatives, 'stages': stages, 'driver': driver_result, 'aliases': aliases, 'shellSyntax': 'PASS', 'temporaryDirectoryRemoved': not scratch.exists(), 'applicationImported': False, 'SQL': False, 'M': False}))


if __name__ == '__main__':
    main()
