export class BackgroundJobRepository {
  async upsertSnapshot(_input) {
    throw new Error("BackgroundJobRepository.upsertSnapshot is not implemented.");
  }

  async listSnapshots(_filter = {}) {
    throw new Error("BackgroundJobRepository.listSnapshots is not implemented.");
  }

  async getByJobKey(_jobKey) {
    throw new Error("BackgroundJobRepository.getByJobKey is not implemented.");
  }

  async listResumable(_filter = {}) {
    throw new Error("BackgroundJobRepository.listResumable is not implemented.");
  }

  async leaseNext(_workerId, _options = {}) {
    throw new Error("BackgroundJobRepository.leaseNext is not implemented.");
  }

  async leaseByJobKey(_jobKey, _workerId, _options = {}) {
    throw new Error("BackgroundJobRepository.leaseByJobKey is not implemented.");
  }

  async startLease(_jobKey, _workerId) {
    throw new Error("BackgroundJobRepository.startLease is not implemented.");
  }

  async heartbeatLease(_jobKey, _workerId, _options = {}) {
    throw new Error("BackgroundJobRepository.heartbeatLease is not implemented.");
  }

  async completeLease(_jobKey, _workerId, _result = {}) {
    throw new Error("BackgroundJobRepository.completeLease is not implemented.");
  }

  async failLease(_jobKey, _workerId, _failure = {}) {
    throw new Error("BackgroundJobRepository.failLease is not implemented.");
  }

  async recoverLeases(_filter = {}) {
    throw new Error("BackgroundJobRepository.recoverLeases is not implemented.");
  }

  async deleteOrphanedSessionJobs(_filter = {}) {
    throw new Error("BackgroundJobRepository.deleteOrphanedSessionJobs is not implemented.");
  }
}
