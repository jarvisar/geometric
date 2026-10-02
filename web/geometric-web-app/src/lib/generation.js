/* Each runner owns one worker. Superseding a job terminates its computation. */
(function () {
    'use strict';
    let sourceURL;
    PG.GenerationRunner = class {
        constructor() { this.worker = null; this.pending = null; }
        cancel() {
            if (!this.pending) return;
            this.worker.terminate();
            this.worker = null;
            this.pending.reject(new DOMException('Generation cancelled', 'AbortError'));
            this.pending = null;
        }
        dispose() {
            this.cancel();
            if (this.worker) this.worker.terminate();
            this.worker = null;
        }
        run(job) {
            this.cancel();
            return new Promise((resolve, reject) => {
                try {
                    if (!this.worker) {
                        if (typeof PG.workerSource !== 'string') throw new Error('Generation code did not load. Reload the app to retry.');
                        sourceURL ||= URL.createObjectURL(new Blob([PG.workerSource], { type: 'text/javascript' }));
                        this.worker = new Worker(sourceURL);
                        const worker = this.worker;
                        this.worker.onmessage = ({ data }) => {
                            if (this.worker !== worker || !this.pending) return;
                            const pending = this.pending;
                            this.pending = null;
                            if (data.error) pending.reject(new Error(data.error));
                            else pending.resolve(data.result);
                        };
                        this.worker.onerror = event => {
                            event.preventDefault();
                            if (this.worker !== worker) return;
                            const pending = this.pending;
                            this.pending = null;
                            this.dispose();
                            pending?.reject(new Error(event.message || 'Could not start background generation'));
                        };
                        this.worker.onmessageerror = () => {
                            if (this.worker !== worker) return;
                            const pending = this.pending;
                            this.pending = null;
                            this.dispose();
                            pending?.reject(new Error('Could not read the generated drawing'));
                        };
                    }
                    this.pending = { resolve, reject };
                    this.worker.postMessage(job);
                } catch (err) {
                    this.pending = null;
                    this.dispose();
                    reject(err);
                }
            });
        }
    };

    /*
     * Live preview on two workers that are kept warm. A newer request doesn't cancel a running
     * job. The job finishes, the newest request waits for a free worker and anything requested
     * in between is skipped. A new worker takes about 20 ms to parse the bundle and runs 1.5 to
     * 2.5x slower until V8 has optimised it, so cancelling on every slider tick meant designs
     * slower than a frame never finished while dragging.
     *
     * Only one live (dragging) job runs at a time. That keeps the other worker free for whatever
     * comes next, like letting go of the slider.
     */
    const SLOW_MS = 1000;
    PG.PreviewQueue = class {
        constructor() {
            this.slots = [0, 1].map(() => ({ runner: new PG.GenerationRunner(), job: null }));
            this.waiting = null;
            this.timer = 0;
        }
        // Resolves with the result, or null if a newer request replaced this one before it started.
        // Requests with the same key share one job.
        run(msg, { live = false, key = null } = {}) {
            if (key) {
                const same = this.slots.find(s => s.job && s.job.key === key)?.job
                    || (this.waiting && this.waiting.key === key ? this.waiting : null);
                if (same) {
                    if (!live) same.live = false;
                    if (same === this.waiting) this.pump();
                    return same.promise;
                }
            }
            const job = { msg, key, live };
            job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
            if (this.waiting) this.waiting.resolve(null);
            this.waiting = job;
            this.pump();
            return job.promise;
        }
        // Forget the waiting request. Running jobs finish and their results are left to the caller.
        drop() {
            clearTimeout(this.timer);
            if (this.waiting) this.waiting.resolve(null);
            this.waiting = null;
        }
        pump() {
            clearTimeout(this.timer);
            const job = this.waiting;
            if (!job) return;
            const free = this.slots.find(s => !s.job);
            if (!free || (job.live && this.slots.some(s => s.job && s.job.live))) {
                this.watch();
                return;
            }
            this.waiting = null;
            free.job = job;
            job.started = performance.now();
            free.runner.run(job.msg).then(job.resolve, job.reject).finally(() => {
                if (free.job === job) free.job = null;
                this.pump();
            });
        }
        // A job that has run for over a second is usually a big grid or paper size. A cold worker is
        // cheaper than waiting for it, so a click or a released slider cancels it. Live requests never
        // do, or every job would be cancelled before it finished while dragging a slow design.
        watch() {
            const job = this.waiting;
            if (job.live) return;
            const oldest = this.slots.reduce((a, b) => (a.job.started <= b.job.started ? a : b));
            const victim = oldest.job;
            this.timer = setTimeout(() => {
                if (this.waiting === job && oldest.job === victim) oldest.runner.cancel();
            }, Math.max(0, victim.started + SLOW_MS - performance.now()));
        }
    };
})();
