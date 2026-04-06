export class KnowledgeEmbeddingRepository {
  async upsertEmbedding(_input) {
    throw new Error("KnowledgeEmbeddingRepository.upsertEmbedding is not implemented.");
  }

  async getByDocumentId(_documentId, _embeddingModel) {
    throw new Error("KnowledgeEmbeddingRepository.getByDocumentId is not implemented.");
  }

  async listStaleDocuments(_filter = {}) {
    throw new Error("KnowledgeEmbeddingRepository.listStaleDocuments is not implemented.");
  }

  async searchNearestByVector(_input) {
    throw new Error("KnowledgeEmbeddingRepository.searchNearestByVector is not implemented.");
  }

  async searchNearestToDocument(_input) {
    throw new Error("KnowledgeEmbeddingRepository.searchNearestToDocument is not implemented.");
  }
}
