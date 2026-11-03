"""Collect one independent unit. Usage: measure.py --case FILE --phase baseline --scenario happy [--sample N --output DIR]."""
from __future__ import annotations

import argparse
import fcntl
import json
import subprocess
import sys
from pathlib import Path

from native import invoke
from protocol import Case, EVIDENCE, ROOT, RUN_TMP, Rejected, bindings, digest, load, owned, require, save, slot
from resource_limits import ResourceBudget


def collect(args: argparse.Namespace) -> int:
    case = Case.read(Path(args.case))
    data = case.data
    output_root = RUN_TMP if data.get('selftestOnly') and args.output and Path(args.output).resolve().is_relative_to(RUN_TMP) else EVIDENCE
    output = owned(str(Path(args.output).resolve()), output_root) if args.output else EVIDENCE / f't{data["task"]:02d}'
    if data['mode'] == 'static':
        require(args.phase is None, 'static disposition has no timed phase')
        rows = data['dispositions']
        require({r['identity'] for r in rows} == set(data['identities']) and len(rows) == len(data['identities']), 'missing identity disposition')
        require(all(r['outcome'] in ('NO_CHANGE_NEEDED', 'ALREADY_COVERED', 'BLOCKED') for r in rows), 'static disposition outcome')
        save(output / 'disposition.json', {'caseHash': case.sha256, 'case': str(case.path),
             'sources': data['sources'], 'rows': rows, 'runtimeMetrics': None})
        print(json.dumps({'status': 'PASS', 'receipt': str(output / 'disposition.json')}))
        return 0
    require(args.phase is not None, 'native phase required')
    budget = ResourceBudget.read(data)
    require(output.resolve().is_relative_to(budget.artifacts), 'output outside declared artifact root')
    require(args.scenario in data['commands'], 'unknown scenario')
    state = slot(data, args.sample)
    require(state['phase'] == args.phase, 'wrong AB/BA phase/order')
    directory = output / data['id'] / args.scenario
    directory.mkdir(parents=True, exist_ok=True)
    # The lock protects only local QA receipts, never publication ownership.
    with (directory / 'collection.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = directory / f'{args.sample:03d}.json'
        require(not target.exists(), 'duplicate independent unit')
        for index in range(args.sample):
            prior = load(directory / f'{index:03d}.json')
            require(prior['status'] == 'PASS' and prior['caseHash'] == case.sha256, 'missing/stale/failed prior unit')
            require(prior['state'] == slot(data, index), 'prior unit order')
        request = {**state, 'scenario': args.scenario, 'caseHash': case.sha256,
                   'revision': data[args.phase]['revision'], 'fixtureDigest': digest(data['fixtures']),
                   'harnessDigest': digest(data['harness']), 'shape': data['shape'],
                   'economicsDigest': data['economicsDigest']}
        receipt = invoke(case, request)
        receipt.update({'caseHash': case.sha256, 'case': str(case.path), 'state': state,
                        'request': request, 'definition': data})
        save(target, receipt)
        try:
            budget.enforce()
        except Rejected as error:
            receipt['status'] = 'ERROR'
            receipt['error'] = str(error)
            receipt.pop('metrics', None)
            save(target, receipt)
        print(json.dumps({'status': receipt['status'], 'receipt': str(target), 'error': receipt.get('error')}))
        return 0 if receipt['status'] == 'PASS' else 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', required=True)
    parser.add_argument('--phase', choices=('baseline', 'candidate'))
    parser.add_argument('--scenario', default='happy')
    parser.add_argument('--sample', type=int, default=0)
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        return collect(args)
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status': 'REJECTED', 'error': str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
