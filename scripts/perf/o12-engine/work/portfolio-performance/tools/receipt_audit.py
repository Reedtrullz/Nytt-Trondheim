"""Read-only archived comparisons, rooted in caller-trusted checkpoint evidence."""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Final

from protocol import Case, ROOT, WORK, Record, Rejected, digest, file_hash, load, record, require, scope
from resource_limits import regular_path

POINTER: Final = WORK / 'state/current-run.json'


def archive_path(value: str) -> Path:
    path = Path(value)
    path = path if path.is_absolute() else ROOT / path
    require(path.is_relative_to(ROOT) and path != ROOT, 'external archive path')
    regular_path(path)
    return path


@dataclass(frozen=True, slots=True)
class ReceiptArchive:
    bindings: Record
    entries: tuple[Record, ...]
    blocked: tuple[Record, ...]
    fixture_anchor: bool

    @classmethod
    def read(cls, path: Path, anchor_pointer: Path = POINTER) -> ReceiptArchive:
        index = load(archive_path(str(path)))
        require(index['schema'] == 'measurement-receipt-index/v1', 'receipt index schema')
        pointer = load(archive_path(str(anchor_pointer)))
        visited = set()
        while True:
            checkpoint_path = archive_path(pointer['snapshot_path'])
            require(file_hash(checkpoint_path) == pointer['snapshot_sha256'], 'checkpoint digest mismatch')
            require(pointer['snapshot_sha256'] not in visited, 'checkpoint ancestry cycle')
            visited.add(pointer['snapshot_sha256'])
            checkpoint = load(checkpoint_path)
            if pointer['snapshot_sha256'] == index['checkpointSha256']:
                break
            require(bool(checkpoint.get('historical_checkpoint')), 'receipt checkpoint is not trusted ancestry')
            pointer = checkpoint['historical_checkpoint']
        bindings = {}
        for row in checkpoint['input_bindings']:
            previous = bindings.get(row['path'])
            require(previous is None or previous == row['sha256'], 'conflicting trusted binding')
            bindings[row['path']] = row['sha256']
        require(bool(bindings), 'empty trusted archive')
        entries = tuple(index['cases'])
        require(len({e['case']['path'] for e in entries}) == len(entries), 'duplicate archived case')
        return cls(bindings, entries, tuple(index.get('blockedClaims', [])), anchor_pointer != POINTER)

    def verified(self, reference: Record) -> Path:
        path = archive_path(reference['path'])
        require(self.bindings.get(str(path)) == reference['sha256'], 'artifact not checkpoint-bound')
        require(file_hash(path) == reference['sha256'], 'archived raw hash mismatch')
        return path

    def source_artifacts(self, data: Record, attestation: Record) -> None:
        expected = {}
        for group in (data['harness'], data['fixtures'], data['executables'],
                      data['baseline']['sources'], data['candidate']['sources']):
            for source, sha in group.items():
                require(source not in expected or expected[source] == sha, 'conflicting archived source hash')
                expected[source] = sha
        artifacts = record(attestation.get('artifacts', {}))
        require(set(artifacts) == set(expected), 'missing source artifact coverage')
        for source, sha in expected.items():
            require(artifacts[source]['sha256'] == sha, 'wrong source artifact hash')
            self.verified(artifacts[source])

    def original_claim(self, entry: Record, data: Record, native: Record, guards: Record) -> None:
        require('claim' in entry, 'missing original claim provenance')
        claim = load(self.verified(entry['claim']))
        workflow: str | None = None
        if 'evidenceManifest' in claim:
            require(claim.get('schema') == 'portfolio-done-claim/v1', 'unsupported original manifest claim')
            require(claim['taskId'] == claim['omoTask'] == native['taskId'], 'wrong original claim task')
            workflow = claim['omoRun']
            require(all(claim[p] == data[p]['revision'] for p in ('baseline', 'candidate')),
                    'wrong original manifest revisions')
            evidence = self.original_manifest(entry, native)
            freeze_path = self.verified(entry['originalCaseFreeze'])
            require(evidence.get(str(freeze_path)) == entry['originalCaseFreeze']['sha256'],
                    'case freeze missing from original manifest')
            freeze = load(freeze_path)
            require(freeze['case'] == data and freeze['caseHash'] == digest(data),
                    'wrong original manifest case freeze')
        else:
            if 'task' in claim:
                require(claim.get('schema') == 'portfolio-task-done-claim/v1', 'unsupported original numbered claim')
                require(type(claim['task']) is int and claim['task'] > 0
                        and native['taskId'] == f"t{claim['task']}", 'wrong original numbered claim task')
                require(all(claim[p] == data[p]['revision'] for p in ('baseline', 'candidate')),
                        'wrong original numbered claim revisions')
                case_path = self.verified(entry['case'])
                require(claim['evidence'].get(str(case_path)) == entry['case']['sha256'],
                        'case missing from original numbered claim')
            else:
                require(claim['taskId'] == claim['OMO_TASK'] == native['taskId'], 'wrong original claim task')
                workflow = claim['OMO_RUN']
            require(data['identities'] == [claim['identity']], 'wrong original claim identity')
            evidence = record(claim['evidence'])
        if workflow is not None:
            require(archive_path(workflow) == archive_path(
                entry['run'].get('originalPath', entry['run']['path'])), 'wrong original claim workflow')
        references = [ref for scenario in entry['scenarios'].values() for ref in scenario['units']]
        proofs = guards.get('originalEvidence', [])
        require(bool(proofs), 'missing original guard evidence')
        for ref in [*references, *proofs]:
            path = self.verified(ref)
            original_hash = evidence.get(str(path), evidence.get(str(path.relative_to(ROOT))))
            require(original_hash == ref['sha256'], 'raw evidence missing from original claim')

    def original_manifest(self, entry: Record, native: Record) -> Record:
        """Authenticate an external producer manifest through original native tool output."""
        require('originalManifestGate' in entry, 'missing original manifest gate')
        proof = record(entry['originalManifestGate'])
        gate = load(self.verified(proof['native']))
        run = load(self.verified(entry['run']))
        task = next((t for t in run['tasks'] if t['id'] == gate['taskId']), None)
        require(task is not None, 'missing original manifest gate task')
        assert task is not None
        require(gate.get('accepted') is True and gate.get('interrupted') is False
                and gate.get('finalObserved') is True and gate['role'] == 'lazycodex-gate-reviewer',
                'unaccepted original manifest gate')
        require(task['status'] == 'complete' and task.get('parentAccepted') is not False
                and task['receipt'] == gate and task['agentId'] == gate['agentId']
                and task['sourceFingerprint'] == gate['sourceFingerprint']
                and native['taskId'] in task['dependsOn'], 'wrong original manifest gate admission')
        require(bool(gate['checks']), 'missing original manifest gate check')
        for check in gate['checks']:
            require(check['exitCode'] == 0, 'failed original manifest gate check')
            self.verified({'path': check['artifact'], 'sha256': check['sha256']})
        transcript = self.verified(proof['transcript'])
        require(file_hash(transcript) == gate['transcriptSha256'] and transcript.stat().st_size <= 2000000,
                'wrong original manifest gate transcript')
        responses = [record(json.loads(line)) for line in transcript.read_text().splitlines()]
        outputs = [r['payload']['output'] for r in responses if r.get('type') == 'response_item'
                   and r['payload'].get('type') == 'custom_tool_call_output'
                   and r['payload'].get('call_id') == proof['outputCallId']]
        require(len(outputs) == 1, 'missing/duplicate original native hash output')
        bindings_path = self.verified(proof['bindings'])
        original_bindings_path = proof['bindings'].get('originalPath', str(bindings_path))
        expected_line = proof['bindings']['sha256'] + '  ' + original_bindings_path
        lines = []
        for block in outputs[0]:
            if block.get('type') == 'input_text' and block['text'].lstrip().startswith('{'):
                output = record(json.loads(block['text']))
                if output.get('exit_code') == 0:
                    lines.extend(output.get('output', '').splitlines())
        require(expected_line in lines, 'manifest binding absent from original native hash output')
        sealed = load(bindings_path)
        claim_path = self.verified(entry['claim'])
        require(sealed.get(str(claim_path)) == entry['claim']['sha256'], 'claim absent from original gate seal')
        claim = load(claim_path)
        manifest_path = archive_path(claim['evidenceManifest'])
        require(str(manifest_path) in sealed, 'manifest absent from original gate seal')
        manifest = load(self.verified({'path': str(manifest_path), 'sha256': sealed[str(manifest_path)]}))
        return {path: record(value)['sha256'] for path, value in manifest.items()}

    def compare(self, entry: Record) -> Record:
        from compare import compare_case
        path = self.verified(entry['case'])
        data = load(path)
        case_hash = digest(data)
        require(data['schema'] == 'measurement-case/v1' and data['mode'] == 'native', 'archived native case schema')
        require(set(data['identities']) <= scope()[0] and bool(data['identities']), 'excluded archived identity')
        require(data['pairs'] in (5, 10, 20) and data['temperature'] in ('cold', 'warm'), 'archived sampling definition')
        require(data['pairs'] != 20 or bool(data.get('pilotJustification')), 'missing frozen pair justification')
        require(data['offline'] is True and 0 < data['timeout'] <= 120 and 0 < data['outputBytes'] <= 1048576, 'archived process bounds')
        require(0 < data['scratchBytes'] <= (67108864 if data.get('resourceProfile') == 'browser-64m-20261028' else 16777216), 'archived scratch bound')
        attestation = load(self.verified(entry['attestation']))
        require(attestation['caseHash'] == case_hash and attestation['runtime'] == data['runtime'], 'misbound archived runtime')
        for key in ('harness', 'fixtures', 'executables'):
            require(attestation[key] == data[key], 'wrong source/fixture/executable attestation')
        require(attestation['sources'] == {p: data[p] for p in ('baseline', 'candidate')}, 'wrong source attestation')
        self.source_artifacts(data, attestation)
        guards = load(self.verified(entry['guards']))
        require(guards['caseHash'] == case_hash and guards['passed'] is True, 'missing original guard proof')
        native = load(self.verified(entry['native']))
        if data.get('selftestOnly') is True:
            require(self.fixture_anchor and native.get('fixtureOnly') is True and native.get('accepted') is False,
                    'synthetic archive is auditor-fixture only')
        else:
            require(not self.fixture_anchor and native.get('accepted') is True and native.get('interrupted') is False,
                    'missing accepted native execution')
            run = load(self.verified(entry['run']))
            task = next((t for t in run['tasks'] if t['id'] == native['taskId']), None)
            if task is None:
                raise Rejected('missing original workflow task')
            require(task['status'] == 'complete' and task.get('parentAccepted') is not False,
                    'failed/unaccepted workflow cannot admit a receipt')
            require(task['agentId'] == native['agentId'] and task['receipt'] == native, 'wrong native admission')
            require(task['sourceFingerprint'] == native['sourceFingerprint'], 'wrong original native admission')
            self.original_claim(entry, data, native, guards)
            require(bool(native['checks']) and native['finalObserved'] is True, 'missing independent execution check')
            for check in native['checks']:
                require(check['exitCode'] == 0, 'failed original execution check')
                self.verified({'path': check['artifact'], 'sha256': check['sha256']})
            require(guards.get('scope') == 'native-process' and guards.get('qaPassed') is True,
                    'application assertion alone is not process guard proof')
        require(set(entry['scenarios']) == set(data['commands']), 'omitted archived scenario')
        results = []
        for scenario, archive in entry['scenarios'].items():
            directory = archive_path(archive['directory'])
            require(directory.name == scenario, 'misbound archived scenario directory')
            paths = sorted(directory.glob('[0-9][0-9][0-9].json'))
            require([str(p) for p in paths] == [str(self.verified(r)) for r in archive['units']], 'omitted/extra native units')
            result = compare_case(Case(path, data, case_hash), directory)
            require(result['outcome'] == archive['outcome'], 'false archived gain aggregate')
            results.append(result)
        return {'case': str(path), 'caseHash': case_hash, 'selftestOnly': data.get('selftestOnly', False), 'scenarios': results}

    def all(self) -> list[Record]:
        return [self.compare(entry) for entry in self.entries]

    def report_gain(self, report: Record) -> Record:
        path = archive_path(report['case'])
        entry = next((e for e in self.entries if archive_path(e['case']['path']) == path), None)
        if entry is None:
            raise Rejected('gain missing admitted receipt index entry')
        result = self.compare(entry)
        require(result['selftestOnly'] is False, 'synthetic selftest is not product gain')
        units = archive_path(report['units'])
        require(any(archive_path(s['directory']) == units and s['outcome'] == 'VERIFIED_GAIN'
                    for s in entry['scenarios'].values()), 'report gain has no matching qualified scenario')
        return result
