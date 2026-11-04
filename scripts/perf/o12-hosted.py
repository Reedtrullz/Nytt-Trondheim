# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run: python3 scripts/perf/o12-hosted.py ROOT BASELINE CANDIDATE NODE TSX.

Hosted namespace only. Freeze Case.read bindings before the first observation;
the unchanged engine owns ordering, requests, receipts and decisions.
"""
from __future__ import annotations

import json
import importlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

MODULES = ('measure', 'compare', 'protocol', 'native', 'resource_limits', 'decisions', 'receipt_audit', 'container_resources')
QUERY_FILES = ('apps/server/src/store.ts', 'apps/server/test/articles-store.test.ts')


def stage_request(value: str) -> str:
    if value not in ('qualification', 'measurement'):
        raise RuntimeError('explicit qualification or measurement stage required')
    return value


def execute_stage(stage: str, casefile: Path, tools: Path, output: Path, environment: dict[str, str]) -> None:
    stage_request(stage)
    protocol = importlib.import_module('protocol')
    Case, digest, save, slot = protocol.Case, protocol.digest, protocol.save, protocol.slot
    case = Case.read(casefile)
    if (case.data.get('qualificationOnly') is True) != (stage == 'qualification'):
        raise RuntimeError('case/stage mismatch')
    if stage == 'qualification':
        invoke = importlib.import_module('native').invoke
        ResourceBudget = importlib.import_module('resource_limits').ResourceBudget
        budget = ResourceBudget.read(case.data)
        for phase in ('baseline', 'candidate'):
            # Native's transport is shared; these identities are never formal slots.
            request = {'stage': 'qualification', 'phase': phase, 'unit': 'qualification-' + phase,
                       'sample': None, 'scenario': 'happy', 'caseHash': case.sha256,
                       'revision': case.data[phase]['revision'], 'fixtureDigest': digest(case.data['fixtures']),
                       'harnessDigest': digest(case.data['harness']), 'shape': case.data['shape'],
                       'economicsDigest': case.data['economicsDigest']}
            receipt = invoke(case, request)
            save(output / ('qualification-' + phase + '.json'), receipt)
            budget.enforce()
            native = receipt.get('native', {})
            calls = native.get('calls')
            plans = native.get('plans')
            denial = native.get('serverWriteDenial')
            if (receipt.get('status') != 'PASS' or receipt.get('reaped') is not True
                    or receipt.get('scratchCleaned') is not True or receipt.get('parentScratchCleaned') is not True
                    or native.get('purpose') != 'correctness-only' or native.get('stage') != 'qualification'
                    or native.get('sample', 'missing') is not None
                    or not isinstance(calls, list) or len(calls) != 81
                    or not isinstance(plans, dict) or not plans
                    or not isinstance(denial, dict) or denial.get('sqlState') != '42501'
                    or denial.get('role') != 'fixture_server' or denial.get('plan', 'missing') is not None):
                raise RuntimeError('qualification failed; formal measurement forbidden')
            expected_calls = [(id_, repeat) for repeat in range(3) for id_ in case.data['qualificationScenarios']]
            if ([(call.get('id'), call.get('repeat')) for call in calls if isinstance(call, dict)] != expected_calls
                    or any(not isinstance(call.get('digest'), str) or len(call['digest']) != 64
                           or call['digest'] != call.get('expectedDigest') for call in calls)):
                raise RuntimeError('partial qualification scenario/digest coverage')
        save(output / 'qualification.json', {'status': 'PASS', 'purpose': 'correctness-only', 'formalSamples': 0, 'comparison': False, 'caseHash': case.sha256})
        budget.enforce()
        return
    # These are the existing engine's exact slots, with no added observations.
    for index in range(10 + 4 + 2 * case.data['pairs']):
        state = slot(case.data, index)
        argv = [sys.executable, str(tools / 'measure.py'), '--case', str(casefile), '--phase', state['phase'], '--scenario', 'happy', '--sample', str(index), '--output', str(output)]
        result = subprocess.run(argv, env=environment, check=False, timeout=125)
        if result.returncode:
            raise RuntimeError('measurement failed; no retry or additional sample')
    argv = [sys.executable, str(tools / 'compare.py'), '--task', '12', '--evidence', str(output.parent), '--case', str(casefile)]
    subprocess.run(argv, env=environment, check=True, timeout=120)


def admit_database(inspect_path: Path, role_path: Path) -> None:
    value = json.loads(inspect_path.read_text())
    if not isinstance(value, list) or len(value) != 1:
        raise RuntimeError('malformed database inspect')
    db = value[0]
    config = db['HostConfig']
    expected = {'NetworkMode': 'none', 'ReadonlyRootfs': True, 'Memory': 536870912, 'MemorySwap': 536870912, 'PidsLimit': 128, 'NanoCpus': 1000000000}
    if any(config.get(k) != v for k, v in expected.items()):
        raise RuntimeError('database envelope mismatch')
    if 'size=128m' not in config['Tmpfs'].get('/var/lib/postgresql/data', '') or not db['State']['Running'] or not db['Image'].startswith('sha256:'):
        raise RuntimeError('database fixture mismatch')
    if role_path.read_text().strip() != 'fixture_server|f|f|f':
        raise RuntimeError('database role mismatch')


def git(cwd: Path, *args: str) -> str:
    return subprocess.check_output(['/usr/bin/git', '-C', str(cwd), *args], text=True, timeout=10).strip()


def checked(argv: list[str], env: dict[str, str], expected: str) -> dict[str, Any]:
    """Bound setup output; a zero exit alone is never a completion receipt."""
    # The existing stream controller bounds setup too, including a noisy child.
    out = Path(env['TMPDIR']) / 'setup-output'
    out.mkdir(exist_ok=True)
    runner = BASELINE / 'scripts/qa/bounded-output.mjs'
    result = subprocess.run([NODE, str(runner), str(out), '110000', *argv], env=env, timeout=120, check=False)
    if result.returncode:
        raise RuntimeError('bounded setup child failed')
    value = json.loads((out / 'stdout.txt').read_text())
    if value.get('status') != expected:
        raise RuntimeError('misleading setup success')
    shutil.rmtree(out)
    return value


def run(root: Path, baseline: Path, candidate: Path, node: str, tsx: str, stage: str) -> None:
    stage_request(stage)
    if sys.platform != 'linux' or os.getuid() != 65534 or root != Path('/tmp/measurement'):
        raise RuntimeError('hosted unprivileged namespace required')
    tools = root / 'work/portfolio-performance/tools'
    tools.mkdir(parents=True)
    origin = baseline / 'scripts/perf/o12-engine/work/portfolio-performance/tools'
    for name in MODULES:
        shutil.copyfile(origin / (name + '.py'), tools / (name + '.py'))
    sys.path.insert(0, str(tools))
    protocol = importlib.import_module('protocol')
    Case, digest, file_hash, runtime, save = protocol.Case, protocol.digest, protocol.file_hash, protocol.runtime, protocol.save
    ResourceBudget = importlib.import_module('resource_limits').ResourceBudget

    scratch = root / '.omo/t05-run-tmp/w1'
    environment = {'PATH': str(Path(node).parent) + ':/usr/bin:/bin', 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1'}
    for name in ('HOME', 'TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH'):
        path = scratch / name.lower()
        path.mkdir(parents=True)
        environment[name] = str(path)
    os.environ.clear()
    os.environ.update(environment)
    admit_database(root / 'db-inspect.json', root / 'db-role.txt')
    # Exercise source-write denial on the exact phase mounts before importing apps.
    for cwd in (baseline, candidate):
        try:
            with (cwd / '.o12-write-must-deny').open('x') as handle:
                handle.write('authored')
        except PermissionError:
            continue
        except OSError as error:
            if error.errno == 30:
                continue
            raise
        raise RuntimeError('phase source unexpectedly writable')
    # Owned by this same UID, read-only phase Git needs no wildcard safe.directory.
    for phase in (baseline, candidate):
        if git(phase, 'status', '--porcelain', '--untracked-files=no'):
            raise RuntimeError('dirty phase checkout')
        config = subprocess.run(['/usr/bin/git', '-C', str(phase), 'config', '--local', '--get-regexp', 'http.*extraheader|credential|remote.*url'], capture_output=True, text=True, timeout=3)
        if config.returncode != 1 or config.stdout:
            raise RuntimeError('phase Git configuration is not credential free')
    base = git(baseline, 'rev-parse', 'HEAD')
    head = git(candidate, 'rev-parse', 'HEAD')
    subprocess.run(['/usr/bin/git', '-C', str(candidate), 'merge-base', '--is-ancestor', base, head], check=True, timeout=3)
    for range_ in (base + '..' + head, base + '...' + head):
        if set(git(candidate, 'diff', '--name-only', range_).splitlines()) != set(QUERY_FILES):
            raise RuntimeError('phase diff exceeds the two query files')
    identity = 'Reedtrullz/Nytt-Trondheim'
    save(root / '.omo/drafts/portfolio-performance-optimization-scope.json', {'includedGithubRepositories': [identity], 'includedAdditionalLocalIdentities': []})
    save(root / 'work/portfolio-performance/ownership.json', {'rows': [{'identity': identity, 'roots': [], 'taskOwnedCheckouts': [{'taskId': 12, 'checkout': str(p), 'created': True} for p in (baseline, candidate)]}]})
    def pins(paths: list[Path]) -> dict[str, str]:
        return {str(p): file_hash(p) for p in paths}
    def command(phase: str, mode: str) -> list[str]:
        cwd = baseline if phase == 'baseline' else candidate
        return ['/usr/bin/timeout', '--signal=TERM', '--kill-after=5s', '110s', node, tsx, str(cwd / 'scripts/perf/o12-inputs/query-driver.mts'), '--mode', mode, '--phase', phase, '--checkout', str(cwd), '--store-sha', file_hash(cwd / QUERY_FILES[0]), '--protocol', str(cwd / 'scripts/perf/o12-inputs/protocol.json'), '--socket', '/tmp/pgsocket']
    facts = checked(command('baseline', 'expected'), environment, 'expected')
    other = checked(command('candidate', 'expected'), environment, 'expected')
    if facts != other or len(facts.get('semanticDigest', '')) != 64:
        raise RuntimeError('pre-observation oracle/capability mismatch')
    output = root / '.omo/evidence/portfolio-performance/t12'
    output.mkdir(parents=True)
    timings = ('text_query_ms', 'text_driver_ms', 'sport_query_ms', 'ordinary_query_ms')
    metrics = {n: {'kind': 'timing', 'direction': 'lower', 'scope': 'invocation', 'unit': 'ms', 'aggregate': 'sum', 'repetitions': 1} for n in timings}
    workload = json.loads((baseline / 'scripts/perf/o12-inputs/protocol.json').read_text())['workload']
    counters = {'rows': 'count', 'bytes': 'bytes', 'query_count': 'count'}
    for id_ in workload['scenarios']:
        counters.update({id_ + '_rows': 'count', id_ + '_bytes': 'bytes', id_ + '_queryCount': 'count'})
    metrics.update({n: {'kind': 'counter', 'direction': 'lower', 'scope': 'invocation', 'unit': u, 'aggregate': 'sum', 'repetitions': 1} for n, u in counters.items()})
    commands = {p: command(p, 'qualification' if stage == 'qualification' else 'invoke') for p in ('baseline', 'candidate')}
    if stage == 'qualification':
        metrics = {'qualified_calls': {'kind': 'counter', 'direction': 'lower', 'scope': 'invocation', 'unit': 'count', 'aggregate': 'sum', 'repetitions': 1}}
    fixtures = [baseline / ('scripts/perf/o12-inputs/' + n) for n in ('corpus.mts', 'protocol.json', 'seed.json')]
    harness = [tools / (n + '.py') for n in MODULES] + [Path(__file__), Path(node), Path(tsx), Path(sys.executable).resolve(), Path('/usr/bin/timeout'), root / 'db-inspect.json', root / 'db-role.txt', root / 'admission.json', root / 'pre-schema-admission.json']
    for cwd in (baseline, candidate):
        harness += [cwd / p for p in ('scripts/perf/o12-inputs/query-driver.mts', 'pnpm-lock.yaml', 'package.json', 'packages/shared/dist/index.js')]
        harness += list((cwd / 'packages/shared/dist').rglob('*.js'))
        harness += list((cwd / 'packages/shared/src').rglob('*.ts'))
        # Bind actual installed pg/tsx/esbuild runtime bytes, not only lock metadata.
        for package in (cwd / 'node_modules/.pnpm').iterdir():
            if package.name.startswith(('pg@', 'pg-pool@', 'pg-protocol@', 'pg-types@', 'pg-connection-string@', 'pgpass@', 'postgres-', 'tsx@', 'esbuild@', '@esbuild+linux-')):
                harness += [p for p in package.rglob('*') if p.is_file() and not p.is_symlink()]
    case = {'schema': 'measurement-case/v1', 'id': 'T12-W1-unix', 'task': 12, 'identities': [identity], 'mode': 'native', 'pairs': 10, 'temperature': 'warm', 'offline': True, 'timeout': 120, 'outputBytes': 1048576, 'runtime': runtime(), 'resourceProfile': 'default', 'scratchBytes': 16777216, 'scratchRoot': str(scratch / 'native'), 'artifactRoot': str(output), 'parentEnvironment': {'root': str(scratch), **environment}, 'samplingUnit': 'invocation', 'shape': 'W1-10000-3-27-unix-socket', 'economicsDigest': digest({'pairs': 10, 'pilotPairs': 5, 'warmPairs': 2, 'bootstrap': 2000, 'seed': 1127, 'transport': 'Unix socket; historical docker-stdio 6.44% is not comparable'}), 'harness': pins(harness), 'fixtures': pins(fixtures), 'metrics': metrics, 'primary': 'text_query_ms', 'commands': {'happy': commands}, 'allowlist': list(commands.values()), 'executables': pins([Path('/usr/bin/timeout')]), 'semanticDigest': facts['semanticDigest'], 'capabilities': facts['capabilities']}
    for name, cwd in (('baseline', baseline), ('candidate', candidate)):
        # HEAD/tree plus clean Git bind the complete tree; these bind the used closure.
        paths = list((cwd / 'apps/server/src').rglob('*.ts')) + list((cwd / 'packages/shared/src').rglob('*.ts'))
        paths += [cwd / p for p in (*QUERY_FILES, 'apps/server/src/db/schema.sql', 'pnpm-lock.yaml', 'package.json')]
        case[name] = {'cwd': str(cwd), 'revision': git(cwd, 'rev-parse', 'HEAD'), 'tree': git(cwd, 'rev-parse', 'HEAD^{tree}'), 'sources': pins(paths)}
    if stage == 'qualification':
        case.update(id='T12-W1-qualification', primary='qualified_calls', qualificationOnly=True, qualificationScenarios=workload['scenarios'])
        output = output / 'qualification'
    casefile = root / ('work/portfolio-performance/cases/T12-W1-qualification.json' if stage == 'qualification' else 'work/portfolio-performance/cases/T12-W1-unix.json')
    save(casefile, case)
    encoded = len(json.dumps(case, indent=2, sort_keys=True).encode())
    # Native receipts repeat the definition. Reserve bounded real call/SQL output
    # per unit and fail before seed if the fixed run cannot fit the 16 MiB cap.
    reservation = (2 * (encoded + 2 * 1048576) + 2 * encoded + 1048576
                   if stage == 'qualification' else 34 * (encoded + 200000) + 2 * encoded + 1048576)
    if reservation > 16777216:
        raise RuntimeError('fixed receipt set exceeds combined scratch budget')
    save(output / 'pre-observation.json', {'status': 'FROZEN_BEFORE_SEED_AND_QUERIES', 'caseSha256': file_hash(casefile), 'oracle': facts, 'phases': {p: case[p] for p in ('baseline', 'candidate')}})
    Case.read(casefile)
    seeded = checked(command('baseline', 'seed'), environment, 'seeded')
    expected = json.loads((baseline / 'scripts/perf/o12-inputs/seed.json').read_text())['fixtureDigest']
    if seeded.get('observedFixtureDigest') != expected:
        raise RuntimeError('seed does not match authored fixture')
    budget = ResourceBudget.read(case)
    budget.enforce()
    execute_stage(stage, casefile, tools, output, environment)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--admit-db':
        admit_database(Path(sys.argv[2]), Path(sys.argv[3]))
        print(json.dumps({'status': 'PASS', 'scope': 'actual Docker inspect and actual role readback'}))
        raise SystemExit(0)
    if len(sys.argv) != 7:
        raise SystemExit('ROOT BASELINE CANDIDATE NODE TSX STAGE required')
    ROOT, BASELINE, CANDIDATE = map(Path, sys.argv[1:4])
    NODE, TSX = sys.argv[4:6]
    run(ROOT, BASELINE, CANDIDATE, NODE, TSX, stage_request(sys.argv[6]))
