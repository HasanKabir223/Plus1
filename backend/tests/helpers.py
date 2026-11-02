"""Loop-free coroutine driver for tests.

Every coroutine under test here is pure: the HTTP and DB layers are faked
with bare coroutines that never touch real I/O. Driving them with a trivial
send-loop instead of asyncio.run() keeps the suite hermetic -- it passes
even where creating an event loop is impossible (e.g. sandboxes that block
the loop's internal socketpair).

If production code ever awaits real I/O on these paths, this fails loudly
instead of hanging.
"""

from typing import Any, Coroutine


def run(coro: Coroutine[Any, Any, Any]) -> Any:
    try:
        yielded = coro.send(None)
    except StopIteration as exc:
        return exc.value
    raise RuntimeError(f"test coroutine blocked on real I/O: {yielded!r}")
