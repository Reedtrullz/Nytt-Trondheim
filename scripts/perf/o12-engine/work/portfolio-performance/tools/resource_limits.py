"""Approved case envelopes and owned adapter/native file accounting."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import os
from pathlib import Path
import shutil
import sys
from typing import Final, TypedDict, assert_never

from protocol import EVIDENCE, ROOT, RUN_TMP, Record, Rejected, file_hash, owned, record, require

APPROVAL: Final = ROOT / '.omo/operations/portfolio-unblocking-execute-20261028/metis-closure-plan.md'
APPROVAL_SHA: Final = '781cd061013ec6227385fb3b8b6a29766df50747a867e537c41ab6f9480472c3'
CACHE_KEYS: Final = ('HOME', 'TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH')
ENV_KEYS: Final = (*CACHE_KEYS, 'PATH', 'LANG', 'PYTHONDONTWRITEBYTECODE')


class EnvironmentSpec(TypedDict):
    root: str
    HOME: str
    TMPDIR: str
    NODE_COMPILE_CACHE: str
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: str
    PATH: str
    LANG: str
    PYTHONDONTWRITEBYTECODE: str


def capture_environment() -> EnvironmentSpec:
    try:
        return {'root': str(Path(os.environ['TMPDIR']).parent), 'HOME': os.environ['HOME'],
                'TMPDIR': os.environ['TMPDIR'], 'NODE_COMPILE_CACHE': os.environ['NODE_COMPILE_CACHE'],
                'BUN_RUNTIME_TRANSPILER_CACHE_PATH': os.environ['BUN_RUNTIME_TRANSPILER_CACHE_PATH'],
                'PATH': os.environ['PATH'], 'LANG': os.environ['LANG'],
                'PYTHONDONTWRITEBYTECODE': os.environ['PYTHONDONTWRITEBYTECODE']}
    except KeyError as error:
        raise Rejected('missing adapter environment: ' + str(error)) from error


def regular_path(path: Path) -> None:
    require(path.is_absolute() and '..' not in path.parts, 'absolute canonical owned path required')
    for item in (*path.parents, path):
        require(not item.is_symlink(), 'scratch symlink')


def scratch_size(root: Path) -> int:
    regular_path(root)
    size = 0
    if root.exists():
        for path in root.rglob('*'):
            require(not path.is_symlink(), 'scratch symlink')
            if path.is_file():
                size += path.stat().st_size
    return size


class Profile(StrEnum):
    DEFAULT = 'default'
    BROWSER = 'browser-64m-20261028'


@dataclass(frozen=True, slots=True)
class ResourceBudget:
    limit: int
    root: Path
    native_root: Path
    artifacts: Path
    parent_caches: tuple[Path, ...]

    @classmethod
    def read(cls, data: Record) -> ResourceBudget:
        try:
            profile = Profile(data.get('resourceProfile', 'default'))
        except ValueError as error:
            raise Rejected('unsupported resource profile') from error
        match profile:
            case Profile.DEFAULT:
                ceiling = 16 * 1024 * 1024
            case Profile.BROWSER:
                approval = record(data['browserProfileApproval'])
                require(data.get('modality') == 'browser', 'browser profile requires browser modality')
                require(approval == {'path': str(APPROVAL), 'sha256': APPROVAL_SHA}, 'unapproved browser envelope')
                require(file_hash(APPROVAL) == APPROVAL_SHA, 'stale browser approval')
                ceiling = 64 * 1024 * 1024
            case unreachable:
                assert_never(unreachable)
        limit = data['scratchBytes']
        require(type(limit) is int and 0 < limit <= ceiling, 'invalid scratchBytes bound')
        spec = record(data['parentEnvironment'])
        require(set(spec) == {'root', *ENV_KEYS}, 'unexpected declared adapter environment')
        runtime_keys = {'LC_CTYPE'}
        # macOS exec injects public UID/encoding metadata even for an explicit clean map.
        if sys.platform == 'darwin' and '__CF_USER_TEXT_ENCODING' in os.environ:
            try:
                encoding = tuple(int(v, 0) for v in os.environ['__CF_USER_TEXT_ENCODING'].split(':'))
            except ValueError as error:
                raise Rejected('invalid OS encoding metadata') from error
            require(len(encoding) == 3 and encoding[0] == os.getuid()
                    and all(0 <= v <= 0xFFFFFFFF for v in encoding), 'invalid OS encoding metadata')
            runtime_keys.add('__CF_USER_TEXT_ENCODING')
        unexpected = sorted(set(os.environ) - {*ENV_KEYS, *runtime_keys})
        require(not unexpected, 'adapter inherited undeclared environment: ' + ','.join(unexpected))
        root = Path(spec['root'])
        regular_path(root)
        owned(str(root), RUN_TMP)
        require(root.is_dir(), 'adapter invocation root missing')
        for key in ENV_KEYS:
            require(isinstance(spec.get(key), str) and os.environ.get(key) == spec[key], 'missing/mismatched adapter environment: ' + key)
        require(spec['LANG'] == 'C' and spec['PYTHONDONTWRITEBYTECODE'] == '1', 'unsanitized adapter environment')
        require(all(Path(p).is_absolute() for p in spec['PATH'].split(os.pathsep)), 'absolute toolchain PATH required')
        caches = tuple(Path(spec[key]) for key in CACHE_KEYS)
        require(len(set(caches)) == len(caches), 'overlapping adapter cache paths')
        require(all(not a.is_relative_to(b) for a in caches for b in caches if a != b), 'nested adapter cache paths')
        for path in caches:
            regular_path(path)
            owned(str(path), root)
            require(path.is_dir(), 'adapter cache directory missing')
        native_root = Path(data['scratchRoot'])
        regular_path(native_root)
        owned(str(native_root), root)
        artifacts = Path(data['artifactRoot'])
        regular_path(artifacts)
        require(artifacts != EVIDENCE and (artifacts.is_relative_to(EVIDENCE)
                or (data.get('selftestOnly') is True and artifacts.is_relative_to(RUN_TMP))), 'unowned artifact root')
        for path in caches:
            require(not native_root.is_relative_to(path) and not artifacts.is_relative_to(path), 'runtime/artifacts overlap cache cleanup')
        return cls(limit, root, native_root, artifacts, caches)

    def usage(self) -> int:
        roots = (self.root,) if self.artifacts.is_relative_to(self.root) else (self.root, self.artifacts)
        require(not self.root.is_relative_to(self.artifacts) or self.root == self.artifacts, 'artifact root contains unrelated invocation roots')
        return sum(scratch_size(path) for path in roots)

    def enforce(self, reserved_bytes: int = 0) -> int:
        require(type(reserved_bytes) is int and reserved_bytes >= 0, 'invalid scratch reservation')
        size = self.usage() + reserved_bytes
        require(size <= self.limit, 'combined scratch/artifact bound exceeded')
        return size

    def clear_parent_caches(self) -> None:
        for path in self.parent_caches:
            if path.is_symlink():
                path.unlink()
            elif path.exists():
                shutil.rmtree(path)
            path.mkdir()
