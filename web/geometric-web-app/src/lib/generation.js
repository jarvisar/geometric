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
})();
