export class SessionRepository {
  async upsertSession(_input) {
    throw new Error("SessionRepository.upsertSession is not implemented.");
  }

  async getById(_sessionId) {
    throw new Error("SessionRepository.getById is not implemented.");
  }

  async listRecent(_filter = {}) {
    throw new Error("SessionRepository.listRecent is not implemented.");
  }

  async listResumableRuns(_filter = {}) {
    throw new Error("SessionRepository.listResumableRuns is not implemented.");
  }
}
