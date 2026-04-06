export class ReviewRepository {
  async upsertItem(_input) {
    throw new Error("ReviewRepository.upsertItem is not implemented.");
  }

  async list(_filter = {}) {
    throw new Error("ReviewRepository.list is not implemented.");
  }

  async getByReviewKey(_reviewKey) {
    throw new Error("ReviewRepository.getByReviewKey is not implemented.");
  }

  async updateStatus(_reviewKey, _patch = {}) {
    throw new Error("ReviewRepository.updateStatus is not implemented.");
  }

  async recordAttempt(_reviewKey, _attempt = {}) {
    throw new Error("ReviewRepository.recordAttempt is not implemented.");
  }

  async listAttempts(_reviewKey, _filter = {}) {
    throw new Error("ReviewRepository.listAttempts is not implemented.");
  }

  async saveSet(_input) {
    throw new Error("ReviewRepository.saveSet is not implemented.");
  }

  async listSets(_filter = {}) {
    throw new Error("ReviewRepository.listSets is not implemented.");
  }

  async getSetById(_setId) {
    throw new Error("ReviewRepository.getSetById is not implemented.");
  }
}
