import type pg from 'pg';

type Render = (id: string, signal: AbortSignal) => Promise<boolean>;

export async function enqueueRender(pool: pg.Pool, id: string, ownerId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE seasons SET status='rendering',render_error=NULL,updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND status IN ('draft','review','failed','rejected') RETURNING id`,
      [id, ownerId],
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO render_jobs(season_id) VALUES($1) ON CONFLICT(season_id) DO UPDATE
       SET state='queued',created_at=now(),completed_at=NULL`,
      [id],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function runNextRender(
  pool: pg.Pool,
  render: Render,
  shutdown?: AbortSignal,
): Promise<boolean> {
  const client = await pool.connect();
  const lost = new AbortController();
  const signal = shutdown ? AbortSignal.any([shutdown, lost.signal]) : lost.signal;
  const onError = () => lost.abort();
  client.on('error', onError);
  try {
    signal.throwIfAborted();
    await client.query('BEGIN');
    // Keep this transaction/row lock until processing finishes. A crash rolls back the
    // claim, and SKIP LOCKED prevents a second worker from processing this same job.
    const job = (
      await client.query(
        `SELECT j.season_id,s.status FROM render_jobs j JOIN seasons s ON s.id=j.season_id
       WHERE j.state='queued' ORDER BY j.created_at,j.season_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
      )
    ).rows[0];
    if (!job) {
      await client.query('COMMIT');
      return false;
    }
    let success = job.status === 'review' || job.status === 'published';
    if (job.status === 'rendering') {
      // renderSeason finalizes its own season status. Do not lock that row again:
      // a concurrent retry may already hold it while waiting for our job-row lock.
      // Unexpected errors roll the claim back so the queue can try again.
      success = await render(job.season_id, signal);
      signal.throwIfAborted();
    }
    await client.query(
      'UPDATE render_jobs SET state=$2,attempts=attempts+1,completed_at=now() WHERE season_id=$1',
      [job.season_id, success ? 'done' : 'failed'],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    if (!signal.aborted) throw error;
    return false;
  } finally {
    client.removeListener('error', onError);
    client.release(lost.signal.aborted);
  }
}

export function startRenderWorker(pool: pg.Pool, render: Render) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  const tick = () => {
    running = (async () => {
      let worked = false;
      try {
        worked = await runNextRender(pool, render, controller.signal);
      } catch (error) {
        console.error(
          'Render queue unavailable:',
          error instanceof Error ? error.message : 'unknown',
        );
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(tick, worked ? 0 : 1000);
        timer.unref();
      }
    })();
  };
  tick();
  return async () => {
    controller.abort();
    clearTimeout(timer);
    await running;
  };
}
