export class QuestionRepository {
  async listAll(_filter = {}) {
    throw new Error("QuestionRepository.listAll is not implemented.");
  }

  async listByCategory(_category, _options = {}) {
    throw new Error("QuestionRepository.listByCategory is not implemented.");
  }

  async search(_filter = {}) {
    throw new Error("QuestionRepository.search is not implemented.");
  }

  async getById(_questionId) {
    throw new Error("QuestionRepository.getById is not implemented.");
  }

  async listCategories() {
    throw new Error("QuestionRepository.listCategories is not implemented.");
  }

  async listTags(_filter = {}) {
    throw new Error("QuestionRepository.listTags is not implemented.");
  }

  async save(_question) {
    throw new Error("QuestionRepository.save is not implemented.");
  }

  async importIfMissing(_question) {
    throw new Error("QuestionRepository.importIfMissing is not implemented.");
  }

  async recordUsage(_input) {
    throw new Error("QuestionRepository.recordUsage is not implemented.");
  }
}
