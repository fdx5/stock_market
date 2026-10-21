/** GPU validation is asynchronous: a returned render() is not proof of a drawn frame. */
export class GpuFrameHealth {
  constructor(device, now = () => performance.now()) {
    this.device = device;
    this.now = now;
    this.failure = null;
    this.pendingAt = null;
    this.nextProbeAt = 0;
    this.disposed = false;
    this.onError = () => { this.failure = 'gpu-validation'; };
    device.addEventListener('uncapturederror', this.onError);
  }
  check() {
    if (this.pendingAt !== null && this.now() - this.pendingAt > 8000) this.failure = 'gpu-submit-timeout';
    if (this.failure) throw new Error(this.failure);
  }
  submitted() {
    const now = this.now();
    if (this.disposed || this.pendingAt !== null || now < this.nextProbeAt) return;
    this.pendingAt = now;
    this.nextProbeAt = now + 1000;
    this.device.queue.onSubmittedWorkDone().then(() => {
      if (!this.disposed) this.pendingAt = null;
    }, () => {
      if (!this.disposed) this.failure = 'gpu-submit-rejected';
    });
  }
  dispose() {
    this.disposed = true;
    this.device.removeEventListener('uncapturederror', this.onError);
  }
}
