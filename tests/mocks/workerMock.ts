export class MockWorker {
  static instances: MockWorker[] = [];

  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  terminate(): void {
    this.terminated = true;
  }
}

export default MockWorker;
