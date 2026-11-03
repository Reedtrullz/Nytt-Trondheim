"""Owned, bounded jobs using the already cached public Node image."""
from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import time
import uuid

from protocol import Record, file_hash, record, require
from resource_limits import regular_path

IMAGE = 'sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752'
SOCKET = '/Users/reidar/.colima/default/docker.sock'
MIB = 1024 * 1024


def validate(data: Record, phase: str) -> Record:
    spec = record(data['container'])
    require(set(spec) == {'profile', 'image', 'docker', 'mounts', 'scratchBytes'}, 'container fields')
    require(spec['profile'] == 'node22-pidns-v1' and spec['image'] == IMAGE, 'unqualified container profile/image')
    require(12 < data['timeout'] <= 120, 'container timeout must include control reserves')
    capacity = spec['scratchBytes']
    require(type(capacity) is int and 2 * MIB <= capacity <= data['scratchBytes'] - MIB, 'container scratch reservation')
    for executable in (spec['docker'], str(Path(sys.executable).resolve())):
        require(executable in data['executables'] and file_hash(Path(executable)) == data['executables'][executable], 'container control executable binding')
    allowed = {**data['harness'], **data['fixtures'], **data[phase]['sources']}
    mounts = record(spec['mounts'])
    require(bool(mounts) and set(mounts) <= set(allowed), 'unbound container mount')
    require(len(set(mounts.values())) == len(mounts), 'duplicate container target')
    for source, target in mounts.items():
        regular_path(Path(source))
        require(Path(source).is_file() and file_hash(Path(source)) == allowed[source], 'stale container mount')
        path = PurePosixPath(target)
        require(path.is_relative_to('/work') and len(path.parts) > 2 and '..' not in path.parts
                and str(path) == target and ',' not in source + target, 'invalid container mount target')
    for phases in data['commands'].values():
        argv = phases[phase]
        require(argv[0] == spec['docker'] and len(argv) >= 2 and argv[1] in mounts.values(), 'container entry binding')
    return spec


class ContainerJob:
    def __init__(self, data: Record, phase: str, scratch: Path, env: dict[str, str], deadline: float):
        self.spec = validate(data, phase)
        self.scratch, self.env, self.deadline = scratch, env, deadline
        self.name = 'portfolio-guard-' + uuid.uuid4().hex
        self.identity: Record = {'name': self.name, 'image': IMAGE, 'nonce': self.name,
                                 'control': [], 'cleaned': False, 'namespaceScratchCapacityBytes': self.spec['scratchBytes']}
        self.attempted = False
        self.create_acknowledged = False

    def control(self, arguments: list[str], *, cleanup: bool = False) -> str:
        remaining = self.deadline - time.monotonic() - (0 if cleanup else 6)
        require(remaining > 0, 'container control deadline')
        paths = [self.scratch / ('control.' + stream) for stream in ('out', 'err')]
        # Regular descriptors avoid truncated pipe reads; RLIMIT_FSIZE bounds both streams.
        launcher = 'import resource,os,sys;resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536));os.execv(sys.argv[1],sys.argv[1:])'
        argv = [str(Path(sys.executable).resolve()), '-S', '-c', launcher, self.spec['docker'],
                '--host', 'unix://' + SOCKET, *arguments]
        with paths[0].open('wb') as stdout, paths[1].open('wb') as stderr:
            result = subprocess.run(argv, env=self.env, stdout=stdout, stderr=stderr, timeout=min(3, remaining))
        out, err = (p.read_text(errors='replace') for p in paths)
        self.identity['control'].append({'argv': argv, 'returncode': result.returncode, 'stdout': out, 'stderr': err})
        require(result.returncode == 0, 'container control failed: ' + err.strip())
        return out

    def inspect(self, *, cleanup: bool = False) -> Record:
        items = json.loads(self.control(['inspect', '--type', 'container', self.name], cleanup=cleanup))
        require(isinstance(items, list) and len(items) == 1, 'container inspect shape')
        info = record(items[0])
        require(info['Name'] == '/' + self.name and info['Image'] == IMAGE
                and info['Config']['Labels'].get('portfolio.guard') == self.name, 'foreign container identity')
        if 'id' in self.identity:
            require(info['Id'] == self.identity['id'], 'changed container ID')
        self.identity['id'] = info['Id']
        return info

    def prepare(self, argv: list[str], request: str, timeout: float) -> list[str]:
        mounts = []
        for source, target in self.spec['mounts'].items():
            mounts += ['--mount', f'type=bind,source={source},target={target},readonly']
        self.attempted = True
        self.control(['create', '--pull=never', '--name', self.name, '--label', 'portfolio.guard=' + self.name,
                      '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                      '--network', 'none', '--dns', '127.0.0.1', '--read-only', '--init', '--pids-limit', '32',
                      '--cpus', '0.5', '--memory', str(128 * MIB), '--memory-swap', str(128 * MIB),
                      '--log-driver', 'none', '--shm-size', str(MIB),
                      '--tmpfs', f'/tmp:rw,nosuid,nodev,size={self.spec["scratchBytes"] - MIB},mode=1777',
                      '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'NODE_COMPILE_CACHE=/tmp/node',
                      '--env', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH=/tmp/bun', '--env', 'LANG=C',
                      '--env', 'MEASURE_REQUEST=' + request, *mounts, '--entrypoint', '/usr/bin/timeout', IMAGE,
                      '--signal=KILL', str(timeout - 12), '/usr/local/bin/node', *argv[1:]])
        self.create_acknowledged = True
        info = self.inspect()
        host = info['HostConfig']
        require(host['NetworkMode'] == 'none' and host['ReadonlyRootfs'] and host['PidsLimit'] == 32
                and host['Memory'] == 128 * MIB and host['MemorySwap'] == 128 * MIB
                and host['ShmSize'] == MIB and host['Init'] is True and host['CapDrop'] == ['ALL']
                and 'no-new-privileges' in host['SecurityOpt'] and host['Dns'] == ['127.0.0.1']
                and host['LogConfig']['Type'] == 'none' and info['Config']['User'] == '1000:1000', 'container guard readback')
        expected = {(p, t) for p, t in self.spec['mounts'].items()}
        actual = {(m['Source'], m['Destination']) for m in info['Mounts'] if m['Type'] == 'bind' and not m['RW']}
        require(actual == expected and len(info['Mounts']) == len(expected), 'container mount readback')
        self.identity['guardReadback'] = {'host': host, 'mounts': info['Mounts'], 'user': info['Config']['User']}
        return [self.spec['docker'], '--host', 'unix://' + SOCKET, 'start', '--attach', self.name]

    def close(self) -> None:
        if not self.attempted:
            self.identity['cleaned'] = True
            return
        # A failed create may still have created the owned name; inspect the daemon.
        names = self.control(['ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.Names}}'], cleanup=True).splitlines()
        require(names in ([], [self.name]), 'ambiguous container ownership')
        require(bool(names) or self.create_acknowledged, 'unacknowledged create: cleanup remains unresolved')
        if names:
            info = self.inspect(cleanup=True)
            if info['State']['Running']:
                self.control(['kill', '--signal', 'KILL', self.name], cleanup=True)
            state = self.inspect(cleanup=True)['State']
            require(not state['Running'] and state['Pid'] == 0, 'container process survives')
            self.identity['terminalState'] = state
            self.control(['rm', self.name], cleanup=True)
            require(not self.control(['ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.Names}}'], cleanup=True).strip(), 'container removal unconfirmed')
        self.identity['cleaned'] = True
