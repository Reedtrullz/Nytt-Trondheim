"""Prepare-only metadata check for the original O12 harness.

The adapter parses the frozen protocol and rejects a measurement. It does not
call the product, the database, or measure.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

type Json = dict[str, Json] | list[Json] | str | int | float | bool | None
type PhaseName = Literal["baseline", "candidate"]

SCRATCH_BYTES: Final[int] = 16 * 1024 * 1024
EXPORT_OUTPUT_BYTES: Final[int] = 64 * 1024 * 1024
DB_RAM_BYTES: Final[int] = 512 * 1024 * 1024
DB_DATA_BYTES: Final[int] = 128 * 1024 * 1024
OUTER_TIMEOUT_S: Final[int] = 120
INNER_TIMEOUT_S: Final[int] = 110
STREAM_BYTES: Final[int] = 1024 * 1024
DB_PIDS: Final[int] = 128
DB_CPUS: Final[int] = 1
PAIRS: Final[int] = 10
PILOT_PAIRS: Final[int] = 5
WARM_PAIRS: Final[int] = 2
BOOTSTRAP_RESAMPLES: Final[int] = 2000
BOOTSTRAP_SEED: Final[int] = 1127
FORBIDDEN: Final[frozenset[str]] = frozenset(
    {"gain", "gainPercent", "acceptedGain", "medianImprovement", "timings"}
)
SHAPE_IDS: Final[frozenset[str]] = frozenset(
    {
        "article-text-1k",
        "article-text-10k",
        "article-text-maximum",
        "feed-pagination",
        "map-transport-1k-10k",
        "map-bounds-adverse",
        "operations-reads",
        "explain-article",
        "explain-map",
        "retention-five-cycles",
        "retention-failure",
        "retention-cancel",
        "retention-long-lived",
        "export-empty",
        "export-small",
        "export-maximum",
        "export-failure-visibility",
        "geocode-reuse",
        "expand-contract",
    }
)


class PrepReject(Exception):
    """One closed rejection code from the preparation boundary."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class InputPin:
    name: str
    sha256: str


@dataclass(frozen=True, slots=True)
class QueryPin:
    store_sha256: str
    test_sha256: str


@dataclass(frozen=True, slots=True)
class Protocol:
    observation: Literal["UNOBSERVED"]
    scratch_bytes: int
    export_output_bytes: int
    db_ram_bytes: int
    db_data_bytes: int
    outer_timeout_s: int
    inner_timeout_s: int
    stream_bytes: int
    db_pids: int
    db_cpus: int
    pairs: int
    pilot_pairs: int
    warm_pairs: int
    bootstrap_resamples: int
    bootstrap_seed: int
    phases: tuple[PhaseName, PhaseName]
    baseline: QueryPin
    candidate: QueryPin
    inputs: tuple[InputPin, ...]


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def parse_text(text: str) -> Protocol:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise PrepReject("malformed-protocol") from error
    if not isinstance(value, dict):
        raise PrepReject("malformed-protocol")
    return parse_protocol(value)


def read_json(path: Path) -> dict[str, Json]:
    try:
        text = path.read_text()
    except OSError as error:
        raise PrepReject("bad-path") from error
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise PrepReject("malformed-protocol") from error
    if not isinstance(value, dict):
        raise PrepReject("malformed-protocol")
    return value


def exact_int(value: Json, expected: int, over_code: str) -> int:
    if type(value) is not int:
        raise PrepReject("malformed-protocol")
    if value > expected:
        raise PrepReject(over_code)
    if value != expected:
        raise PrepReject("guard-changed")
    return value


def sha256_text(value: Json) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise PrepReject("malformed-protocol")
    return value


def input_name(value: Json) -> str:
    if not isinstance(value, str) or value in {"", ".", ".."} or "/" in value:
        raise PrepReject("bad-path")
    if any(ord(char) < 32 for char in value):
        raise PrepReject("bad-path")
    return value


def query_pin(value: Json) -> QueryPin:
    if not isinstance(value, dict):
        raise PrepReject("malformed-protocol")
    return QueryPin(
        store_sha256=sha256_text(value.get("storeSha256")),
        test_sha256=sha256_text(value.get("testSha256")),
    )


def phases_of(value: Json) -> tuple[PhaseName, PhaseName]:
    if not isinstance(value, list) or len(value) != 2 or not all(isinstance(item, str) for item in value):
        raise PrepReject("stale-phase")
    first, second = value
    match (first, second):
        case ("baseline", "candidate"):
            return ("baseline", "candidate")
        case _:
            raise PrepReject("stale-phase")


def pins_of(value: Json) -> tuple[InputPin, ...]:
    if not isinstance(value, list) or not value:
        raise PrepReject("malformed-protocol")
    pins: list[InputPin] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise PrepReject("malformed-protocol")
        name = input_name(item.get("name"))
        if name in seen:
            raise PrepReject("bad-path")
        seen.add(name)
        pins.append(InputPin(name=name, sha256=sha256_text(item.get("sha256"))))
    return tuple(pins)


def parse_protocol(raw: dict[str, Json]) -> Protocol:
    if FORBIDDEN & raw.keys():
        raise PrepReject("misleading-success")
    if raw.get("schema") != "nytt-o12-measurement-preparation/v1":
        raise PrepReject("malformed-protocol")
    observation = raw.get("observation")
    match observation:
        case "UNOBSERVED":
            checked: Literal["UNOBSERVED"] = observation
        case _:
            raise PrepReject("stale-observation")
    return Protocol(
        observation=checked,
        scratch_bytes=exact_int(raw.get("scratchBytes"), SCRATCH_BYTES, "scratch-over-ceiling"),
        export_output_bytes=exact_int(raw.get("exportOutputBytes"), EXPORT_OUTPUT_BYTES, "guard-changed"),
        db_ram_bytes=exact_int(raw.get("dbRamBytes"), DB_RAM_BYTES, "guard-changed"),
        db_data_bytes=exact_int(raw.get("dbDataBytes"), DB_DATA_BYTES, "guard-changed"),
        outer_timeout_s=exact_int(raw.get("outerTimeoutS"), OUTER_TIMEOUT_S, "timeout-over-ceiling"),
        inner_timeout_s=exact_int(raw.get("innerTimeoutS"), INNER_TIMEOUT_S, "timeout-over-ceiling"),
        stream_bytes=exact_int(raw.get("streamBytes"), STREAM_BYTES, "guard-changed"),
        db_pids=exact_int(raw.get("dbPids"), DB_PIDS, "guard-changed"),
        db_cpus=exact_int(raw.get("dbCpus"), DB_CPUS, "guard-changed"),
        pairs=exact_int(raw.get("pairs"), PAIRS, "guard-changed"),
        pilot_pairs=exact_int(raw.get("pilotPairs"), PILOT_PAIRS, "guard-changed"),
        warm_pairs=exact_int(raw.get("warmPairs"), WARM_PAIRS, "guard-changed"),
        bootstrap_resamples=exact_int(raw.get("bootstrapResamples"), BOOTSTRAP_RESAMPLES, "guard-changed"),
        bootstrap_seed=exact_int(raw.get("bootstrapSeed"), BOOTSTRAP_SEED, "guard-changed"),
        phases=phases_of(raw.get("phases")),
        baseline=query_pin(raw.get("baseline")),
        candidate=query_pin(raw.get("candidate")),
        inputs=pins_of(raw.get("inputs")),
    )


def verify_inputs(protocol: Protocol, inputs: Path) -> None:
    if not inputs.is_dir():
        raise PrepReject("bad-path")
    for pin in protocol.inputs:
        path = inputs / pin.name
        if not path.is_file():
            raise PrepReject("missing-input")
        if hashlib.sha256(path.read_bytes()).hexdigest() != pin.sha256:
            raise PrepReject("stale-input")


def verify_shapes(cases: Path) -> None:
    index = read_json(cases / "index.json")
    shapes = read_json(cases / "shapes.json")
    if index.get("observation") != "UNOBSERVED" or index.get("caseReadAuthorized") is not False:
        raise PrepReject("stale-observation")
    if index.get("historicalT12Json") is not False:
        raise PrepReject("misleading-success")
    rows = shapes.get("shapes")
    if shapes.get("observation") != "UNOBSERVED" or not isinstance(rows, list):
        raise PrepReject("stale-observation")
    found: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise PrepReject("malformed-protocol")
        if FORBIDDEN & row.keys() or row.get("measured") is True:
            raise PrepReject("misleading-success")
        shape_id = row.get("id")
        if not isinstance(shape_id, str) or row.get("observation") != "UNOBSERVED":
            raise PrepReject("stale-observation")
        found.add(shape_id)
    if found != SHAPE_IDS:
        raise PrepReject("missing-shape")


def reject_result(raw: dict[str, Json]) -> None:
    """A result record is never acceptable while the protocol is unobserved."""
    status = raw.get("status")
    output = raw.get("output")
    if not isinstance(status, str) or not isinstance(output, str):
        raise PrepReject("malformed-protocol")
    if status in {"PARTIAL", "TIMEOUT", "INCOMPLETE"} or output == "" or not output.endswith("\n"):
        raise PrepReject("partial-output")
    if status in {"PASS", "SUCCESS"} or bool(FORBIDDEN & raw.keys()):
        raise PrepReject("misleading-success")
    raise PrepReject("unexpected-result")


def expect(code: str, action: Callable[[], object]) -> None:
    try:
        action()
    except PrepReject as error:
        if error.code != code:
            raise
        return
    raise PrepReject("negative-not-rejected")


def self_check(root: Path) -> None:
    raw = read_json(root / "o12-protocol.json")
    protocol = parse_protocol(raw)
    verify_inputs(protocol, root / "o12-inputs")
    verify_shapes(root / "o12-cases")
    scratch_parent = root / ".o12-self-check"
    scratch_parent.mkdir()
    try:
        with tempfile.TemporaryDirectory(prefix="unit-", dir=scratch_parent) as directory:
            partial = Path(directory) / "partial.json"
            partial.write_text('{"status":"PARTIAL","output":""}\n')
            expect("partial-output", lambda: reject_result(read_json(partial)))
            # Hostile old-scope figure; the check exists to reject it.
            expect(
                "misleading-success",
                lambda: reject_result({"status": "PASS", "output": "ok\n", "acceptedGain": 6.44}),
            )
        stale = dict(raw)
        stale["phases"] = ["baseline", "warm"]
        expect("stale-phase", lambda: parse_protocol(stale))
        over_scratch = dict(raw)
        over_scratch["scratchBytes"] = SCRATCH_BYTES + 1
        expect("scratch-over-ceiling", lambda: parse_protocol(over_scratch))
        over_time = dict(raw)
        over_time["outerTimeoutS"] = OUTER_TIMEOUT_S + 1
        expect("timeout-over-ceiling", lambda: parse_protocol(over_time))
        copied = json.loads(json.dumps(raw))
        if not isinstance(copied, dict) or not isinstance(copied.get("inputs"), list):
            raise PrepReject("malformed-protocol")
        first = copied["inputs"][0]
        if not isinstance(first, dict):
            raise PrepReject("malformed-protocol")
        first["name"] = "../store.ts"
        expect("bad-path", lambda: parse_protocol(copied))
        expect("malformed-protocol", lambda: parse_text("{"))
        gained = dict(raw)
        gained["acceptedGain"] = 6.44
        expect("misleading-success", lambda: parse_protocol(gained))
        observed = dict(raw)
        observed["observation"] = "MEASURED"
        expect("stale-observation", lambda: parse_protocol(observed))
    finally:
        shutil.rmtree(scratch_parent)
    if scratch_parent.exists():
        raise PrepReject("scratch-survived")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_check:
            self_check(script_dir())
            print(json.dumps({"status": "PASS", "mode": "self-check", "observation": "UNOBSERVED", "cleaned": True}))
            return 0
        protocol = parse_protocol(read_json(script_dir() / "o12-protocol.json"))
        verify_inputs(protocol, script_dir() / "o12-inputs")
        verify_shapes(script_dir() / "o12-cases")
        print(json.dumps({"status": "PASS", "mode": "prepare", "observation": protocol.observation}))
        return 0
    except PrepReject as error:
        print(json.dumps({"status": "FAIL", "code": error.code}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
