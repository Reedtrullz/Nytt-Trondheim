"""Inspect existing manifests. Usage: --task N --evidence DIR; --audit-coverage FILE --reports DIR; --audit-run DIR --reports DIR."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from decisions import decide
from native import normalize
from protocol import Case, Record, Rejected, WORK, bindings, digest, file_hash, load, require, save, scope, slot
from receipt_audit import ReceiptArchive


def compare_case(case: Case, directory: Path) -> Record:
    data = case.data
    if data['mode'] == 'static':
        receipt = load(directory.parent.parent / 'disposition.json')
        require(receipt['caseHash'] == case.sha256 and receipt['runtimeMetrics'] is None, 'stale static receipt')
        require({r['identity'] for r in receipt['rows']} == set(data['identities']), 'missing static rows')
        require(receipt['rows'] == data['dispositions'] and receipt['sources'] == data['sources'], 'stale static disposition')
        return {'status': 'PASS', 'outcome': 'DISPOSITION', 'rows': receipt['rows']}
    paths = sorted(directory.glob('[0-9][0-9][0-9].json'))
    expected = 10 + (4 if data['temperature'] == 'warm' else 0) + 2 * data['pairs']
    require(len(paths) == expected, 'missing pairs/fixed final count')
    units = []
    for index, path in enumerate(paths):
        unit = load(path)
        require(path.name == f'{index:03d}.json' and unit['state'] == slot(data, index), 'wrong pair/order/unit')
        require(unit['status'] == 'PASS' and unit['caseHash'] == case.sha256, 'failed/stale receipt')
        require(unit['definition'] == data and unit['request']['caseHash'] == case.sha256, 'mismatched harness/aggregation/shape')
        request = unit['request']
        phase = unit['state']['phase']
        require(unit.get('returncode') == 0 and unit.get('reaped') is True and unit.get('scratchCleaned') is True, 'nonterminal native unit')
        if 'parentEnvironment' in data:
            require(unit.get('parentScratchCleaned') is True and unit.get('combinedScratchPeakBytes', -1) >= 0
                    and unit['combinedScratchPeakBytes'] <= data['scratchBytes'], 'missing parent resource observations')
        require(unit['startedNs'] < unit['endedNs'] and (not units or units[-1]['endedNs'] < unit['startedNs']), 'overlapping/reordered collection')
        expected_request = {**slot(data, index), 'scenario': directory.name, 'caseHash': case.sha256,
                            'revision': data[phase]['revision'], 'fixtureDigest': digest(data['fixtures']),
                            'harnessDigest': digest(data['harness']), 'shape': data['shape'],
                            'economicsDigest': data['economicsDigest']}
        require(request == expected_request, 'mismatched pair/harness/fixture/shape/economics')
        require(unit['argv'] == data['commands'][request['scenario']][phase], 'argv mismatch')
        require(unit['cwd'] == data[phase]['cwd'], 'cwd mismatch')
        native = json.loads(unit['stdout'])
        require(native == unit['native'] and native['status'] == 'complete', 'missing native receipt')
        for key in ('caseHash', 'phase', 'unit', 'sample', 'scenario', 'revision', 'fixtureDigest', 'harnessDigest', 'shape', 'economicsDigest'):
            require(native.get(key) == request[key], f'native identity mismatch: {key}')
        require(request['revision'] == data[phase]['revision'] and request['unit'] == unit['state']['unit'], 'source/unit mismatch')
        require(request['sample'] == index and request['phase'] == phase, 'sample/phase mismatch')
        require(native['semanticDigest'] == data['semanticDigest'] and native['capabilities'] == data['capabilities'], 'semantic/capability parity')
        require(unit['metrics'] == normalize(data, native), 'unsupported or altered metrics')
        units.append(unit)
    return {**decide(data, units), 'case': data['id'], 'caseHash': case.sha256,
            'identities': data['identities'], 'selftestOnly': data.get('selftestOnly', False), 'receipts': [str(p) for p in paths]}


def audit_reports(reports: Path, archive: ReceiptArchive | None = None) -> list[Record]:
    manifests = sorted(reports.rglob('*.manifest.json'))
    require(bool(manifests), 'missing report manifests')
    results = []
    github, local = scope()
    for path in manifests:
        report = load(path)
        require(report['identity'] in github | local, 'excluded report identity')
        require(bool(report['evidence']), 'missing report evidence')
        bindings(report['evidence'])
        require(report['outcome'] in ('VERIFIED_GAIN', 'NO_PROVEN_GAIN', 'NO_CHANGE_NEEDED', 'ALREADY_COVERED', 'BLOCKED'), 'report outcome')
        if report['outcome'] == 'VERIFIED_GAIN':
            if archive is not None:
                archive.report_gain(report)
            else:
                case = Case.read(Path(report['case']))
                require(not case.data.get('selftestOnly'), 'synthetic selftest is not product gain')
                result = compare_case(case, Path(report['units']))
                require(result['outcome'] == 'VERIFIED_GAIN', 'unproven report gain')
        results.append(report)
    return results


def audit_run(state: Path, reports: Path, archive: ReceiptArchive | None = None) -> Record:
    """Read a bridge to the installed journal; never write publication state."""
    manifest = load(state / 'audit-manifest.json')
    require(manifest['schema'] == 'checkpoint-audit/v1', 'checkpoint audit schema')
    bindings(manifest['inputs'])
    bindings(manifest['journal'])
    events = []
    for path in manifest['journal']:
        journal = load(Path(path))
        require(journal['schema'] == 'github-agent-engineering/action-journal-v1', 'installed journal schema')
        for event in journal['events']:
            require(event['repository'] in scope()[0], 'excluded journal repository')
            require(event['state'] == 'RECONCILED' and event['result'] in ('SUCCEEDED', 'FAILED', 'NOT_DISPATCHED'), 'unreconciled native journal')
            events.append(event)
    require(bool(manifest['actions']), 'missing action dispositions')
    for action in manifest['actions']:
        require(action['state'] in ('verified', 'no-change', 'WAITING_EXTERNAL'), 'pending/unknown dispatch')
        if action['state'] == 'verified':
            require(any(e['id'] == action['eventId'] and e['result'] == 'SUCCEEDED' for e in events), 'missing successful journal event')
            require(bool(action['authorization']) and bool(action['readbacks']), 'missing authorization/readback')
            bindings(action['authorization'])
            bindings(action['readbacks'])
        for issue in action.get('issues', []):
            require('/issues/' in issue and '/pull/' not in issue, 'PR is not Issue')
    rows = audit_reports(reports, archive)
    require({r['identity'] for r in rows} == set.union(*scope()), 'missing identity reports')
    return {'status': 'PASS', 'scope': 'manifest arithmetic and hash checks only', 'waitingExternal': sum(a['state'] == 'WAITING_EXTERNAL' for a in manifest['actions'])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--task', type=int)
    modes.add_argument('--audit-coverage')
    modes.add_argument('--audit-run')
    parser.add_argument('--evidence')
    parser.add_argument('--reports')
    parser.add_argument('--case', action='append', help='Explicit retained case paths for selftest/multiple cases')
    parser.add_argument('--receipt-index', help='Read-only archived provenance for audit modes only')
    args = parser.parse_args()
    try:
        require(not args.receipt_index or args.task is None, 'receipt mode cannot launch/requalify native tasks')
        archive = None
        if args.receipt_index:
            archive = ReceiptArchive.read(Path(args.receipt_index))
        if args.task is not None:
            require(bool(args.evidence), '--evidence required')
            paths = [Path(p) for p in args.case] if args.case else [WORK / f'cases/T{args.task:02d}.json']
            results = []
            seen = set()
            for path in paths:
                case = Case.read(path)
                require(case.data['task'] == args.task, 'multi-case task attribution')
                require(case.data['id'] not in seen, 'duplicate case attribution')
                seen.add(case.data['id'])
                scenarios = case.data.get('commands', {'disposition': {}})
                for scenario in scenarios:
                    result = compare_case(case, Path(args.evidence) / f't{args.task:02d}' / case.data['id'] / scenario)
                    results.append(result)
            result = {'status': 'PASS', 'cases': results}
            save(Path(args.evidence) / f't{args.task:02d}' / 'comparison.json', result)
        elif args.audit_coverage:
            require(bool(args.reports), '--reports required')
            coverage = load(Path(args.audit_coverage))
            expected = set.union(*scope())
            require({r['identity'] for r in coverage['rows']} == expected and len(coverage['rows']) == len(expected), 'coverage identity-set mismatch')
            reports = audit_reports(Path(args.reports), archive)
            require({r['identity'] for r in reports} == expected and len(reports) == len(expected), 'missing/duplicate identity reports')
            result = {'status': 'PASS', 'identities': sorted(expected)}
        else:
            require(bool(args.reports), '--reports required')
            result = audit_run(Path(args.audit_run), Path(args.reports), archive)
        if archive is not None:
            result['receiptAudit'] = {'cases': archive.all(), 'blockedClaims': list(archive.blocked),
                                     'scope': 'Archived claims only; blocked historical claims remain unqualified'}
        print(json.dumps(result, allow_nan=False))
        return 0
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status': 'REJECTED', 'error': str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
