"""Reconnecting politely (SPEC section 3.4 "Sonolith not available" and checklist item 12).

Start at 1 second, double each time, at most 60 seconds, with random jitter of +-20 %. Reset after a successful
`session.hello`. A wait Sonolith asks for (`retryAfterMs`) is never shortened.
"""

from __future__ import annotations

import random
from typing import Callable


class Backoff:
    def __init__(
        self,
        first: float = 1.0,
        maximum: float = 60.0,
        jitter: float = 0.2,
        rand: Callable[[float, float], float] = random.uniform,
    ) -> None:
        self.first = first
        self.maximum = maximum
        self.jitter = jitter
        self._rand = rand
        self._next = first

    def next_delay(self, at_least: float = 0.0) -> float:
        """The wait before the next attempt, in seconds; then doubles the base for the attempt after."""
        base = self._next
        self._next = min(self._next * 2, self.maximum)
        delay = base * self._rand(1 - self.jitter, 1 + self.jitter)
        return max(delay, at_least)

    def reset(self) -> None:
        self._next = self.first

    @property
    def upcoming_base(self) -> float:
        return self._next
