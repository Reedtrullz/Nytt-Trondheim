"""Bounded offline native invocation; metrics come exclusively from native JSON."""
from __future__ import annotations

import os
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

from protocol import Case, Record, Rejected, RUN_TMP, bindings, finite, owned, record, require, verify_source
from resource_limits import ResourceBudget, scratch_size


def invoke(case: Case, request: Record) -> Record:
    data = case.data
    phase = request['phase']
    budget = ResourceBudget.read(data)
    root = budget.native_root
    root.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix='unit-', dir=root))
    argv = data['commands'][request['scenario']][phase]
    env = {'PATH': data['parentEnvironment']['PATH'], 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1',
           'HOME': str(scratch), 'TMPDIR': str(scratch),
           'NODE_COMPILE_CACHE': str(scratch / 'node'),
           'BUN_RUNTIME_TRANSPILER_CACHE_PATH': str(scratch / 'bun'),
           'MEASURE_REQUEST': __import__('json').dumps(request)}
    receipt = {'argv': argv, 'cwd': data[phase]['cwd'], 'env': env,
               'scratch': str(scratch), 'status': 'ERROR', 'stdout': '', 'stderr': '', 'startedNs': time.monotonic_ns()}
    output = [bytearray(), bytearray()]
    process = None
    job = None
    reservation = 0
    accounting = 'combinedScratchPeakBytes'
    try:
        deadline = time.monotonic() + data['timeout']
        if 'container' in data:
            from container_resources import ContainerJob
            job = ContainerJob(data, phase, scratch, env, deadline)
            receipt['container'] = job.identity
            reservation = job.spec['scratchBytes']
            accounting = 'combinedScratchUpperBoundBytes'
            budget.enforce(reservation)
            argv = job.prepare(argv, env['MEASURE_REQUEST'], data['timeout'])
            receipt['controlArgv'] = argv
            deadline -= 6
        receipt[accounting] = budget.enforce(reservation)
        process = subprocess.Popen(argv, cwd=data[phase]['cwd'], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True, shell=False)
        receipt['pid'] = process.pid
        assert process.stdout is not None and process.stderr is not None
        if job is None:
            deadline = time.monotonic() + data['timeout']
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, 0)
            selector.register(process.stderr, selectors.EVENT_READ, 1)
            while selector.get_map():
                require(time.monotonic() < deadline, 'timeout')
                receipt[accounting] = max(receipt[accounting], budget.enforce(reservation))
                for key, _ in selector.select(timeout=min(0.02, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fd, 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    available = max(0, data['outputBytes'] - sum(map(len, output)))
                    output[key.data].extend(chunk[:available])
                    require(len(chunk) <= available, 'output bound exceeded')
            process.wait(timeout=max(0.001, deadline - time.monotonic()))
        receipt['returncode'] = process.returncode
        require(process.returncode == 0, 'nonzero native result')
        receipt[accounting] = max(receipt[accounting], budget.enforce(reservation))
        verify_source(data, phase)
        bindings(record(data['harness']))
        bindings(record(data['fixtures']))
        import json
        native = record(json.loads(output[0].decode('utf-8')))
        require(native.get('status') == 'complete', 'partial/missing native receipt')
        for key in ('caseHash', 'phase', 'unit', 'sample', 'scenario', 'revision', 'fixtureDigest', 'harnessDigest', 'shape', 'economicsDigest'):
            require(native.get(key) == request[key], f'native binding mismatch: {key}')
        require(native.get('semanticDigest') == data['semanticDigest'], 'semantic parity')
        require(native.get('capabilities') == data['capabilities'], 'capability parity')
        receipt['metrics'] = normalize(data, native)
        receipt['native'] = native
        receipt['status'] = 'PASS'
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        receipt['error'] = str(error)
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                receipt['groupAlreadyExited'] = True
            except OSError as error:
                receipt['cleanupError'] = str(error)
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                try:
                    process.kill()
                    process.wait(timeout=1)
                except (OSError, subprocess.TimeoutExpired) as error:
                    receipt['cleanupError'] = str(error)
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()
            receipt['reaped'] = process.returncode is not None
            if 'cleanupError' in receipt or not receipt['reaped']:
                receipt['status'] = 'ERROR'
                receipt.pop('metrics', None)
        if job is not None:
            try:
                job.close()
            except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
                receipt.update(status='ERROR', cleanupError=str(error))
                receipt.pop('metrics', None)
        receipt['stdout'] = output[0].decode('utf-8', errors='replace')
        receipt['stderr'] = output[1].decode('utf-8', errors='replace')
        receipt['scratchCleaned'] = process is None or receipt.get('reaped') is True
        if receipt['scratchCleaned']:
            shutil.rmtree(scratch)
            budget.clear_parent_caches()
        receipt['parentScratchCleaned'] = receipt['scratchCleaned']
        receipt['endedNs'] = time.monotonic_ns()
    return receipt


def normalize(case: Record, native: Record) -> Record:
    import statistics
    result = {}
    require(set(native['metrics']) == set(case['metrics']), 'missing/extra metrics')
    factors = {'s': ('time', 1), 'ms': ('time', .001), 'us': ('time', .000001),
               'bytes': ('size', 1), 'KiB': ('size', 1024), 'count': ('count', 1)}
    for name, spec in case['metrics'].items():
        metric = record(native['metrics'][name])
        require(metric['scope'] == spec['scope'], 'metric sampling scope')
        require(metric['unit'] in factors and factors[metric['unit']][0] == factors[spec['unit']][0], 'metric unit mismatch')
        values = metric['values']
        require(isinstance(values, list) and len(values) == spec['repetitions'], 'nested sample shape/repeated invocation metric')
        numbers = [finite(v) * factors[metric['unit']][1] for v in values]
        require(all(v >= 0 for v in numbers), 'negative metric')
        aggregate = {'median': statistics.median, 'sum': sum, 'max': max}[spec['aggregate']]
        result[name] = aggregate(numbers)
    return result
