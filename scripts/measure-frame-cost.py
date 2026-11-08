#!/usr/bin/env python3
"""CPU and GPU time of the running Sonolith over a window of seconds (Linux).

CPU: utime + stime of `sonolith` and its WebKit child processes (/proc/<pid>/stat), as % of one core.
GPU: the DRM engine time those processes report in /proc/<pid>/fdinfo (`drm-engine-*`, i915/xe/amdgpu), as % of
the window; the compositor's own GPU time is listed separately when its process name is given.

Usage: scripts/measure-frame-cost.py [seconds] [compositor-process-name]
"""
import os
import sys
import time

TICK = os.sysconf("SC_CLK_TCK")


def procs():
    """pid → name for sonolith and every process below it."""
    names, parents = {}, {}
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            with open(f"/proc/{pid}/stat") as f:
                s = f.read()
        except OSError:
            continue
        name = s[s.index("(") + 1 : s.rindex(")")]
        names[int(pid)] = name
        parents[int(pid)] = int(s[s.rindex(")") + 2 :].split()[1])
    roots = {p for p, n in names.items() if n == "sonolith"}
    out = {}
    for p in names:
        q = p
        while q > 1:
            if q in roots:
                out[p] = names[p]
                break
            q = parents.get(q, 0)
    return out, names


def cpu_ticks(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            s = f.read()
    except OSError:
        return 0
    fields = s[s.rindex(")") + 2 :].split()
    return int(fields[11]) + int(fields[12])


def gpu_ns(pid):
    """Sum of drm-engine-* ns over the process's DRM clients (each client counted once)."""
    total, seen = 0, set()
    try:
        fds = os.listdir(f"/proc/{pid}/fdinfo")
    except OSError:
        return 0
    for fd in fds:
        try:
            with open(f"/proc/{pid}/fdinfo/{fd}") as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        info = dict(l.split(":", 1) for l in lines if ":" in l)
        client = info.get("drm-client-id")
        if not client or client in seen:
            continue
        seen.add(client)
        for k, v in info.items():
            if k.startswith("drm-engine-") and not k.startswith("drm-engine-capacity"):
                total += int(v.split()[0])
    return total


def sample(pids):
    return {p: (cpu_ticks(p), gpu_ns(p)) for p in pids}


def main():
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 20
    comp = sys.argv[2] if len(sys.argv) > 2 else None
    ours, names = procs()
    if not ours:
        sys.exit("sonolith isn't running")
    comp_pids = [p for p, n in names.items() if comp and n == comp]
    pids = list(ours) + comp_pids
    a = sample(pids)
    t0 = time.monotonic()
    time.sleep(secs)
    b = sample(pids)
    dt = time.monotonic() - t0
    cpu = sum(b[p][0] - a[p][0] for p in ours) / TICK / dt * 100
    gpu = sum(b[p][1] - a[p][1] for p in ours) / 1e9 / dt * 100
    print(f"sonolith ({len(ours)} processes): CPU {cpu:.1f} % of a core, GPU {gpu:.1f} % busy, over {dt:.0f} s")
    if comp_pids:
        ccpu = sum(b[p][0] - a[p][0] for p in comp_pids) / TICK / dt * 100
        cgpu = sum(b[p][1] - a[p][1] for p in comp_pids) / 1e9 / dt * 100
        print(f"{comp}: CPU {ccpu:.1f} % of a core, GPU {cgpu:.1f} % busy")


if __name__ == "__main__":
    main()
