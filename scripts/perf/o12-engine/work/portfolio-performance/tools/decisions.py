"""Paired local decision arithmetic; bootstrap resamples independent pairs."""
from __future__ import annotations

import random
import statistics

from protocol import Record, finite, require


def summary(values: list[float]) -> Record:
    result = {'n': len(values), 'median': statistics.median(values), 'range': [min(values), max(values)]}
    if len(values) >= 20:
        result['descriptiveP95'] = sorted(values)[int(.95 * (len(values) - 1))]
    return result


def timing(before: list[float], after: list[float], noise: float, direction: str) -> Record:
    require(all(finite(v) > 0 for v in before), 'nonpositive timing baseline')
    require(all(finite(v) >= 0 for v in after), 'invalid candidate timing')
    sign = 1 if direction == 'lower' else -1
    relative = [sign * (a - b) / a for a, b in zip(before, after, strict=True)]
    rng = random.Random(1127)
    bootstrap = sorted(statistics.median(rng.choices(relative, k=len(relative))) for _ in range(2000))
    gain = statistics.median(relative)
    threshold = max(.05, 2 * noise)
    return {'gain': gain, 'threshold': threshold, 'bootstrapLower95': bootstrap[49],
            'bootstrapResamples': 2000, 'bootstrapSeed': 1127,
            'proven': gain > threshold and bootstrap[49] > 0}


def decide(case: Record, units: list[Record]) -> Record:
    pilot = [u for u in units if u['state']['stage'] == 'pilot']
    measured = [u for u in units if u['state']['stage'] == 'measured']
    metrics = {}
    rejected = []
    primary_gain = False
    for name, spec in case['metrics'].items():
        pairs = [[u['metrics'][name] for u in measured[i:i + 2]] for i in range(0, len(measured), 2)]
        before = [p[0] if i % 2 == 0 else p[1] for i, p in enumerate(pairs)]
        after = [p[1] if i % 2 == 0 else p[0] for i, p in enumerate(pairs)]
        details = {'baseline': summary(before), 'candidate': summary(after),
                   'absoluteDelta': statistics.median(after) - statistics.median(before)}
        if spec['kind'] == 'resource':
            require(name != case['primary'] and spec['direction'] == 'lower' and spec.get('unit') in ('bytes', 'KiB'), 'resource is a lower-is-better secondary byte metric')
        if spec['kind'] in ('timing', 'resource'):
            a = [pilot[i]['metrics'][name] for i in range(0, 10, 2)]
            b = [pilot[i]['metrics'][name] for i in range(1, 10, 2)]
            require(all(v > 0 for v in a), 'nonpositive pilot timing')
            noise = statistics.median(abs(x - y) / x for x, y in zip(a, b, strict=True))
            decision = timing(before, after, noise, spec['direction'])
            details.update(decision)
            details['noise'] = noise
            tolerance = min(decision['threshold'], spec.get('tolerance', decision['threshold']))
            if decision['gain'] < -tolerance:
                rejected.append(name)
            gained = decision['proven'] and spec['kind'] == 'timing'
        else:
            sign = 1 if spec['direction'] == 'lower' else -1
            require(len(set(before)) == 1 and len(set(after)) == 1, 'non-deterministic counter')
            gained = sign * (before[0] - after[0]) > 0
            if name != case['primary'] and sign * (after[0] - before[0]) > 0:
                rejected.append(name)
            details['relativeSaving'] = (before[0] - after[0]) / before[0] if before[0] else None
        if 'budget' in spec and max(after) > finite(spec['budget']):
            rejected.append(name)
        if name == case['primary']:
            primary_gain = gained
        metrics[name] = details
    return {'status': 'PASS' if primary_gain and not rejected else 'NO_PROVEN_GAIN',
            'outcome': 'VERIFIED_GAIN' if primary_gain and not rejected else 'NO_PROVEN_GAIN',
            'secondaryRegressions': rejected, 'metrics': metrics}
