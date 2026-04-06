export class KnowledgeRepository {
  async upsertDocument(_input) {
    throw new Error("KnowledgeRepository.upsertDocument is not implemented.");
  }

  async getById(_documentId) {
    throw new Error("KnowledgeRepository.getById is not implemented.");
  }

  async getByDocumentKey(_documentKey) {
    throw new Error("KnowledgeRepository.getByDocumentKey is not implemented.");
  }

  async list(_filter = {}) {
    throw new Error("KnowledgeRepository.list is not implemented.");
  }

  async semanticSearch(_input) {
    throw new Error("KnowledgeRepository.semanticSearch is not implemented.");
  }
}
