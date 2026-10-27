"""Host controller for the export72 CI preflight.

The Docker daemon is used only by --qualify. --self-check stays on local processes.
shortcut: runtime user 1000:1000 is the official node image USER node, upgrade when that image stops using uid 1000.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import secrets
import selectors
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, TypedDict
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO

ADMITTED_BASE: Final = "fdd37882e3e41db98af8d8ed2e1b0afb03798aca"
ADMITTED_TREE: Final = "24a1abeabbdac053b3516eb0a789efd63bc17233"
ROOT: Final = Path(__file__).resolve().parents[2]


class Rejection(Exception):
    def __init__(self, code: str, detail: str, cleanup: str | None = None) -> None:
        self.code = code
        self.detail = detail
        self.cleanup = cleanup
        message = f"{code}: {detail}"
        if cleanup:
            message += f"; cleanup: {cleanup}"
        super().__init__(message)


def mapping(value: object, code: str = "malformed") -> dict[str, object]:
    if not isinstance(value, dict):
        raise Rejection(code, "object")
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise Rejection(code, "key")
        result[key] = item
    return result


def required_int(raw: dict[str, object], key: str) -> int:
    value = raw.get(key)
    if type(value) is int:
        return value
    raise Rejection("malformed", key)


def required_str(raw: dict[str, object], key: str) -> str:
    value = raw.get(key)
    if isinstance(value, str):
        return value
    raise Rejection("malformed", key)


def text_id(info: dict[str, object]) -> str:
    value = info.get("Id")
    if isinstance(value, str) and value:
        return value
    raise Rejection("docker", "id")


@dataclass(frozen=True, slots=True)
class Limits:
    memory_bytes: int
    memory_swap_bytes: int
    tmpfs_bytes: int
    deny_scratch_bytes: int
    timeout_seconds: int
    output_bytes: int
    pids: int
    cpus: int


@dataclass(frozen=True, slots=True)
class Case:
    base: str
    tree: str
    branch: str
    ref: str
    image_tag: str
    runtime_user: str
    clock: str
    package_manager: str
    backing_sha256: str
    backing_bytes: int
    names: tuple[str, ...]
    logical_bytes: int
    limits: Limits
    sources: tuple[tuple[str, str], ...]


def safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").split("/")[-1] or "vedlegg"
    sanitized = "".join(
        "_" if ord(character) < 32 or ord(character) == 127 or character == '"' else character
        for character in name
    )
    return sanitized[:180] or "vedlegg"


def backing_bytes() -> bytes:
    return b"".join(hashlib.sha256(f"export72-v1:{index}".encode()).digest() for index in range(65536))


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_case(path: Path) -> Case:
    try:
        loaded: object = json.loads(path.read_text())
        raw = mapping(loaded)
    except json.JSONDecodeError as exc:
        raise Rejection("malformed", "case json") from exc
    if raw.get("schema") != "nytt-export72-case-v1":
        raise Rejection("malformed", "schema")
    limits_raw = mapping(raw.get("limits"))
    limits = Limits(
        memory_bytes=required_int(limits_raw, "memoryBytes"),
        memory_swap_bytes=required_int(limits_raw, "memorySwapBytes"),
        tmpfs_bytes=required_int(limits_raw, "tmpfsBytes"),
        deny_scratch_bytes=required_int(limits_raw, "denyScratchBytes"),
        timeout_seconds=required_int(limits_raw, "timeoutSeconds"),
        output_bytes=required_int(limits_raw, "outputBytes"),
        pids=required_int(limits_raw, "pids"),
        cpus=required_int(limits_raw, "cpus"),
    )
    if limits != Limits(536870912, 536870912, 16777216, 17825792, 120, 1048576, 128, 1):
        if limits.tmpfs_bytes != 16777216 or limits.deny_scratch_bytes <= limits.tmpfs_bytes:
            raise Rejection("scratch", "scratch cap is not the admitted 16MiB denial")
        raise Rejection("malformed", "admitted limits")
    backing = raw.get("backing")
    attachments = mapping(raw.get("maxAttachments"))
    name_value = attachments.get("names")
    logical = attachments.get("logicalBytes")
    if not isinstance(backing, dict) or backing.get("bytes") != 2097152:
        raise Rejection("malformed", "backing")
    backing_map = mapping(backing)
    payload = backing_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if backing_map.get("sha256") != digest:
        raise Rejection("digest", "backing digest")
    if len(zlib.compress(payload, 9)) < len(payload):
        raise Rejection("digest", "backing is compressible")
    if not isinstance(name_value, list) or not all(isinstance(name, str) for name in name_value):
        raise Rejection("names", "attachment names")
    names = tuple(name for name in name_value if isinstance(name, str))
    safe = tuple(safe_filename(name) for name in names)
    if len(safe) != 25 or len(set(safe)) != 25 or safe != names:
        raise Rejection("names", "attachment names are unsafe or not unique")
    if type(logical) is not int or logical != 25 * 2097152:
        raise Rejection("logical", "logical size")
    if raw.get("base") != ADMITTED_BASE or raw.get("tree") != ADMITTED_TREE:
        raise Rejection("source", "base")
    sources: list[tuple[str, str]] = []
    source_value = raw.get("sources")
    if not isinstance(source_value, list):
        raise Rejection("malformed", "source pin")
    for item in source_value:
        pin = mapping(item, "source")
        source_path = pin.get("path")
        source_hash = pin.get("sha256")
        if not isinstance(source_path, str) or not isinstance(source_hash, str):
            raise Rejection("malformed", "source pin")
        source = ROOT / source_path
        if not source.is_file() or file_sha256(source) != source_hash:
            raise Rejection("source", source_path)
        sources.append((source_path, source_hash))
    package = mapping(json.loads((ROOT / "package.json").read_text()))
    if package.get("packageManager") != raw.get("packageManager"):
        raise Rejection("source", "packageManager")
    if required_str(raw, "runtimeUser") != "1000:1000" or required_str(raw, "imageTag") != "nytt-trondheim-api:test":
        raise Rejection("malformed", "runtime target")
    return Case(
        base=required_str(raw, "base"),
        tree=required_str(raw, "tree"),
        branch=required_str(raw, "branch"),
        ref=required_str(raw, "ref"),
        image_tag=required_str(raw, "imageTag"),
        runtime_user=required_str(raw, "runtimeUser"),
        clock=required_str(raw, "clock"),
        package_manager=required_str(raw, "packageManager"),
        backing_sha256=digest,
        backing_bytes=2097152,
        names=names,
        logical_bytes=logical,
        limits=limits,
        sources=tuple(sources),
    )


def create_argv(case: Case, *, name: str, label: str, image_id: str, probe_dir: Path) -> list[str]:
    return [
        "docker", "create", "--interactive", "--pull", "never", "--name", name,
        "--label", f"portfolio.run={label}", "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--memory", str(case.limits.memory_bytes), "--memory-swap", str(case.limits.memory_swap_bytes),
        "--pids-limit", str(case.limits.pids), "--cpus", str(case.limits.cpus),
        "--ipc", "none", "--no-healthcheck", "--log-driver", "none", "--user", case.runtime_user,
        "--tmpfs", f"/tmp:rw,nosuid,nodev,noexec,size={case.limits.tmpfs_bytes},mode=1777",
        "--mount", f"type=bind,src={probe_dir},dst=/perf,readonly",
        "--entrypoint", "node", image_id, "/perf/export72-probe.mjs", "--qualify", "--case",
        "/perf/export72-case.json",
    ]


def admit_host_config(info: dict[str, object], *, image_id: str, user: str, probe_dir: str) -> None:
    host = mapping(info.get("HostConfig"))
    config = mapping(info.get("Config"))
    if host.get("NetworkMode") != "none":
        raise Rejection("namespace", "network is not none")
    if host.get("Memory") != 536870912 or host.get("MemorySwap") != 536870912:
        raise Rejection("limits", "memory")
    if host.get("PidsLimit") != 128 or host.get("NanoCpus") != 1_000_000_000:
        raise Rejection("limits", "pids or cpu")
    if host.get("IpcMode") != "none" or host.get("ReadonlyRootfs") is not True or host.get("Privileged") is not False:
        raise Rejection("limits", "isolation")
    caps = host.get("CapDrop")
    if not isinstance(caps, list) or "ALL" not in caps:
        raise Rejection("limits", "capabilities")
    security = host.get("SecurityOpt")
    if not isinstance(security, list) or not any(isinstance(item, str) and "no-new-privileges" in item for item in security):
        raise Rejection("limits", "privileges")
    log_config = mapping(host.get("LogConfig")) if host.get("LogConfig") is not None else {}
    if log_config.get("Type") != "none" or host.get("PortBindings"):
        raise Rejection("limits", "logging or ports")
    tmpfs_map = mapping(host.get("Tmpfs")) if host.get("Tmpfs") is not None else {}
    if set(tmpfs_map) != {"/tmp"}:
        raise Rejection("scratch", "tmpfs")
    parse_tmpfs(tmpfs_map.get("/tmp"))
    if config.get("User") != user or info.get("Image") != image_id:
        raise Rejection("image", "user or image")
    health = mapping(config.get("Healthcheck")) if config.get("Healthcheck") is not None else {}
    if health.get("Test") != ["NONE"]:
        raise Rejection("limits", "healthcheck")
    mount_value = info.get("Mounts")
    if not isinstance(mount_value, list):
        raise Rejection("source", "mount allowlist")
    admit_mount_list([mapping(item) for item in mount_value], probe_dir)
    binds = host.get("Binds") if host.get("Binds") is not None else []
    if not isinstance(binds, list) or any(not isinstance(item, str) or item != f"{probe_dir}:/perf:ro" for item in binds):
        raise Rejection("source", "mount allowlist")
    host_mounts = host.get("Mounts")
    if host_mounts is not None:
        if not isinstance(host_mounts, list):
            raise Rejection("source", "mount allowlist")
        admit_mount_list([mapping(item) for item in host_mounts], probe_dir, requested=True)


ADMITTED_TMPFS: Final = {
    "rw": None,
    "nosuid": None,
    "nodev": None,
    "noexec": None,
    "size": "16777216",
    "mode": "1777",
}


def parse_tmpfs(options: object) -> None:
    if not isinstance(options, str) or not options:
        raise Rejection("scratch", "tmpfs")
    seen: dict[str, str | None] = {}
    for part in options.split(","):
        if not part or "=" in part[:-1] and part.endswith("="):
            raise Rejection("scratch", "tmpfs")
        key, value = part.split("=", 1) if "=" in part else (part, None)
        if key not in ADMITTED_TMPFS or key in seen or ADMITTED_TMPFS[key] != value:
            raise Rejection("scratch", "tmpfs")
        seen[key] = value
    if set(seen) != set(ADMITTED_TMPFS):
        raise Rejection("scratch", "tmpfs")


def admit_mount_list(mounts: list[dict[str, object]], probe_dir: str, *, requested: bool = False) -> None:
    # Docker request mounts use Target/ReadOnly; inspect mountpoints use Destination/RW.
    saw_probe = False
    for item in mounts:
        source = item.get("Source")
        if isinstance(source, str) and (source.endswith(".sock") or ".git" in source.split("/")):
            raise Rejection("source", "forbidden mount")
        if requested:
            if "Destination" in item or "RW" in item:
                raise Rejection("source", "malformed mount")
            destination = item.get("Target")
            readonly = item.get("ReadOnly") is True
        else:
            if "Target" in item or "ReadOnly" in item:
                raise Rejection("source", "malformed mount")
            destination = item.get("Destination")
            readonly = item.get("RW") is False
        if destination == "/perf":
            if saw_probe or item.get("Type") != "bind" or not readonly or source != probe_dir:
                raise Rejection("source", "probe mount")
            saw_probe = True
            continue
        if destination == "/tmp" and item.get("Type") == "tmpfs":
            continue
        raise Rejection("source", "mount allowlist")
    if not saw_probe:
        raise Rejection("source", "probe mount")


def proc_identity(pid: int) -> tuple[str, int]:
    text = Path(f"/proc/{pid}/stat").read_text()
    comm = text[text.find("(") + 1:text.rfind(")")]
    fields = text[text.rfind(")") + 2:].split()
    return comm, int(fields[1])


def assert_quiet(before: tuple[int, int, int], after: tuple[int, int, int]) -> None:
    if before != after:
        raise Rejection("namespace", f"canary counters moved {before} -> {after}")


class Canary:
    def __init__(self) -> None:
        self._hits = {"tcp": 0, "udp": 0, "dns": 0}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._tcp.bind(("0.0.0.0", 0))
        self._tcp.listen(16)
        self._tcp.settimeout(0.2)
        self._udp = self._bind_udp()
        self._dns = self._bind_udp()
        self._threads = [
            threading.Thread(target=self._accept, daemon=True),
            threading.Thread(target=self._recv, args=(self._udp, "udp"), daemon=True),
            threading.Thread(target=self._recv, args=(self._dns, "dns"), daemon=True),
        ]
        for thread in self._threads:
            thread.start()

    def _bind_udp(self) -> socket.socket:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("0.0.0.0", 0))
        sock.settimeout(0.2)
        return sock

    def _accept(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _addr = self._tcp.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            with self._lock:
                self._hits["tcp"] += 1
            conn.close()

    def _recv(self, sock: socket.socket, key: str) -> None:
        while not self._stop.is_set():
            try:
                sock.recvfrom(2048)
            except TimeoutError:
                continue
            except OSError:
                return
            with self._lock:
                self._hits[key] += 1

    def snapshot(self) -> tuple[int, int, int]:
        with self._lock:
            return self._hits["tcp"], self._hits["udp"], self._hits["dns"]

    def ports(self) -> dict[str, int]:
        return {
            "tcp": self._tcp.getsockname()[1],
            "udp": self._udp.getsockname()[1],
            "dns": self._dns.getsockname()[1],
        }

    def positive(self) -> None:
        port = self.ports()
        with socket.create_connection(("127.0.0.1", port["tcp"]), timeout=2):
            pass
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.sendto(b"export72", ("127.0.0.1", port["udp"]))
            sock.sendto(b"export72", ("127.0.0.1", port["dns"]))
        finally:
            sock.close()
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if all(count > 0 for count in self.snapshot()):
                return
            time.sleep(0.02)
        raise Rejection("canary", "host positive control missed a socket")

    def close(self) -> None:
        self._stop.set()
        for sock in (self._tcp, self._udp, self._dns):
            try:
                sock.close()
            except OSError:
                pass
        for thread in self._threads:
            thread.join(timeout=1)
        if any(thread.is_alive() for thread in self._threads):
            raise Rejection("teardown", "canary thread remains")



def parse_lines(snapshot: bytes) -> list[dict[str, object]]:
    lines = [line for line in snapshot.split(b"\n") if line.strip()]
    if snapshot and not snapshot.endswith(b"\n"):
        lines = lines[:-1]
    try:
        parsed: list[dict[str, object]] = []
        for line in lines:
            parsed.append(mapping(json.loads(line), "protocol"))
        return parsed
    except json.JSONDecodeError as exc:
        raise Rejection("protocol", "non-json output") from exc


class TraceFacts(TypedDict, total=False):
    id: str
    label: str
    uid: int
    gid: int
    pid: int
    workSeconds: int
    totalSeconds: int
    requestedMounts: list[dict[str, object]]
    effectiveMounts: list[dict[str, object]]
    hostConfig: dict[str, object]
    state: dict[str, object]
    failed: bool
    canaryClosed: bool
    stageRemoved: bool


class Budget:
    def __init__(self, deadline: float, cap: int, *, cleanup_seconds: float = 0) -> None:
        self.total_deadline = deadline
        self.deadline = deadline - cleanup_seconds
        self.total_cap = cap
        # Reserve teardown output inside the original cap, sharing the same counter.
        self.cap = cap - 131072 if cleanup_seconds else cap
        self.used = 0
        self._lock = threading.Lock()

    def begin_cleanup(self) -> None:
        self.deadline = self.total_deadline
        self.cap = self.total_cap

    def trace(self, stage: str, *, id: str | None = None, label: str | None = None,
              uid: int | None = None, gid: int | None = None, pid: int | None = None,
              workSeconds: int | None = None, totalSeconds: int | None = None,
              requestedMounts: list[dict[str, object]] | None = None,
              effectiveMounts: list[dict[str, object]] | None = None,
              hostConfig: dict[str, object] | None = None,
              state: dict[str, object] | None = None,
              failed: bool | None = None, canaryClosed: bool | None = None,
              stageRemoved: bool | None = None) -> None:
        facts = {key: value for key, value in {
            "id": id, "label": label, "uid": uid, "gid": gid, "pid": pid,
            "workSeconds": workSeconds, "totalSeconds": totalSeconds,
            "requestedMounts": requestedMounts, "effectiveMounts": effectiveMounts,
            "hostConfig": hostConfig, "state": state,
            "failed": failed, "canaryClosed": canaryClosed, "stageRemoved": stageRemoved,
        }.items() if value is not None}
        line = (json.dumps({"kind": "TRACE", "stage": stage, **facts}, sort_keys=True) + "\n").encode()
        if len(line) > 4096:
            line = (json.dumps({"kind": "TRACE", "stage": stage, "factsTruncated": True}) + "\n").encode()
        if not self.claim(len(line)):
            try:
                sys.stderr.write(line.decode())
                sys.stderr.flush()
            except OSError:
                # Diagnostic output must not interrupt resource cleanup.
                pass

    def expired(self) -> bool:
        return time.monotonic() >= self.deadline

    def remaining(self) -> float:
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise Rejection("timeout", "unit exceeded timeout")
        return left

    def claim(self, size: int) -> bool:
        with self._lock:
            if size > self.cap - self.used:
                return True
            self.used += size
            return False


def run_bounded(argv: list[str], budget: Budget) -> subprocess.CompletedProcess[bytes]:
    budget.remaining()
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    output = [bytearray(), bytearray()]
    failure: Rejection | None = None
    try:
        with selectors.DefaultSelector() as selector:
            for index, stream in enumerate((proc.stdout, proc.stderr)):
                assert stream is not None
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, index)
            while selector.get_map():
                remaining = min(budget.remaining(), budget.total_deadline - time.monotonic() - 0.05)
                if remaining <= 0:
                    raise Rejection("timeout", "unit exceeded timeout")
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fd, 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    elif budget.claim(len(chunk)):
                        raise Rejection("output", "stdout plus stderr exceeded cap")
                    else:
                        output[key.data].extend(chunk)
            proc.wait(timeout=budget.remaining())
    except Rejection as exc:
        failure = exc
    except subprocess.TimeoutExpired:
        failure = Rejection("timeout", "unit exceeded timeout")
    finally:
        # The unreaped child anchors the session ID, including inherited pipe holders.
        if failure is not None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=max(0, budget.total_deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                failure.cleanup = "owned cli did not reap within total deadline"
                failure = Rejection(failure.code, failure.detail, failure.cleanup)
        for stream in (proc.stdout, proc.stderr):
            if stream is not None:
                stream.close()
    if failure is not None:
        raise failure
    return subprocess.CompletedProcess(argv, proc.returncode, bytes(output[0]), bytes(output[1]))


def reap(proc: subprocess.Popen[bytes]) -> str | None:
    if proc.poll() is not None:
        return None
    proc.kill()
    try:
        proc.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        return "owned cli remains"
    return None


def prove_absent(code: int, stderr: str, daemon_reachable: bool, container_id: str) -> None:
    if code == 0:
        raise Rejection("teardown", "owned container is still present")
    exact = {
        f"Error: No such object: {container_id}",
        f"Error response from daemon: No such object: {container_id}",
        f"docker: error: no such object: {container_id}",
    }
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    if len(lines) != 1 or lines[0] not in exact:
        raise Rejection("docker", (stderr.strip() or "inspect failed")[-400:])
    if not daemon_reachable:
        raise Rejection("docker", "daemon unreachable while proving absence")


def require_owned_label(labels: dict[str, object], label: str) -> None:
    if labels.get("portfolio.run") != label:
        raise Rejection("teardown", "refusing to remove a container without the owned label")


def assert_terminal(state: Mapping[str, object], *, descendants: int, handles: int) -> None:
    if state.get("Status") not in {"exited", "dead"}:
        raise Rejection("teardown", "container is not stopped")
    if state.get("ExitCode") != 0:
        raise Rejection("exit", f"exit {state.get('ExitCode')}")
    if state.get("OOMKilled") is not False:
        raise Rejection("limits", "oom")
    if state.get("Pid") != 0:
        raise Rejection("pid", "container pid still present")
    if type(descendants) is not int or descendants != 0:
        raise Rejection("teardown", "owned descendants remain")
    if type(handles) is not int or handles != 0:
        raise Rejection("teardown", "owned handles remain")


def count_descendants(pid: int, proc_root: Path) -> int:
    if pid <= 0:
        return 0
    if not proc_root.is_dir():
        raise Rejection("teardown", "cannot prove descendants")
    total = 0
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            text = (entry / "stat").read_text()
        except OSError:
            continue
        fields = text[text.rfind(")") + 2:].split()
        if len(fields) > 1 and int(fields[1]) == pid:
            total += 1
    return total


def count_handles(pid: int, proc_root: Path) -> int:
    if pid <= 0:
        return 0
    if not proc_root.is_dir():
        raise Rejection("teardown", "cannot prove handles")
    fd_dir = proc_root / str(pid) / "fd"
    if not fd_dir.exists():
        return 0
    return sum(1 for _ in fd_dir.iterdir())


def delete_owned(exact_id: str, budget: Budget) -> None:
    completed = run_bounded(["docker", "rm", "-f", exact_id], budget)
    if completed.returncode != 0:
        raise Rejection("teardown", completed.stderr.decode()[-300:])
    gone = run_bounded(["docker", "inspect", exact_id], budget)
    version = run_bounded(["docker", "version", "--format", "{{.Server.APIVersion}}"], budget)
    reachable = version.returncode == 0 and bool(version.stdout.decode().strip())
    prove_absent(gone.returncode, gone.stderr.decode(), reachable, exact_id)


def cleanup_owned(container_id: str, label: str, budget: Budget) -> None:
    info = docker_json(["docker", "inspect", container_id], budget)[0]
    config = mapping(info.get("Config"), "teardown")
    labels = mapping(config.get("Labels"), "teardown") if config.get("Labels") is not None else {}
    require_owned_label(labels, label)
    exact_id = text_id(info)
    budget.trace("cleanup-owned", id=exact_id, label=label)
    stopped = run_bounded(["docker", "stop", "--time", "1", exact_id], budget)
    if stopped.returncode != 0:
        raise Rejection("teardown", "owned stop failed")
    terminal = docker_json(["docker", "inspect", exact_id], budget)[0]
    require_owned_label(mapping(mapping(terminal.get("Config")).get("Labels")), label)
    state = mapping(terminal.get("State"), "teardown")
    budget.trace("cleanup-stopped", id=exact_id, label=label, state={key: state.get(key) for key in ("Status", "ExitCode", "OOMKilled", "Pid")})
    if text_id(terminal) != exact_id or state.get("Status") not in {"exited", "dead"} or state.get("Pid") != 0:
        raise Rejection("teardown", "owned container did not stop")
    delete_owned(exact_id, budget)
    budget.trace("cleanup-absent", id=exact_id, label=label)


def assert_canary_closed(canary: Canary) -> None:
    if any(thread.is_alive() for thread in canary._threads):
        raise Rejection("teardown", "canary thread remains")
    if any(sock.fileno() != -1 for sock in (canary._tcp, canary._udp, canary._dns)):
        raise Rejection("teardown", "canary socket remains")


def release_owned(owned: Path, remove: Callable[[Path], None] | None = None) -> None:
    deleter = shutil.rmtree if remove is None else remove
    try:
        deleter(owned)
    except Rejection:
        raise
    except Exception as exc:
        raise Rejection("teardown", f"owned temp removal failed: {exc}") from exc
    if owned.exists():
        raise Rejection("teardown", "owned temp remains")


def retain_receipt(
    receipt: Mapping[str, object],
    *,
    image_id: str,
    probe_sha: str,
    case_sha: str,
    package_name: str,
    canary_before: tuple[int, int, int],
    canary_after: tuple[int, int, int],
    stopped: Mapping[str, object],
) -> dict[str, object]:
    if not image_id.startswith("sha256:"):
        raise Rejection("image", "image identity")
    identity = mapping(receipt.get("identity"), "identity")
    kept = {
        "node": identity.get("node"),
        "arch": identity.get("arch"),
        "platform": identity.get("platform"),
        "packageName": identity.get("packageName"),
        "probe": identity.get("probe"),
        "case": identity.get("case"),
        "exportSha256": identity.get("exportSha256"),
        "storeSha256": identity.get("storeSha256"),
    }
    for key, value in kept.items():
        if not isinstance(value, str) or not value:
            raise Rejection("identity", key)
    if not str(kept["node"]).startswith("v") or kept["probe"] != probe_sha or kept["case"] != case_sha or kept["packageName"] != package_name:
        raise Rejection("identity", "false identity")
    witness = mapping(receipt.get("witness"), "identity")
    files = witness.get("files")
    if not isinstance(files, list):
        raise Rejection("identity", "witness")
    total = 0
    derived = False
    for item in files:
        entry = mapping(item, "identity")
        name = entry.get("name")
        kind = entry.get("type")
        size = entry.get("size")
        if not isinstance(name, str) or kind not in {"file", "dir", "other"} or type(size) is not int or size < 0:
            raise Rejection("identity", "witness")
        if kind == "file":
            total += size
            if name.lower().endswith(".zip"):
                derived = True
    if witness.get("total") != total or witness.get("persistedZip") is not derived or receipt.get("persistedZip") is not derived:
        raise Rejection("identity", "persisted zip not from witness")
    if derived or total > 16777216:
        raise Rejection("oracle", "persisted zip")
    return {
        "kind": "QUALIFIED",
        "image": image_id,
        "identity": {**{key: value for key, value in kept.items() if isinstance(value, str)}, "image": image_id},
        "witness": {"files": files, "total": total, "persistedZip": derived},
        "canaryBefore": canary_before,
        "canaryAfter": canary_after,
        "stopped": stopped,
        "logicalBytes": receipt.get("logicalBytes"),
        "fixtures": receipt.get("fixtures"),
        "hwmBytes": receipt.get("hwmBytes"),
        "persistedZip": derived,
        "network": receipt.get("network"),
    }


def dialog(
    argv: list[str],
    *,
    nonce: str,
    on_ready: Callable[[dict[str, object]], dict[str, object]],
    budget: Budget | None = None,
    timeout_s: float | None = None,
    output_cap: int | None = None,
    diagnostic: bool = False,
) -> dict[str, object]:
    if budget is None:
        if timeout_s is None or output_cap is None:
            raise Rejection("malformed", "missing budget")
        budget = Budget(time.monotonic() + timeout_s, output_cap)
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = bytearray()
    err = bytearray()
    lock = threading.Lock()
    overflow = threading.Event()

    def pump(pipe, dest: bytearray) -> None:
        try:
            while True:
                chunk = pipe.read1(65536)
                if not chunk:
                    break
                if budget.claim(len(chunk)):
                    overflow.set()
                    break
                with lock:
                    dest.extend(chunk)
        finally:
            pipe.close()

    threads = [
        threading.Thread(target=pump, args=(proc.stdout, out), daemon=True),
        threading.Thread(target=pump, args=(proc.stderr, err), daemon=True),
    ]
    for thread in threads:
        thread.start()
    released = False
    qualified: dict[str, object] | None = None
    traced = 0

    def trace_events(events: list[dict[str, object]]) -> None:
        nonlocal traced
        if diagnostic:
            for event in events[traced:]:
                kind = event.get("kind")
                if kind in {"READY", "QUALIFIED"}:
                    identity: TraceFacts = {}
                    for key in ("uid", "gid", "pid"):
                        value = event.get(key)
                        if type(value) is int:
                            if key == "uid":
                                identity["uid"] = value
                            elif key == "gid":
                                identity["gid"] = value
                            else:
                                identity["pid"] = value
                    budget.trace("probe-" + str(kind), uid=identity.get("uid"), gid=identity.get("gid"), pid=identity.get("pid"))
                if kind == "TRACE" and event.get("stage") in {"release", "kernel", "imports", "fixture-empty", "fixture-small", "fixture-max", "witness", "complete"}:
                    budget.trace("probe-" + str(event["stage"]))
            traced = len(events)
    try:
        while True:
            if budget.expired():
                raise Rejection("timeout", "unit exceeded timeout")
            if overflow.is_set():
                raise Rejection("output", "stdout plus stderr exceeded cap")
            with lock:
                snapshot = bytes(out)
            parsed = parse_lines(snapshot)
            trace_events(parsed)
            if any(item.get("kind") == "QUALIFIED" for item in parsed) and not released:
                raise Rejection("premature", "success before release")
            for item in parsed:
                if item.get("kind") == "QUALIFIED":
                    qualified = item
            ready = next((item for item in parsed if item.get("kind") == "READY"), None)
            if ready is not None and not released:
                extra = on_ready(ready)
                if proc.stdin is None:
                    raise Rejection("protocol", "stdin closed")
                proc.stdin.write((json.dumps({"kind": "RELEASE", "nonce": nonce, **extra}) + "\n").encode())
                proc.stdin.flush()
                # RELEASE is a single message; EOF lets the real Node pipe terminate.
                proc.stdin.close()
                released = True
            if proc.poll() is not None:
                time.sleep(0.05)
                with lock:
                    qualified_now = parse_lines(bytes(out))
                trace_events(qualified_now)
                if any(item.get("kind") == "QUALIFIED" for item in qualified_now) and not released:
                    raise Rejection("premature", "success before release")
                for item in qualified_now:
                    if item.get("kind") == "QUALIFIED":
                        qualified = item
                break
            time.sleep(0.02)
        try:
            code = proc.wait(timeout=budget.remaining())
        except subprocess.TimeoutExpired as exc:
            raise Rejection("timeout", "unit exceeded timeout") from exc
        if qualified is not None and code != 0:
            raise Rejection("premature", "qualified receipt then non-zero exit")
        if code != 0:
            detail = f"exit {code}"
            for item in qualified_now:
                error = item.get("error")
                if item.get("kind") == "FAILED" and isinstance(error, str) and error:
                    # Escape terminal controls and charge the rendered diagnostic to the shared cap.
                    safe = json.dumps(error[:512], ensure_ascii=True)
                    failure = f"{detail}; probe FAILED error={safe}"
                    if not budget.claim(len(f"FAIL exit: {failure}\n".encode())):
                        detail = failure
                    break
            raise Rejection("exit", detail)
        if qualified is None:
            raise Rejection("protocol", "missing qualified receipt")
        if qualified.get("nonce") != nonce:
            raise Rejection("nonce", "receipt nonce mismatch")
        return qualified
    finally:
        if proc.stdin is not None and not proc.stdin.closed:
            proc.stdin.close()
        cleanup = reap(proc)
        if cleanup:
            current = sys.exc_info()[1]
            if isinstance(current, Rejection):
                raise Rejection(current.code, current.detail, cleanup=cleanup) from current
            raise Rejection("teardown", cleanup)


def docker_json(argv: list[str], budget: Budget) -> list[dict[str, object]]:
    completed = run_bounded(argv, budget)
    if completed.returncode != 0:
        raise Rejection("docker", completed.stderr.decode()[-400:])
    loaded: object = json.loads(completed.stdout)
    if not isinstance(loaded, list):
        raise Rejection("docker", "inspect was not a list")
    return [mapping(item, "docker") for item in loaded]


def outbound_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 9))
        address = sock.getsockname()[0]
    finally:
        sock.close()
    if address.startswith("127."):
        raise Rejection("namespace", "host address is loopback")
    return address


def remove_exact(container_id: str, label: str, budget: Budget, *, descendants: int, handles: int) -> dict[str, object]:
    info = docker_json(["docker", "inspect", container_id], budget)[0]
    config = mapping(info.get("Config"), "teardown")
    labels = mapping(config.get("Labels"), "teardown") if config.get("Labels") is not None else {}
    require_owned_label(labels, label)
    state = mapping(info.get("State"), "teardown")
    exact_id = text_id(info)
    assert_terminal(state, descendants=descendants, handles=handles)
    stopped: dict[str, object] = {
        "id": exact_id,
        "status": state.get("Status"),
        "exitCode": state.get("ExitCode"),
        "oom": state.get("OOMKilled"),
        "pid": state.get("Pid"),
        "descendants": descendants,
        "handles": handles,
    }
    delete_owned(exact_id, budget)
    return stopped


def qualify(case_path: Path) -> None:
    case = parse_case(case_path)
    probe = ROOT / "scripts/perf/export72-probe.mjs"
    raw_case = mapping(json.loads(case_path.read_text()))
    package_name = required_str(mapping(raw_case.get("module"), "malformed"), "serverPackage")
    budget = Budget(time.monotonic() + case.limits.timeout_seconds, case.limits.output_bytes, cleanup_seconds=10)
    budget.trace("image-inspect", workSeconds=110, totalSeconds=120)
    image = docker_json(["docker", "image", "inspect", case.image_tag], budget)[0]
    image_id = text_id(image)
    label = secrets.token_hex(8)
    nonce = secrets.token_hex(16)
    host = outbound_ip()
    owned = stage_probe(probe, case_path)
    canary = Canary()
    container_id = ""
    observed_pid = 0
    primary: Rejection | None = None
    payload: dict[str, object] | None = None
    try:
        budget.trace("canary-positive")
        probe_sha = file_sha256(owned / "export72-probe.mjs")
        case_sha = file_sha256(owned / "export72-case.json")
        canary.positive()
        before = canary.snapshot()
        argv = create_argv(case, name=f"export72-{label}", label=label, image_id=image_id, probe_dir=owned)
        if any(" " in item for item in argv[1:]):
            raise Rejection("malformed", "docker argv contains a joined flag")
        created = run_bounded(argv, budget)
        if created.returncode != 0:
            raise Rejection("docker", created.stderr.decode()[-400:])
        container_id = created.stdout.decode().strip()
        budget.trace("created", id=container_id, label=label)
        info = docker_json(["docker", "inspect", container_id], budget)[0]
        config = mapping(info.get("HostConfig"))
        mount_facts: TraceFacts = {}
        for key, value, fields in (
            ("requestedMounts", config.get("Mounts"), ("Type", "Target", "ReadOnly")),
            ("effectiveMounts", info.get("Mounts"), ("Type", "Destination", "RW")),
        ):
            if isinstance(value, list):
                projected: list[dict[str, object]] = []
                for item in value[:4]:
                    mount = mapping(item)
                    record = {field: mount.get(field) for field in fields}
                    for destination in ("Target", "Destination"):
                        if destination in record and record[destination] not in {"/perf", "/tmp"}:
                            record[destination] = "<other>"
                    record["sourceMatchesOwned"] = mount.get("Source") == str(owned)
                    projected.append(record)
                mount_facts[key] = projected
        mount_facts["hostConfig"] = {key: config.get(key) for key in ("Memory", "MemorySwap", "PidsLimit", "NanoCpus", "NetworkMode", "IpcMode", "ReadonlyRootfs", "Privileged", "CapDrop", "SecurityOpt", "Tmpfs")}
        budget.trace("admission", requestedMounts=mount_facts.get("requestedMounts"), effectiveMounts=mount_facts.get("effectiveMounts"), hostConfig=mount_facts.get("hostConfig"))
        admit_host_config(info, image_id=image_id, user=case.runtime_user, probe_dir=str(owned))

        def on_ready(ready: dict[str, object]) -> dict[str, object]:
            nonlocal observed_pid
            if ready.get("uid") != 1000 or ready.get("gid") != 1000:
                raise Rejection("user", "container is not the admitted non-root user")
            if ready.get("probe") != probe_sha or ready.get("case") != case_sha:
                raise Rejection("source", "mounted source hash")
            current = docker_json(["docker", "inspect", container_id], budget)[0]
            state = mapping(current.get("State"), "pid")
            pid_value = state.get("Pid")
            if type(pid_value) is not int:
                raise Rejection("pid", "missing host pid")
            pid = pid_value
            observed_pid = pid
            budget.trace("host-pid", pid=pid)
            if pid <= 0 or os.getpgid(pid) <= 0:
                raise Rejection("pid", "missing host pid")
            comm, ppid = proc_identity(pid)
            if comm != "node" or ppid <= 0:
                raise Rejection("pid", "unexpected process identity")
            if current["Image"] != image_id:
                raise Rejection("image", "image changed before release")
            return {"host": host, "ports": canary.ports()}

        receipt = dialog(
            ["docker", "start", "-a", "-i", container_id],
            nonce=nonce,
            budget=budget,
            on_ready=on_ready,
            diagnostic=True,
        )
        after = canary.snapshot()
        assert_quiet(before, after)
        descendants = count_descendants(observed_pid, Path("/proc"))
        handles = count_handles(observed_pid, Path("/proc"))
        budget.begin_cleanup()
        budget.trace("terminal-cleanup", id=container_id, label=label)
        stopped = remove_exact(container_id, label, budget, descendants=descendants, handles=handles)
        budget.trace("terminal-absent", state=stopped)
        container_id = ""
        again = text_id(docker_json(["docker", "image", "inspect", image_id], budget)[0])
        if again != image_id:
            raise Rejection("image", "image hash changed")
        canary.close()
        assert_canary_closed(canary)
        release_owned(owned)
        payload = retain_receipt(
            receipt,
            image_id=image_id,
            probe_sha=probe_sha,
            case_sha=case_sha,
            package_name=package_name,
            canary_before=before,
            canary_after=after,
            stopped=stopped,
        )
    except Rejection as exc:
        primary = exc
    except Exception as exc:
        primary = Rejection("docker", str(exc))
    cleanup_errors: list[str] = []
    budget.begin_cleanup()
    budget.trace("cleanup", failed=primary is not None)
    if any(thread.is_alive() for thread in canary._threads) or any(sock.fileno() != -1 for sock in (canary._tcp, canary._udp, canary._dns)):
        try:
            canary.close()
            assert_canary_closed(canary)
            budget.trace("canary-closed")
        except (Rejection, OSError) as exc:
            cleanup_errors.append(str(exc))
    if container_id:
        try:
            cleanup_owned(container_id, label, budget)
        except Rejection as exc:
            cleanup_errors.append(f"{exc.code}: {exc.detail}")
    if owned.exists():
        try:
            release_owned(owned)
        except Rejection as exc:
            cleanup_errors.append(exc.detail)
    cleanup = "; ".join(item for item in cleanup_errors if item)
    budget.trace("finished", failed=primary is not None or bool(cleanup), canaryClosed=not any(thread.is_alive() for thread in canary._threads), stageRemoved=not owned.exists())
    if primary is not None:
        raise Rejection(primary.code, primary.detail, cleanup=cleanup or None)
    if cleanup:
        raise Rejection("teardown", "cleanup failed", cleanup=cleanup)
    if payload is None:
        raise Rejection("protocol", "missing qualified receipt")
    budget.remaining()
    if budget.used > budget.cap:
        raise Rejection("output", "stdout plus stderr exceeded cap")
    serialized = json.dumps(payload, sort_keys=True) + "\n"
    if budget.claim(len(serialized.encode())):
        raise Rejection("output", "stdout plus stderr exceeded cap")
    sys.stdout.write(serialized)


def sample_host() -> dict[str, object]:
    return {
        "Image": "sha256:abc",
        "Id": "container",
        "HostConfig": {
            "Memory": 536870912,
            "MemorySwap": 536870912,
            "PidsLimit": 128,
            "NanoCpus": 1000000000,
            "IpcMode": "none",
            "ReadonlyRootfs": True,
            "Privileged": False,
            "NetworkMode": "none",
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges:true"],
            "LogConfig": {"Type": "none"},
            "PortBindings": {},
            "Tmpfs": {"/tmp": "rw,nosuid,nodev,noexec,size=16777216,mode=1777"},
        },
        "Config": {"User": "1000:1000", "Healthcheck": {"Test": ["NONE"]}},
        "Mounts": [{"Type": "bind", "Source": "/owned", "Destination": "/perf", "RW": False}],
    }


def native_mount_host() -> dict[str, object]:
    host = sample_host()
    host["Mounts"] = [{
        "Type": "bind",
        "Source": "/owned",
        "Destination": "/perf",
        "Mode": "",
        "RW": False,
        "Propagation": "rprivate",
    }]
    host_config = mapping(host.get("HostConfig"))
    host_config["Binds"] = None
    host_config["Mounts"] = [{"Type": "bind", "Source": "/owned", "Target": "/perf", "ReadOnly": True}]
    host["HostConfig"] = host_config
    return host


def expect(code: str, fn) -> None:
    try:
        fn()
    except Rejection as exc:
        if exc.code != code:
            raise Rejection("self-check", f"expected {code} got {exc.code}: {exc.detail}") from exc
        print(f"PASS reject {code}: {exc.detail}", flush=True)
        return
    raise Rejection("self-check", f"accepted bad input for {code}")


def child(code: str) -> list[str]:
    return [sys.executable, "-c", code]


def check_failure_diagnostics() -> None:
    """Run actual failing children; diagnostics must preserve rejection and budgets."""
    cases = [
        ("actual-error", {"kind": "FAILED", "error": "native max fixture sentinel"}, "native max fixture sentinel"),
        ("large-error", {"kind": "FAILED", "error": "x" * 20000}, "x" * 512),
        ("controls", {"kind": "FAILED", "error": "bad\n\r\t\x00\x1b\x7f\u0085\u202e"}, "bad\n\r\t\x00\x1b\x7f\u0085\u202e"),
        ("malformed-error", {"kind": "FAILED", "error": {"secret": "not a string"}}, None),
        ("missing-error", {"kind": "FAILED"}, None),
        ("empty-error", {"kind": "FAILED", "error": ""}, None),
        ("foreign-kind", {"kind": "OTHER", "error": "untrusted"}, None),
        ("missing-failed", {"kind": "TRACE", "stage": "fixture-max"}, None),
    ]
    for name, frame, wanted in cases:
        wire = (json.dumps(frame) + "\n").encode()
        script = f"import sys; sys.stdout.buffer.write({wire!r}); sys.stdout.flush(); sys.exit(1)"
        budget = Budget(time.monotonic() + 2, 1048576, cleanup_seconds=0.5)
        try:
            dialog(child(script), nonce="test", budget=budget, on_ready=lambda _ready: {})
        except Rejection as exc:
            if exc.code != "exit" or not exc.detail.startswith("exit 1"):
                raise Rejection("self-check", f"changed rejection for {name}: {exc}") from exc
            if wanted is not None:
                safe = json.dumps(wanted, ensure_ascii=True)
                if safe not in exc.detail:
                    raise Rejection("self-check", f"child failure detail lost for {name}: {exc}") from exc
                if len(exc.detail) > 3200 or any(ord(c) < 32 or ord(c) >= 127 for c in exc.detail):
                    raise Rejection("self-check", f"unsafe failure detail for {name}")
                if budget.used != len(wire) + len(f"FAIL {exc}\n".encode()):
                    raise Rejection("self-check", "failure diagnostic not charged to shared budget")
            elif exc.detail != "exit 1" or budget.used != len(wire):
                raise Rejection("self-check", f"unvalidated failure detail for {name}")
            print(f"PASS failure diagnostic {name}: {exc}", flush=True)
        else:
            raise Rejection("self-check", f"accepted failed child for {name}")
    wire = b'{"kind":"FAILED","error":"no diagnostic allowance"}\n'
    tight = Budget(time.monotonic() + 2, len(wire))
    expect("exit", lambda: dialog(child(f"import sys; sys.stdout.buffer.write({wire!r}); sys.exit(1)"),
                                   nonce="test", budget=tight, on_ready=lambda _ready: {}))
    if tight.used != len(wire):
        raise Rejection("self-check", "diagnostic exceeded shared cap")
    print("PASS failure diagnostic exhausted shared budget", flush=True)
    expect("protocol", lambda: dialog(child("print('{broken',flush=True); raise SystemExit(1)"),
                                       nonce="test", timeout_s=2, output_cap=1048576, on_ready=lambda _ready: {}))
    expect("output", lambda: dialog(child("import json,sys; print(json.dumps({'kind':'FAILED','error':'x'*2097152}),flush=True); sys.exit(1)"),
                                     nonce="test", timeout_s=2, output_cap=1048576, on_ready=lambda _ready: {}))
    expect("timeout", lambda: dialog(child("import time; print('{\"kind\":\"FAILED\",\"error\":\"still running\"}',flush=True); time.sleep(3)"),
                                      nonce="test", timeout_s=0.3, output_cap=1048576, on_ready=lambda _ready: {}))
    expect("premature", lambda: dialog(child(
        "import json,sys\nprint('{\"kind\":\"READY\"}',flush=True)\n"
        "msg=json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'kind':'QUALIFIED','nonce':msg['nonce']}),flush=True)\n"
        "print('{\"kind\":\"FAILED\",\"error\":\"must not override premature\"}',flush=True)\nsys.exit(1)\n"
    ), nonce="test", timeout_s=2, output_cap=1048576, on_ready=lambda _ready: {}))
    with patch.dict(globals(), {"reap": lambda _proc: "injected cleanup failure"}):
        try:
            dialog(child("print('{\"kind\":\"FAILED\",\"error\":\"primary sentinel\"}',flush=True); raise SystemExit(1)"),
                   nonce="test", timeout_s=2, output_cap=1048576, on_ready=lambda _ready: {})
        except Rejection as exc:
            if exc.code != "exit" or "primary sentinel" not in exc.detail or exc.cleanup != "injected cleanup failure":
                raise Rejection("self-check", "cleanup replaced child failure") from exc
        else:
            raise Rejection("self-check", "cleanup accepted child failure")
    print("PASS failure diagnostic primary preserved during cleanup", flush=True)


def check_qualification_cleanup(receipt: Mapping[str, object]) -> None:
    """Exercise qualify and its cleanup against real processes at the Docker boundary."""
    real_run = run_bounded
    real_dialog = dialog
    case_path = ROOT / "scripts/perf/export72-case.json"
    class BrokenDiagnostics(StringIO):
        def write(self, text: str) -> int:
            raise OSError("diagnostic sink closed")

    for fail, broken_trace in ((False, False), (True, False), (False, True), (True, True), ("native", False), ("native", True)):
        target = subprocess.Popen(child("import sys; sys.stdin.readline()"), stdin=subprocess.PIPE, start_new_session=True)
        foreign = subprocess.Popen(child("import time; time.sleep(20)"), start_new_session=True)
        stage: Path | None = None
        removed = False
        canaries: list[Canary] = []
        real_canary = Canary

        def make_canary() -> Canary:
            current = real_canary()
            canaries.append(current)
            return current

        def docker_adapter(argv: list[str], budget: Budget) -> subprocess.CompletedProcess[bytes]:
            nonlocal stage, removed
            if argv[0] != "docker":
                return real_run(argv, budget)
            budget.remaining()
            output = b""
            error = b""
            code = 0
            if argv[1:3] == ["image", "inspect"]:
                output = b'[{"Id":"sha256:abc"}]'
            elif argv[1] == "create":
                mount = argv[argv.index("--mount") + 1]
                stage = Path(mount.split("src=", 1)[1].split(",", 1)[0])
                output = b"container\n"
            elif argv[1] == "inspect":
                if removed:
                    code, error = 1, b"Error: No such object: container\n"
                else:
                    info = native_mount_host()
                    inspected = foreign if argv[-1] == "foreign" else target
                    info["Id"] = "foreign" if inspected is foreign else "container"
                    config = mapping(info["Config"])
                    label = "foreign" if argv[-1] == "foreign" else current_label[0]
                    config["Labels"] = {"portfolio.run": label}
                    info["Config"] = config
                    host_config = mapping(info["HostConfig"])
                    host_config["Mounts"] = [{"Type": "bind", "Source": str(stage), "Target": "/perf", "ReadOnly": True}]
                    info["HostConfig"] = host_config
                    info["Mounts"] = [{"Type": "bind", "Source": str(stage), "Destination": "/perf", "RW": False}]
                    exit_code = inspected.poll()
                    info["State"] = {"Status": "running" if exit_code is None else "exited", "ExitCode": exit_code if exit_code is not None else 0, "OOMKilled": False, "Pid": inspected.pid if exit_code is None else 0}
                    output = json.dumps([info]).encode()
            elif argv[1] == "stop":
                if argv[-1] != "container":
                    raise Rejection("self-check", "adapter stop identity")
                target.terminate()
                target.wait(timeout=budget.remaining())
            elif argv[1] == "rm":
                if argv[-1] != "container" or target.poll() is None:
                    raise Rejection("self-check", "adapter deletion before terminal stop")
                removed = True
            elif argv[1] == "version":
                output = b"1.48\n"
            else:
                raise Rejection("self-check", f"unexpected Docker boundary: {argv[1:]}")
            if budget.claim(len(output) + len(error)):
                raise Rejection("output", "adapter output exceeded cap")
            return subprocess.CompletedProcess(argv, code, output, error)

        current_label = [""]
        def create_adapter(argv: list[str], budget: Budget) -> subprocess.CompletedProcess[bytes]:
            if argv[:2] == ["docker", "create"]:
                current_label[0] = argv[argv.index("--label") + 1].split("=", 1)[1]
            return docker_adapter(argv, budget)

        def probe_adapter(argv: list[str], *, nonce: str, budget: Budget,
                          on_ready: Callable[[dict[str, object]], dict[str, object]], diagnostic: bool) -> dict[str, object]:
            assert stage is not None
            ready = {"kind": "READY", "uid": 1000, "gid": 1000,
                     "probe": file_sha256(stage / "export72-probe.mjs"),
                     "case": file_sha256(stage / "export72-case.json")}
            if fail == "native":
                return real_dialog(child("import json,sys\n"
                    f"print({json.dumps(ready)!r},flush=True)\n"
                    "sys.stdin.readline()\n"
                    "print('{\"kind\":\"FAILED\",\"error\":\"native cleanup sentinel\"}',flush=True)\nsys.exit(1)\n"),
                    nonce=nonce, budget=budget, on_ready=on_ready, diagnostic=diagnostic)
            if fail:
                real_run(child("import sys; sys.stdout.buffer.write(b'x'*2097152)"), budget)
                raise Rejection("self-check", "overflow accepted")
            payload = copy.deepcopy(dict(receipt))
            payload["identity"] = {**mapping(payload["identity"]), "probe": ready["probe"], "case": ready["case"]}
            script = ("import json,sys\n"
                      f"print({json.dumps(ready)!r}, flush=True)\n"
                      "msg=json.loads(sys.stdin.readline())\n"
                      f"result=json.loads({json.dumps(payload)!r})\n"
                      "result.update(kind='QUALIFIED',nonce=msg['nonce'])\n"
                      "print(json.dumps(result),flush=True)\n")
            result = real_dialog(child(script), nonce=nonce, budget=budget,
                                 on_ready=on_ready, diagnostic=diagnostic)
            assert target.stdin is not None
            target.stdin.write(b"finish\n")
            target.stdin.close()
            target.wait(timeout=budget.remaining())
            return result

        # Given real owned/foreign targets, adapt only unavailable Docker/host observations.
        try:
            with patch.dict(globals(), {"run_bounded": create_adapter, "dialog": probe_adapter,
                            "outbound_ip": lambda: "192.0.2.1", "Canary": make_canary,
                            "proc_identity": lambda _pid: ("node", os.getpid()),
                            "count_descendants": lambda _pid, _root: 0,
                            "count_handles": lambda _pid, _root: 0}):
                expect("teardown", lambda: cleanup_owned("foreign", "owned", Budget(time.monotonic() + 1, 1048576)))
                captured = StringIO()
                with redirect_stdout(captured), redirect_stderr(BrokenDiagnostics() if broken_trace else sys.stderr):
                    if fail == "native":
                        try:
                            qualify(case_path)
                        except Rejection as exc:
                            if exc.code != "exit" or "native cleanup sentinel" not in exc.detail:
                                raise Rejection("self-check", "qualification lost native failure detail") from exc
                        else:
                            raise Rejection("self-check", "qualification accepted native failure")
                    elif fail:
                        expect("output", lambda: qualify(case_path))
                    else:
                        qualify(case_path)
            # Then production cleanup must have removed the target and real resources.
            if not removed or target.poll() is None or foreign.poll() is not None:
                raise Rejection("self-check", "qualification cleanup/foreign preservation")
            try:
                os.kill(target.pid, 0)
            except ProcessLookupError:
                pass
            else:
                raise Rejection("self-check", "qualification target remains")
            if stage is None or stage.exists() or not canaries:
                raise Rejection("self-check", "qualification stage cleanup")
            for canary in canaries:
                assert_canary_closed(canary)
            if not fail and json.loads(captured.getvalue())["kind"] != "QUALIFIED":
                raise Rejection("self-check", "qualified receipt lost")
            if not fail:
                print(captured.getvalue(), end="", flush=True)
            print(json.dumps({"case": "qualification-native-failure" if fail == "native" else "qualification-overflow" if fail else "qualification-success",
                              "ownedPid": target.pid, "ownedReapedAbsent": True,
                              "foreignPid": foreign.pid, "foreignAlive": True,
                              "stageRemoved": True, "canaryClosed": True,
                              "receiptRetained": not fail, "brokenDiagnostics": broken_trace}), flush=True)
        finally:
            for process in (target, foreign):
                if process.stdin is not None and not process.stdin.closed:
                    process.stdin.close()
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=1)
                try:
                    os.kill(process.pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    raise Rejection("self-check", "owned fixture cleanup left a process")
            for canary in canaries:
                if any(sock.fileno() != -1 for sock in (canary._tcp, canary._udp, canary._dns)):
                    canary.close()
            if stage is not None and stage.exists():
                release_owned(stage)
            print(json.dumps({"case": "qualification-fixture-cleanup", "ownedPid": target.pid,
                              "foreignPid": foreign.pid, "bothReapedAbsent": True}), flush=True)


def check_pipe_holder() -> None:
    """Prove the inherited pipe owner is gone, not merely that reading timed out."""
    owned = Path(tempfile.mkdtemp(prefix="export72-pipe-"))
    identity_path = owned / "holder.json"
    holder = 0
    leader = 0
    start = ""
    # Linux subreaping makes the orphan's terminal wait observable even under a non-reaping PID 1.
    restore_subreaper: Callable[[], None] = lambda: None
    if sys.platform == "linux":
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        previous = ctypes.c_int()
        if libc.prctl(37, ctypes.byref(previous), 0, 0, 0) != 0 or libc.prctl(36, 1, 0, 0, 0) != 0:
            raise Rejection("self-check", "cannot establish owned pipe reaper")
        def restore_subreaper() -> None:
            if libc.prctl(36, previous.value, 0, 0, 0) != 0:
                raise Rejection("self-check", "cannot restore pipe reaper")
    foreign = subprocess.Popen(child("import time; time.sleep(10)"), start_new_session=True)
    pipe_budget = Budget(time.monotonic() + 1, 1048576, cleanup_seconds=0.6)
    try:
        # Given a holder with a synchronized real PID/start identity, let its immediate parent exit.
        script = ("import os,time,json,subprocess\n"
                  "r,w=os.pipe()\n"
                  "if os.fork()==0:\n"
                  " os.close(r)\n"
                  " start=subprocess.check_output(['ps','-o','lstart=','-p',str(os.getpid())],timeout=0.2).decode().strip()\n"
                  f" with open({str(identity_path)!r},'w') as f: json.dump(dict(pid=os.getpid(),leader=os.getppid(),start=start),f)\n"
                  " os.write(w,b'1');os.close(w);time.sleep(5);os._exit(0)\n"
                  "os.close(w);os.read(r,1);os.close(r);os._exit(0)\n")
        expect("timeout", lambda: run_bounded(child(script), pipe_budget))
        record = mapping(json.loads(identity_path.read_text()))
        holder = required_int(record, "pid")
        leader = required_int(record, "leader")
        start = required_str(record, "start")
        if not start:
            raise Rejection("self-check", "holder start identity missing")
        reaped = False
        absence_deadline = min(pipe_budget.total_deadline, time.monotonic() + 0.15)
        while time.monotonic() < absence_deadline:
            try:
                waited, _status = os.waitpid(holder, os.WNOHANG)
                reaped = waited == holder
            except ChildProcessError:
                pass
            try:
                os.kill(holder, 0)
            except ProcessLookupError:
                break
            time.sleep(min(0.01, max(0, pipe_budget.total_deadline - time.monotonic())))
        else:
            raise Rejection("self-check", "inherited pipe holder remains after timeout")
        if time.monotonic() >= pipe_budget.total_deadline or foreign.poll() is not None:
            raise Rejection("self-check", "pipe holder deadline/foreign preservation")
        print(json.dumps({"case": "retained-pipe", "holderPid": holder, "leaderPid": leader,
                          "start": start, "holderAbsent": True, "holderReaped": reaped,
                          "foreignPid": foreign.pid, "foreignAlive": True,
                          "withinTotalDeadline": True}), flush=True)
        print("PASS real retained pipe holder after immediate child death", flush=True)
    finally:
        primary = sys.exc_info()[1]
        cleanup_errors: list[str] = []
        try:
            if identity_path.exists():
                record = mapping(json.loads(identity_path.read_text()))
                holder = required_int(record, "pid")
                leader = required_int(record, "leader")
                start = required_str(record, "start")
                remaining = pipe_budget.total_deadline - time.monotonic()
                if remaining <= 0:
                    raise Rejection("self-check", "pipe cleanup deadline exhausted")
                try:
                    current = subprocess.run(["ps", "-o", "lstart=", "-p", str(holder)], capture_output=True,
                                             timeout=min(0.1, remaining))
                    if current.stdout.decode().strip() == start and os.getpgid(holder) == leader:
                        os.kill(holder, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                while time.monotonic() < pipe_budget.total_deadline:
                    try:
                        os.waitpid(holder, os.WNOHANG)
                    except ChildProcessError:
                        pass
                    try:
                        os.kill(holder, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(min(0.005, max(0, pipe_budget.total_deadline - time.monotonic())))
                else:
                    raise Rejection("self-check", "owned holder did not become absent")
        except Exception as exc:
            cleanup_errors.append(f"holder: {exc}")
        try:
            restore_subreaper()
        except Exception as exc:
            cleanup_errors.append(f"restore: {exc}")
        try:
            if foreign.poll() is None:
                foreign.kill()
            remaining = pipe_budget.total_deadline - time.monotonic()
            if remaining <= 0:
                raise Rejection("self-check", "foreign cleanup deadline exhausted")
            foreign.wait(timeout=remaining)
            try:
                os.kill(foreign.pid, 0)
            except ProcessLookupError:
                pass
            else:
                raise Rejection("self-check", "foreign fixture owner cleanup failed")
        except Exception as exc:
            cleanup_errors.append(f"foreign: {exc}")
        try:
            release_owned(owned)
        except Exception as exc:
            cleanup_errors.append(f"scratch: {exc}")
        if cleanup_errors:
            detail = "; ".join(cleanup_errors)
            if primary is None:
                raise Rejection("self-check", detail)
            primary.add_note(f"pipe fixture cleanup: {detail}")
            try:
                print(f"FAIL pipe fixture cleanup: {detail}", file=sys.stderr, flush=True)
            except Exception as exc:
                primary.add_note(f"cleanup diagnostic failed: {exc}")
        else:
            print(json.dumps({"case": "pipe-fixture-cleanup", "foreignPid": foreign.pid,
                              "holderPid": holder, "holderAbsent": True,
                              "foreignReapedAbsent": True, "scratchRemoved": not owned.exists(),
                              "withinTotalDeadline": time.monotonic() < pipe_budget.total_deadline}), flush=True)


def self_check() -> None:
    case_path = ROOT / "scripts/perf/export72-case.json"
    probe = ROOT / "scripts/perf/export72-probe.mjs"
    parsed = parse_case(case_path)
    if parsed.logical_bytes != 52428800 or len(parsed.names) != 25:
        raise Rejection("self-check", "valid case did not parse")
    print("PASS valid case", flush=True)
    original_modes = (probe.stat().st_mode, case_path.stat().st_mode)
    private = Path(tempfile.mkdtemp(prefix="export72-private-"))
    try:
        os.chmod(private, 0o700)
        caught: Rejection | None = None
        try:
            validate_stage(private)
        except Rejection as exc:
            caught = exc
        if caught is None or caught.code != "source" or "700" not in caught.detail:
            raise Rejection("self-check", f"private 700 stage was not rejected: {caught}")
        print(f"PASS reject source: {caught.detail}", flush=True)
    finally:
        release_owned(private)
    staged = stage_probe(probe, case_path)
    try:
        if stat_mode(staged) != 0o755:
            raise Rejection("self-check", "public stage directory mode")
        for name in ("export72-probe.mjs", "export72-case.json"):
            if stat_mode(staged / name) != 0o644:
                raise Rejection("self-check", f"public stage file mode {name}")
        print("PASS public stage", flush=True)
    finally:
        release_owned(staged)
    if (probe.stat().st_mode, case_path.stat().st_mode) != original_modes:
        raise Rejection("self-check", "stage chmod changed original files")
    raw = json.loads(case_path.read_text())
    handle, bad_name = tempfile.mkstemp(prefix="export72-malformed-", suffix=".json")
    os.close(handle)
    bad_json = Path(bad_name)
    bad_json.write_text("{")
    try:
        expect("malformed", lambda: parse_case(bad_json))
    finally:
        bad_json.unlink(missing_ok=True)
    mutated = copy.deepcopy(raw)
    backing = mapping(mutated.get("backing"))
    backing["sha256"] = "0" * 64
    mutated["backing"] = backing
    expect("digest", lambda: parse_case_object(mutated))
    mutated = copy.deepcopy(raw)
    attachments = mapping(mutated.get("maxAttachments"))
    original_names = attachments.get("names")
    if not isinstance(original_names, list):
        raise Rejection("self-check", "names")
    kept = [name for name in original_names[2:] if isinstance(name, str)]
    attachments["names"] = ["same.bin", "dir/same.bin", *kept]
    mutated["maxAttachments"] = attachments
    expect("names", lambda: parse_case_object(mutated))
    mutated = copy.deepcopy(raw)
    attachments = mapping(mutated.get("maxAttachments"))
    attachments["logicalBytes"] = 1
    mutated["maxAttachments"] = attachments
    expect("logical", lambda: parse_case_object(mutated))
    mutated = copy.deepcopy(raw)
    source_value = mutated.get("sources")
    if not isinstance(source_value, list) or not source_value:
        raise Rejection("self-check", "sources")
    sources = [mapping(item) for item in source_value]
    sources[0]["sha256"] = "0" * 64
    mutated["sources"] = sources
    expect("source", lambda: parse_case_object(mutated))
    mutated = copy.deepcopy(raw)
    limits = mapping(mutated.get("limits"))
    limits["denyScratchBytes"] = 100
    mutated["limits"] = limits
    expect("scratch", lambda: parse_case_object(mutated))
    host = sample_host()
    admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned")
    print("PASS host config", flush=True)
    host = sample_host()
    host_config = mapping(host.get("HostConfig"))
    host_config["Memory"] = 1
    host["HostConfig"] = host_config
    expect("limits", lambda: admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned"))
    host = sample_host()
    host_config = mapping(host.get("HostConfig"))
    host_config["NetworkMode"] = "bridge"
    host["HostConfig"] = host_config
    expect("namespace", lambda: admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned"))
    host = sample_host()
    host_config = mapping(host.get("HostConfig"))
    tmpfs = mapping(host_config.get("Tmpfs"))
    tmpfs["/tmp"] = "size=33554432"
    host_config["Tmpfs"] = tmpfs
    host["HostConfig"] = host_config
    expect("scratch", lambda: admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned"))
    host = sample_host()
    mount_value = host.get("Mounts")
    if not isinstance(mount_value, list) or not mount_value:
        raise Rejection("self-check", "mounts")
    mounts = [mapping(item) for item in mount_value]
    mounts[0]["RW"] = True
    host["Mounts"] = mounts
    expect("source", lambda: admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned"))
    def extra_mount(mount: dict[str, object]) -> None:
        current = sample_host()
        listed = current.get("Mounts")
        current_mounts = [mapping(item) for item in listed] if isinstance(listed, list) else []
        current_mounts.append(mount)
        current["Mounts"] = current_mounts
        admit_host_config(current, image_id="sha256:abc", user="1000:1000", probe_dir="/owned")
    expect("source", lambda: extra_mount({"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock", "RW": True}))
    expect("source", lambda: extra_mount({"Type": "bind", "Source": "/src/.git", "Destination": "/src/.git", "RW": True}))
    expect("source", lambda: extra_mount({"Type": "bind", "Source": "/etc/hosts", "Destination": "/etc/hosts", "RW": False}))
    host = sample_host()
    host_config = mapping(host.get("HostConfig"))
    tmpfs = mapping(host_config.get("Tmpfs"))
    tmpfs["/tmp"] = "rw,nosuid,nodev,noexec,size=167772160,mode=1777"
    host_config["Tmpfs"] = tmpfs
    host["HostConfig"] = host_config
    expect("scratch", lambda: admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned"))
    host = sample_host()
    host_config = mapping(host.get("HostConfig"))
    host_config["Binds"] = ["/owned:/perf:ro", "/var/run/docker.sock:/var/run/docker.sock"]
    host["HostConfig"] = host_config
    expect("source", lambda: admit_host_config(host, image_id="sha256:abc", user="1000:1000", probe_dir="/owned"))
    admit_host_config(native_mount_host(), image_id="sha256:abc", user="1000:1000", probe_dir="/owned")
    print("PASS native mount schema", flush=True)
    beside = native_mount_host()
    raw_mounts = beside.get("Mounts")
    beside_mounts = [mapping(item) for item in raw_mounts] if isinstance(raw_mounts, list) else []
    beside_mounts.append({"Type": "tmpfs", "Source": "", "Destination": "/tmp", "RW": True})
    beside["Mounts"] = beside_mounts
    beside_config = mapping(beside.get("HostConfig"))
    raw_requested = beside_config.get("Mounts")
    beside_requested = [mapping(item) for item in raw_requested] if isinstance(raw_requested, list) else []
    beside_requested.append({"Type": "tmpfs", "Target": "/tmp", "Source": ""})
    beside_config["Mounts"] = beside_requested
    beside["HostConfig"] = beside_config
    admit_host_config(beside, image_id="sha256:abc", user="1000:1000", probe_dir="/owned")
    print("PASS tmpfs beside probe", flush=True)
    probe_request = {"Type": "bind", "Source": "/owned", "Target": "/perf", "ReadOnly": True}

    def admit_changed(change: Callable[[dict[str, object]], None]) -> None:
        current = native_mount_host()
        change(current)
        admit_host_config(current, image_id="sha256:abc", user="1000:1000", probe_dir="/owned")

    def replace_requested(current: dict[str, object], mounts: list[object]) -> None:
        config = mapping(current.get("HostConfig"))
        config["Mounts"] = mounts
        current["HostConfig"] = config

    print("CASE requested-writable", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [{**probe_request, "ReadOnly": False}])))
    print("CASE requested-readonly-missing", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [{"Type": "bind", "Source": "/owned", "Target": "/perf"}])))
    print("CASE requested-source", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [{**probe_request, "Source": "/etc"}])))
    print("CASE requested-target", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [{**probe_request, "Target": "/opt"}])))
    print("CASE requested-type", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [{**probe_request, "Type": "volume"}])))
    print("CASE requested-duplicate", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [probe_request, dict(probe_request)])))
    print("CASE requested-extra-bind", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [probe_request, {"Type": "bind", "Source": "/etc/hosts", "Target": "/etc/hosts", "ReadOnly": True}])))
    print("CASE requested-socket", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [probe_request, {"Type": "bind", "Source": "/var/run/docker.sock", "Target": "/var/run/docker.sock", "ReadOnly": True}])))
    print("CASE requested-git", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [probe_request, {"Type": "bind", "Source": "/src/.git", "Target": "/src/.git", "ReadOnly": True}])))
    print("CASE requested-missing", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [probe_request, {}])))
    print("CASE requested-malformed-schema", flush=True)
    expect("source", lambda: admit_changed(lambda current: replace_requested(current, [{**probe_request, "Destination": "/perf", "RW": False}])))
    print("CASE requested-malformed-item", flush=True)
    expect("malformed", lambda: admit_changed(lambda current: replace_requested(current, [probe_request, "nope"])))
    print("CASE effective-readonly-missing", flush=True)
    expect("source", lambda: admit_changed(lambda current: current.__setitem__("Mounts", [{"Type": "bind", "Source": "/owned", "Destination": "/perf"}])))
    print("CASE effective-source", flush=True)
    expect("source", lambda: admit_changed(lambda current: current.__setitem__("Mounts", [{"Type": "bind", "Source": "/etc", "Destination": "/perf", "RW": False}])))
    print("CASE effective-destination", flush=True)
    expect("source", lambda: admit_changed(lambda current: current.__setitem__("Mounts", [{"Type": "bind", "Source": "/owned", "Destination": "/opt", "RW": False}])))
    print("CASE effective-type", flush=True)
    expect("source", lambda: admit_changed(lambda current: current.__setitem__("Mounts", [{"Type": "npipe", "Source": "/owned", "Destination": "/perf", "RW": False}])))
    print("CASE effective-duplicate", flush=True)
    expect("source", lambda: admit_changed(lambda current: current.__setitem__("Mounts", [
        {"Type": "bind", "Source": "/owned", "Destination": "/perf", "RW": False},
        {"Type": "bind", "Source": "/owned", "Destination": "/perf", "RW": False},
    ])))
    print("CASE effective-malformed-schema", flush=True)
    expect("source", lambda: admit_changed(lambda current: current.__setitem__("Mounts", [{
        "Type": "bind", "Source": "/owned", "Destination": "/perf", "RW": False, "Target": "/perf", "ReadOnly": True,
    }])))
    cid = "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd"
    prove_absent(1, f"Error: No such object: {cid}\n", True, cid)
    prove_absent(1, f"docker: error: no such object: {cid}\n", True, cid)
    expect("docker", lambda: prove_absent(1, f"docker: error: no such object: {'d' * 64}\n", True, cid))
    expect("docker", lambda: prove_absent(1, f"warning: probe\ndocker: error: no such object: {cid}\n", True, cid))
    expect("docker", lambda: prove_absent(1, f"docker: error: no such object: {cid}\ntrailing\n", True, cid))
    expect("teardown", lambda: prove_absent(0, "", True, cid))
    expect("docker", lambda: prove_absent(1, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n", False, cid))
    expect("docker", lambda: prove_absent(1, f"Error: No such object: {cid}\n", False, cid))
    expect("teardown", lambda: require_owned_label({"portfolio.run": "other"}, "owned-label"))
    stopped_state = {"Status": "exited", "ExitCode": 0, "OOMKilled": False, "Pid": 0}
    assert_terminal(stopped_state, descendants=0, handles=0)
    expect("limits", lambda: assert_terminal({**stopped_state, "OOMKilled": True}, descendants=0, handles=0))
    expect("exit", lambda: assert_terminal({**stopped_state, "ExitCode": 137}, descendants=0, handles=0))
    expect("pid", lambda: assert_terminal({**stopped_state, "Pid": 44}, descendants=0, handles=0))
    expect("teardown", lambda: assert_terminal(stopped_state, descendants=1, handles=0))
    expect("teardown", lambda: assert_terminal(stopped_state, descendants=0, handles=2))
    proc_root = Path(tempfile.mkdtemp(prefix="export72-proc-"))
    try:
        (proc_root / "34").mkdir()
        (proc_root / "34" / "stat").write_text("34 (node) S 12 0")
        (proc_root / "12" / "fd").mkdir(parents=True)
        (proc_root / "12" / "fd" / "0").write_text("")
        (proc_root / "12" / "fd" / "1").write_text("")
        if count_descendants(12, proc_root) != 1 or count_handles(12, proc_root) != 2 or count_handles(99, proc_root) != 0:
            raise Rejection("self-check", "proc witness")
        expect("teardown", lambda: count_descendants(12, proc_root / "missing"))
    finally:
        release_owned(proc_root)
    print("PASS admission gates", flush=True)
    assert_quiet((1, 1, 1), (1, 1, 1))
    expect("namespace", lambda: assert_quiet((1, 1, 1), (1, 2, 1)))
    argv = create_argv(parsed, name="export72-self", label="self", image_id="sha256:abc", probe_dir=Path("/owned"))
    if argv[argv.index("--pids-limit") + 1] != "128" or argv[argv.index("--cpus") + 1] != "1":
        raise Rejection("self-check", "cpu flags are not separate argv")
    if any(" " in item for item in argv):
        raise Rejection("self-check", "argv item contains a space")
    print("PASS docker argv", flush=True)
    check_failure_diagnostics()
    nonce = "abc123abc123abc123"
    dialog(child(
        "import json,sys\n"
        "print(json.dumps({'kind':'READY','uid':1000}), flush=True)\n"
        "msg=json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'kind':'QUALIFIED','nonce':msg['nonce']}), flush=True)\n"
    ), nonce=nonce, timeout_s=2, output_cap=65536, on_ready=lambda _ready: {})
    print("PASS release handshake", flush=True)
    node = shutil.which("node")
    if node is None:
        raise Rejection("self-check", "Node is required for the real release lifecycle")
    source = probe.read_text()
    read_line = source[source.index("function readLine()"):source.index("\nfunction expectDenied")]
    dialog([node, "--input-type=module", "--eval", read_line + "\n"
        "console.log(JSON.stringify({kind:'READY'}));\n"
        "const release=JSON.parse(await readLine());\n"
        "console.log(JSON.stringify({kind:'QUALIFIED',nonce:release.nonce}));\n"
    ], nonce=nonce, timeout_s=2, output_cap=65536, on_ready=lambda _ready: {})
    print("PASS real Node release terminal exit", flush=True)
    reserved = Budget(time.monotonic() + 1, 1048576, cleanup_seconds=0.6)
    expect("timeout", lambda: run_bounded(child("import time; time.sleep(2)"), reserved))
    spent = reserved.used
    reserved.begin_cleanup()
    cleaned = run_bounded(child("print('owned cleanup')"), reserved)
    if cleaned.returncode != 0 or cleaned.stdout != b"owned cleanup\n" or reserved.used != spent + len(cleaned.stdout):
        raise Rejection("self-check", "cleanup reserve or shared output accounting")
    print("PASS reserved cleanup within total deadline", flush=True)
    target = subprocess.Popen(child("import time; time.sleep(10)"))
    try:
        reserved = Budget(time.monotonic() + 2, 1048576, cleanup_seconds=1)
        expect("output", lambda: run_bounded(child("import sys; sys.stdout.buffer.write(b'x'*2097152)"), reserved))
        if reserved.used > reserved.cap:
            raise Rejection("self-check", "overflow consumed cleanup reserve")
        expect("teardown", lambda: require_owned_label({"portfolio.run": "foreign"}, "owned"))
        if target.poll() is not None:
            raise Rejection("self-check", "foreign rejection changed target")
        reserved.begin_cleanup()
        require_owned_label({"portfolio.run": "owned"}, "owned")
        run_bounded(child(f"import os,signal; os.kill({target.pid}, signal.SIGTERM)"), reserved)
        target.wait(timeout=reserved.remaining())
        try:
            os.kill(target.pid, 0)
        except ProcessLookupError:
            pass
        else:
            raise Rejection("self-check", "owned target remains")
        print("PASS real overflow owned target stop reap absence foreign guard", flush=True)
    finally:
        if target.poll() is None:
            target.kill()
        target.wait(timeout=1)
    check_pipe_holder()
    expect("premature", lambda: dialog(child(
        "print('{\"kind\":\"READY\"}', flush=True)\n"
        "print('{\"kind\":\"QUALIFIED\",\"nonce\":\"early\"}', flush=True)\n"
    ), nonce=nonce, timeout_s=2, output_cap=65536, on_ready=lambda _ready: {}))
    expect("timeout", lambda: dialog(child(
        "import time\nprint('{\"kind\":\"READY\"}', flush=True)\ntime.sleep(5)\n"
    ), nonce=nonce, timeout_s=0.4, output_cap=65536, on_ready=lambda _ready: {}))
    expect("output", lambda: dialog(child(
        "import sys\nprint('{\"kind\":\"READY\"}', flush=True)\nsys.stdout.buffer.write(b'a'*4000)\nsys.stdout.buffer.flush()\n"
    ), nonce=nonce, timeout_s=2, output_cap=1024, on_ready=lambda _ready: {}))
    expect("premature", lambda: dialog(child(
        "import json,sys\n"
        "print(json.dumps({'kind':'READY'}), flush=True)\n"
        "msg=json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'kind':'QUALIFIED','nonce':msg['nonce']}), flush=True)\n"
        "sys.exit(1)\n"
    ), nonce=nonce, timeout_s=2, output_cap=65536, on_ready=lambda _ready: {}))
    expect("nonce", lambda: dialog(child(
        "import json,sys\n"
        "print(json.dumps({'kind':'READY'}), flush=True)\n"
        "sys.stdin.readline()\n"
        "print(json.dumps({'kind':'QUALIFIED','nonce':'nope'}), flush=True)\n"
    ), nonce=nonce, timeout_s=2, output_cap=65536, on_ready=lambda _ready: {}))
    expect("image", lambda: dialog(child(
        "import time\nprint('{\"kind\":\"READY\"}', flush=True)\ntime.sleep(2)\n"
    ), nonce=nonce, timeout_s=2, output_cap=65536, on_ready=lambda _ready: (_ for _ in ()).throw(Rejection("image", "wrong image"))))
    tight = Budget(time.monotonic() + 0.3, 1048576)
    expect("timeout", lambda: run_bounded([sys.executable, "-c", "import time; time.sleep(5)"], tight))
    expect("timeout", lambda: run_bounded([sys.executable, "-c", "print('late')"], tight))
    small_budget = Budget(time.monotonic() + 2, 100)
    run_bounded([sys.executable, "-c", "print('x'*40)"], small_budget)
    expect("output", lambda: run_bounded([sys.executable, "-c", "print('y'*80)"], small_budget))
    shared = Budget(time.monotonic() + 2, 1800)
    def spend(_ready: dict[str, object]) -> dict[str, object]:
        run_bounded([sys.executable, "-c", "import sys; sys.stdout.buffer.write(b'z'*1790)"], shared)
        return {}
    expect("output", lambda: dialog(child(
        "import json,sys\n"
        "print(json.dumps({'kind':'READY'}), flush=True)\n"
        "msg=json.loads(sys.stdin.readline())\n"
        "print(json.dumps({'kind':'QUALIFIED','nonce':msg['nonce']}), flush=True)\n"
    ), nonce=nonce, budget=shared, on_ready=spend))
    kept = Path(tempfile.mkdtemp(prefix="export72-keep-"))
    expect("teardown", lambda: release_owned(kept, remove=lambda _path: None))
    if not kept.exists():
        raise Rejection("self-check", "failed cleanup reported success")
    release_owned(kept)
    identity = {
        "node": "v22.22.3", "arch": "arm64", "platform": "linux", "packageName": "@nytt/server",
        "probe": "a" * 64, "case": "b" * 64, "exportSha256": "c" * 64, "storeSha256": "d" * 64,
    }
    witness = {"files": [{"name": "export72-ok", "type": "file", "size": 2}], "total": 2, "persistedZip": False}
    receipt = {"identity": identity, "witness": witness, "persistedZip": False, "logicalBytes": 1, "fixtures": [], "hwmBytes": 1, "network": {}}
    check_qualification_cleanup(receipt)
    retained = retain_receipt(
        receipt, image_id="sha256:abc", probe_sha="a" * 64, case_sha="b" * 64, package_name="@nytt/server",
        canary_before=(0, 0, 0), canary_after=(0, 0, 0), stopped={"Status": "exited", "ExitCode": 0, "OOMKilled": False, "Pid": 0},
    )
    retained_identity = mapping(retained.get("identity"), "self-check")
    if retained.get("persistedZip") is not False or retained_identity.get("image") != "sha256:abc" or retained_identity.get("node") != "v22.22.3" or retained_identity.get("arch") != "arm64":
        raise Rejection("self-check", "identity dropped")
    lied = mapping(json.loads(json.dumps(receipt)))
    lied_identity = mapping(lied.get("identity"))
    lied_identity["probe"] = "f" * 64
    lied["identity"] = lied_identity
    expect("identity", lambda: retain_receipt(lied, image_id="sha256:abc", probe_sha="a" * 64, case_sha="b" * 64, package_name="@nytt/server", canary_before=(0, 0, 0), canary_after=(0, 0, 0), stopped={"Pid": 0}))
    missing = mapping(json.loads(json.dumps(receipt)))
    missing_identity = mapping(missing.get("identity"))
    del missing_identity["arch"]
    missing["identity"] = missing_identity
    expect("identity", lambda: retain_receipt(missing, image_id="sha256:abc", probe_sha="a" * 64, case_sha="b" * 64, package_name="@nytt/server", canary_before=(0, 0, 0), canary_after=(0, 0, 0), stopped={"Pid": 0}))
    forced = copy.deepcopy(receipt)
    forced["persistedZip"] = True
    expect("identity", lambda: retain_receipt(forced, image_id="sha256:abc", probe_sha="a" * 64, case_sha="b" * 64, package_name="@nytt/server", canary_before=(0, 0, 0), canary_after=(0, 0, 0), stopped={"Pid": 0}))
    zipped = mapping(json.loads(json.dumps(receipt)))
    zipped_witness = mapping(zipped.get("witness"))
    zipped_files = zipped_witness.get("files")
    if not isinstance(zipped_files, list):
        raise Rejection("self-check", "witness")
    zipped_files.append({"name": "out.zip", "type": "file", "size": 4})
    zipped_witness["total"] = 6
    zipped_witness["persistedZip"] = True
    zipped["witness"] = zipped_witness
    zipped["persistedZip"] = True
    expect("oracle", lambda: retain_receipt(zipped, image_id="sha256:abc", probe_sha="a" * 64, case_sha="b" * 64, package_name="@nytt/server", canary_before=(0, 0, 0), canary_after=(0, 0, 0), stopped={"Pid": 0}))
    live = Canary()
    try:
        expect("teardown", lambda: assert_canary_closed(live))
        live.close()
        assert_canary_closed(live)
    finally:
        if any(sock.fileno() != -1 for sock in (live._tcp, live._udp, live._dns)):
            live.close()
    print("PASS controller fixtures", flush=True)


def parse_case_object(raw: dict[str, object]) -> Case:
    handle, name = tempfile.mkstemp(prefix="export72-case-", suffix=".json")
    os.close(handle)
    temporary = Path(name)
    temporary.write_text(json.dumps(raw))
    try:
        return parse_case(temporary)
    finally:
        temporary.unlink(missing_ok=True)


def stat_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def validate_stage(owned: Path) -> None:
    if not owned.is_dir() or stat_mode(owned) != 0o755:
        raise Rejection("source", f"stage directory mode {stat_mode(owned):o} blocks uid 1000")
    for name in ("export72-probe.mjs", "export72-case.json"):
        path = owned / name
        if path.parent.resolve() != owned.resolve() or not path.is_file() or stat_mode(path) != 0o644:
            raise Rejection("source", f"staged {name} is not readable by uid 1000")


def stage_probe(probe: Path, case_path: Path) -> Path:
    owned = Path(tempfile.mkdtemp(prefix="export72-probe-"))
    try:
        os.chmod(owned, 0o755)
        for source, name in ((probe, "export72-probe.mjs"), (case_path, "export72-case.json")):
            destination = owned / name
            if destination.parent.resolve() != owned.resolve():
                raise Rejection("source", "refusing to chmod outside the new stage")
            shutil.copy2(source, destination)
            os.chmod(destination, 0o644)
        validate_stage(owned)
    except Exception as exc:
        cleanup_detail = None
        try:
            release_owned(owned)
        except Rejection as cleanup_error:
            cleanup_detail = cleanup_error.detail
        if isinstance(exc, Rejection):
            raise Rejection(exc.code, exc.detail, cleanup=cleanup_detail) from exc
        if cleanup_detail:
            raise Rejection("source", str(exc), cleanup=cleanup_detail) from exc
        raise
    return owned


def main(argv: list[str]) -> int:
    match argv:
        case ["--self-check"]:
            self_check()
            return 0
        case ["--qualify", "--case", path]:
            qualify(Path(path))
            return 0
        case _:
            raise Rejection("usage", "expected --self-check or --qualify --case PATH")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Rejection as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

