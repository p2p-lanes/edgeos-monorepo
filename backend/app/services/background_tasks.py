"""Fire-and-forget coroutines that are neither garbage-collected nor dropped.

The event loop keeps only weak references to tasks, so an untracked task can
disappear before it finishes. Short-lived processes (the pending-payment
sweeper runs under ``asyncio.run``) also cancel whatever is still pending when
their main coroutine returns, so they call ``drain`` before exiting.
"""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any

from loguru import logger

_pending: set[asyncio.Task[Any]] = set()


def spawn(
    func: Callable[..., Coroutine[Any, Any, Any]], *args: Any
) -> asyncio.Task[Any]:
    """Run ``func(*args)`` on the running loop and keep it alive until done.

    The loop is looked up before the coroutine is created, so a caller without
    a running loop gets ``RuntimeError`` and no never-awaited coroutine.
    """
    loop = asyncio.get_running_loop()
    task = loop.create_task(func(*args))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
    return task


async def drain(timeout: float) -> None:
    """Wait up to ``timeout`` seconds for tasks spawned on the current loop."""
    loop = asyncio.get_running_loop()
    tasks = [task for task in _pending if task.get_loop() is loop]
    if not tasks:
        return
    _done, not_done = await asyncio.wait(tasks, timeout=timeout)
    if not_done:
        logger.warning(
            "{} background task(s) still running after {}s; they will be cancelled",
            len(not_done),
            timeout,
        )
