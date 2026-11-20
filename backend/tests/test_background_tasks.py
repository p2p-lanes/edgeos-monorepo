import asyncio
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from app.jobs import pending_payment_sweeper as sweeper_job
from app.services import background_tasks, ga4_mp, meta_capi


def test_spawn_without_running_loop_does_not_create_coroutine() -> None:
    calls = []

    async def work() -> None:
        calls.append(True)

    with pytest.raises(RuntimeError):
        background_tasks.spawn(work)
    assert calls == []


def test_drain_waits_for_spawned_tasks_and_forgets_them() -> None:
    finished = []

    async def work(value: str) -> None:
        await asyncio.sleep(0.01)
        finished.append(value)

    async def main() -> None:
        background_tasks.spawn(work, "a")
        background_tasks.spawn(work, "b")
        await background_tasks.drain(timeout=1)

    asyncio.run(main())
    assert sorted(finished) == ["a", "b"]
    assert not background_tasks._pending


def test_drain_returns_after_timeout() -> None:
    async def slow() -> None:
        await asyncio.sleep(10)

    async def main() -> bool:
        task = background_tasks.spawn(slow)
        await background_tasks.drain(timeout=0.01)
        return task.done()

    assert asyncio.run(main()) is False


def test_sweeper_job_waits_for_purchase_notifications(monkeypatch) -> None:
    sent = []

    async def send(provider: str, *_snapshots) -> None:
        await asyncio.sleep(0.05)
        sent.append(provider)

    async def sweep(*_args, **_kwargs) -> dict:
        # What approve_payment does for a payment the sweeper approves.
        payment = SimpleNamespace(id="sweeper-approved", products_snapshot=[])
        meta_capi.fire_and_forget_purchase_event(
            tenant=SimpleNamespace(), payment=payment
        )
        ga4_mp.fire_and_forget_purchase_event(tenant=SimpleNamespace(), payment=payment)
        return {"failures": 0}

    async def meta_send(*snapshots) -> None:
        await send("meta", *snapshots)

    async def ga4_send(*snapshots) -> None:
        await send("ga4", *snapshots)

    monkeypatch.setattr(meta_capi, "prepare_and_send_purchase_event", meta_send)
    monkeypatch.setattr(ga4_mp, "prepare_and_send_purchase_event", ga4_send)
    monkeypatch.setattr(sweeper_job, "sweep_pending_payments", sweep)
    monkeypatch.setattr(sweeper_job, "Session", lambda _engine: nullcontext())
    monkeypatch.setattr(sweeper_job.settings, "PENDING_SWEEP_ENABLED", True)

    assert sweeper_job.main() == 0
    assert sorted(sent) == ["ga4", "meta"]
